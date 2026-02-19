import {
  RecordingSession,
  NetworkRequest,
  BackgroundMessage,
  Settings,
  HARData
} from '@/types';
import { HARProcessor } from './HARProcessor';
import { StorageService } from '@/services/StorageService';
import { AIService } from '@/services/AIService';
import { ExportService } from '@/services/ExportService';
import { ParallelGenerationOrchestrator } from '@/services/ParallelGenerationOrchestrator';
import { SchemaExtractor } from '@/services/SchemaExtractor';
import { GraphQLSchemaInference } from '@/services/GraphQLSchemaInference';
import { EnvironmentExtractor } from '@/services/EnvironmentExtractor';
import { SecurityTestGenerator } from '@/services/SecurityTestGenerator';
import { DataMaskingService } from '@/services/DataMaskingService';
import { ServiceWorkerManager } from './ServiceWorkerManager';

export class BackgroundService {
  private static instance: BackgroundService;
  private recordingSessions: Map<number, RecordingSession> = new Map();
  private pendingBodies: Map<number, Set<Promise<void>>> = new Map();
  private harProcessor: HARProcessor = new HARProcessor();
  private storageService: StorageService = StorageService.getInstance();
  private aiService: AIService = AIService.getInstance();
  private exportService: ExportService = ExportService.getInstance();
  private dataMaskingService: DataMaskingService = DataMaskingService.getInstance();
  private cachedSettings: Settings | null = null;

  private constructor() {}

  static getInstance(): BackgroundService {
    if (!BackgroundService.instance) {
      BackgroundService.instance = new BackgroundService();
    }
    return BackgroundService.instance;
  }

  async initializeSettings(): Promise<void> {
    const defaultSettings: Settings = {
      aiProvider: 'openai',
      aiModel: 'gpt-4.1-mini',
      apiKeys: {},
      privacyMode: 'cloud',
      authGuide: undefined, // Custom auth instructions (optional)
      dataMasking: {
        enabled: true,
        maskPII: true,
        maskTokens: true,
        maskEmails: true,
        customPatterns: []
      },
      filtering: {
        includeDomains: [],
        excludeDomains: [],
        includeTypes: ['XHR', 'Fetch', 'GraphQL'],
        minDuration: 0,
        maxRequestSize: 10485760 // 10MB
      },
      advanced: {
        maxTokens: 4000,
        temperature: 0.7,
        retryAttempts: 3,
        timeout: 30000,
        cacheResponses: true
      }
    };

    await this.storageService.saveSettings(defaultSettings);
  }

  /**
   * Get cached settings or fetch from storage
   */
  private async getSettings(): Promise<Settings> {
    if (!this.cachedSettings) {
      this.cachedSettings = await this.storageService.getSettings();
    }
    return this.cachedSettings;
  }

  /**
   * Apply data masking to a network request based on settings
   */
  private async applyDataMasking(request: NetworkRequest): Promise<NetworkRequest> {
    const settings = await this.getSettings();

    // Skip if masking is disabled
    if (!settings.dataMasking.enabled) {
      return request;
    }

    // Build masking options from settings
    const maskingOptions = {
      maskEmails: settings.dataMasking.maskEmails,
      maskApiKeys: settings.dataMasking.maskTokens,
      maskPasswords: settings.dataMasking.maskTokens,
      maskJWT: settings.dataMasking.maskTokens,
      maskPhones: settings.dataMasking.maskPII,
      maskSSN: settings.dataMasking.maskPII,
      maskCreditCards: settings.dataMasking.maskPII,
      maskIPs: settings.dataMasking.maskPII,
      maskUUIDs: false, // Usually needed for testing
    };

    // Apply custom patterns if any
    if (settings.dataMasking.customPatterns.length > 0) {
      settings.dataMasking.customPatterns.forEach(pattern => {
        this.dataMaskingService.addCustomPattern(pattern);
      });
    }

    // Apply masking
    return this.dataMaskingService.maskRequest(request, maskingOptions);
  }

  /**
   * Invalidate cached settings when they're updated
   */
  private invalidateSettingsCache(): void {
    this.cachedSettings = null;
  }

  async handleMessage(
    message: BackgroundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): Promise<void> {
    try {
      switch (message.type) {
        case 'START_RECORDING':
          const session = await this.startRecording(message.tabId!);
          sendResponse({ success: true, session });
          break;

        case 'STOP_RECORDING':
          const harData = await this.stopRecording(message.tabId!);
          sendResponse({ success: true, harData });
          break;

        case 'GET_SESSIONS':
          const sessions = await this.storageService.getSessions();
          sendResponse({ success: true, sessions });
          break;

        case 'DELETE_SESSION':
          await this.storageService.deleteSession(message.payload.sessionId);
          sendResponse({ success: true });
          break;

        case 'RENAME_SESSION':
          await this.storageService.renameSession(message.payload.sessionId, message.payload.newName);
          sendResponse({ success: true });
          break;

        case 'UPDATE_SETTINGS':
          await this.storageService.saveSettings(message.payload);
          this.invalidateSettingsCache(); // Clear cache so new settings are used
          sendResponse({ success: true });
          break;

        case 'GET_SETTINGS':
          const settings = await this.storageService.getSettings();
          sendResponse({ success: true, settings });
          break;

        case 'GET_STATUS':
          const status = this.getStatus(message.tabId!);
          sendResponse({ success: true, status });
          break;

        case 'CONTENT_SCRIPT_READY':
          // Content script loaded (e.g. after navigation) — tell it if recording is active
          const senderTabId = _sender.tab?.id;
          const isTabRecording = senderTabId ? this.isRecording(senderTabId) : false;
          sendResponse({
            success: true,
            shouldPing: isTabRecording,
            shouldHeartbeat: true,
            isRecording: isTabRecording,
          });
          break;

        case 'SAVE_SESSION':
          await this.storageService.saveSession(message.payload.session);
          sendResponse({ success: true });
          break;

        case 'GENERATE_TESTS':
          const { sessionId, options } = message.payload;
          const allSessions = await this.storageService.getSessions();
          const targetSession = allSessions.find(s => s.id === sessionId);

          if (!targetSession) {
            throw new Error('Session not found');
          }

          // Convert excluded endpoints array back to Set
          console.log(`🔍 GENERATE_TESTS: excludedEndpoints array from message:`, options.excludedEndpoints);
          console.log(`🔍 GENERATE_TESTS: excludedEndpoints length: ${options.excludedEndpoints?.length || 0}`);
          const excludedEndpoints = options.excludedEndpoints && options.excludedEndpoints.length > 0
            ? new Set<string>(options.excludedEndpoints)
            : undefined;

          // Keep service worker alive during long AI generation
          const swManager = ServiceWorkerManager.getInstance();
          swManager.startActiveOperation();

          // Persist generation state so popup can reconnect after close/reopen
          let lastStorageWrite = 0;
          const persistState = (state: Record<string, any>) => {
            const now = Date.now();
            // Throttle writes to every 2 seconds
            if (now - lastStorageWrite < 2000 && state.status === 'generating') return;
            lastStorageWrite = now;
            chrome.storage.session.set({ generationState: state }).catch(() => {});
          };

          persistState({
            status: 'generating',
            sessionId,
            progress: 0,
            stage: 'Starting generation...',
            startTime: Date.now(),
          });

          // Create progress callback to send updates to popup AND persist state
          const progressCallback = (current: number, total: number, stage: string, endpoint?: string) => {
            const progress = total > 0 ? Math.round((current / total) * 100) : 0;

            // Persist to storage (survives popup close)
            persistState({
              status: 'generating',
              sessionId,
              progress,
              stage,
              currentEndpoint: current,
              totalEndpoints: total,
              endpointName: endpoint,
              startTime: Date.now(),
            });

            // Also send via message (instant update if popup is open)
            try {
              chrome.runtime.sendMessage({
                type: 'GENERATION_PROGRESS',
                payload: { current, total, stage, endpoint }
              }).catch(() => {});
            } catch (error) {
              // Ignore messaging errors — popup may be closed
            }
          };

          try {
            const generatedTest = await this.aiService.generateTests(targetSession, options, excludedEndpoints, progressCallback);

            // Persist completed result so popup can pick it up
            chrome.storage.session.set({
              generationState: {
                status: 'complete',
                sessionId,
                progress: 100,
                stage: 'Complete',
                result: generatedTest,
              }
            }).catch(() => {});

            sendResponse({ success: true, test: generatedTest });
          } catch (genError) {
            // Persist error state
            chrome.storage.session.set({
              generationState: {
                status: 'error',
                sessionId,
                progress: 0,
                stage: 'Failed',
                error: genError instanceof Error ? genError.message : 'Generation failed',
              }
            }).catch(() => {});
            throw genError;
          } finally {
            swManager.stopActiveOperation();
          }
          break;

        case 'EXPORT_TESTS':
          const { testId, format } = message.payload;
          const exportContent = await this.exportService.export(testId, format);
          sendResponse({ success: true, content: exportContent });
          break;

        case 'IMPORT_SESSION':
          await this.storageService.saveSession(message.payload);
          sendResponse({ success: true });
          break;

        case 'CLEAR_GENERATION_STATE':
          chrome.storage.session.remove('generationState').catch(() => {});
          sendResponse({ success: true });
          break;

        case 'PING':
          sendResponse({ success: true, status: 'alive', timestamp: Date.now() });
          break;

        case 'CHECK_READY':
          sendResponse({ success: true, ready: true, status: 'ready', timestamp: Date.now() });
          break;

        case 'GENERATE_PARALLEL':
          await this.handleParallelGeneration(message, sendResponse);
          break;

        case 'EXPORT_OPENAPI':
          await this.handleExportOpenAPI(message, sendResponse);
          break;

        case 'EXPORT_GRAPHQL_SCHEMA':
          await this.handleExportGraphQL(message, sendResponse);
          break;

        case 'EXPORT_ENV_FILE':
          await this.handleExportEnvFile(message, sendResponse);
          break;

        case 'EXPORT_SECURITY_REPORT':
          await this.handleExportSecurityReport(message, sendResponse);
          break;

        default:
          console.warn('Unknown message type:', message.type);
          sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Generate detailed debugger environment report
   */
  private async generateDebuggerReport(): Promise<string> {
    try {
      const targets = await chrome.debugger.getTargets();
      const attachedTargets = targets.filter(t => t.attached);
      
      let report = `📊 Debugger Environment Report:\n`;
      report += `• Total active debuggers: ${attachedTargets.length}\n`;
      
      if (attachedTargets.length > 0) {
        const tabTargets = attachedTargets.filter(t => t.type === 'page');
        const workerTargets = attachedTargets.filter(t => t.type === 'background_page');
        const otherTargets = attachedTargets.filter(t => t.type === 'other');
        
        report += `• Tab debuggers: ${tabTargets.length}\n`;
        report += `• Worker debuggers: ${workerTargets.length}\n`;
        report += `• Other debuggers: ${otherTargets.length}\n`;
        
        if (attachedTargets.length <= 5) {
          report += `\n🔍 Active debugger details:\n`;
          attachedTargets.forEach((target, i) => {
            const url = target.url ? new URL(target.url).hostname : 'unknown';
            report += `  ${i + 1}. ${target.type || 'unknown'} - ${url}\n`;
          });
        }
      }
      
      return report;
    } catch (error) {
      return `📊 Could not generate debugger report: ${error}`;
    }
  }

  /**
   * Advanced debugger conflict detection and resolution
   */
  private async resolveDebuggerConflicts(tabId: number): Promise<boolean> {
    try {
      const targets = await chrome.debugger.getTargets();
      const attachedTargets = targets.filter(t => t.attached);
      
      console.log(`🔍 Analyzing debugger landscape: ${attachedTargets.length} total debuggers`);
      
      // Check for debuggers on the specific tab
      const tabDebuggers = attachedTargets.filter(t => t.tabId === tabId);
      if (tabDebuggers.length > 0) {
        console.log(`⚠️  Found ${tabDebuggers.length} debugger(s) on target tab`);
        
        // Try to detach existing debuggers from this tab
        for (const target of tabDebuggers) {
          try {
            await chrome.debugger.detach({ tabId: target.tabId });
            console.log(`✅ Detached debugger from tab ${target.tabId}`);
          } catch (e) {
            console.log(`❌ Could not detach debugger from tab ${target.tabId}`);
          }
        }
        
        // Wait for detachment to process
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
      }
      
      // Check for global debugger conflicts (too many active debuggers)
      if (attachedTargets.length > 10) {
        console.log(`⚠️  High debugger usage detected (${attachedTargets.length} active)`);
        return false; // Suggest user action
      }
      
      return true;
    } catch (error) {
      console.log('Could not analyze debugger conflicts:', error);
      return true; // Proceed anyway
    }
  }

  async startRecording(tabId: number): Promise<RecordingSession> {
    // Check if already recording
    if (this.recordingSessions.has(tabId)) {
      throw new Error('Already recording on this tab');
    }

    // Get tab info
    const tab = await chrome.tabs.get(tabId);
    
    // Validate tab URL - can't record on restricted pages
    if (!tab.url) {
      throw new Error('Cannot record on this page: No URL available');
    }
    
    const url = tab.url.toLowerCase();
    if (url.startsWith('chrome://') || 
        url.startsWith('chrome-extension://') || 
        url.startsWith('moz-extension://') || 
        url.startsWith('edge://') || 
        url.startsWith('about:') ||
        url.startsWith('data:') ||
        url.startsWith('file://')) {
      throw new Error('Cannot record on browser internal pages. Please navigate to a website (http:// or https://)');
    }
    
    console.log(`Starting recording on: ${tab.url}`);
    console.log(`Tab status - loaded: ${tab.status}, title: ${tab.title}`);
    
    // Pre-flight debugger conflict resolution
    console.log('🔧 Resolving debugger conflicts...');
    const conflictResolved = await this.resolveDebuggerConflicts(tabId);
    if (!conflictResolved) {
      throw new Error('Too many active debuggers detected. Please:\n1. Close other debugging tools\n2. Disable debugging extensions\n3. Restart Chrome if needed');
    }
    
    // Advanced debugger attachment with retry logic
    let debuggerAttached = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!debuggerAttached && retryCount < maxRetries) {
      try {
        retryCount++;
        console.log(`🔧 Debugger attachment attempt ${retryCount}/${maxRetries}`);
        
        // Check for existing debuggers
        const targets = await chrome.debugger.getTargets();
        const attachedTargets = targets.filter(t => t.attached);
        console.log(`📊 Total attached debuggers: ${attachedTargets.length}`);
        
        // Check if this specific tab already has a debugger
        const tabTarget = attachedTargets.find(t => t.tabId === tabId);
        if (tabTarget) {
          console.log('⚠️  Debugger already attached to this tab, attempting to detach...');
          try {
            await chrome.debugger.detach({ tabId });
            console.log('✅ Previous debugger detached');
            // Wait a moment for Chrome to process the detachment
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (detachError) {
            console.log('Could not detach existing debugger:', detachError);
          }
        }
        
        // Try to attach debugger with protocol fallback
        const protocols = ['1.3', '1.2', '1.1']; // Try newer protocols first
        let attachmentSuccess = false;
        
        for (const protocol of protocols) {
          try {
            await chrome.debugger.attach({ tabId }, protocol);
            attachmentSuccess = true;
            console.log(`✅ Debugger attached successfully with protocol ${protocol}`);
            break;
          } catch (protocolError) {
            console.log(`❌ Protocol ${protocol} failed, trying next...`);
            if (protocol === protocols[protocols.length - 1]) {
              // Last protocol failed, throw the error
              throw protocolError;
            }
          }
        }
        
        if (attachmentSuccess) {
          debuggerAttached = true;
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Debugger attachment attempt ${retryCount} failed:`, errorMessage);
        
        if (retryCount >= maxRetries) {
          // Final attempt failed, provide comprehensive error handling
          console.error('❌ Tab URL was:', tab.url);
          console.error('❌ Tab ID was:', tabId);
          
          // Generate comprehensive error report
          const debuggerReport = await this.generateDebuggerReport();
          
          if (errorMessage.includes('Cannot access a chrome-extension')) {
            throw new Error(`❌ Chrome Security Restriction Detected\n\n🔍 DIAGNOSIS:\n${debuggerReport}\n\n✅ SOLUTIONS (try in order):\n1. 🚫 Disable other extensions temporarily\n2. 🕵️ Use incognito mode (enable XHRScribe in incognito)\n3. 📄 Try the homepage instead of login page\n4. 🔧 Close any open DevTools (F12)\n5. 🔄 Restart Chrome if problem persists\n\n💡 This happens when other extensions interfere with debugger access.`);
          } else if (errorMessage.includes('Another debugger is already attached')) {
            throw new Error(`❌ Debugger Conflict Detected\n\n🔍 DIAGNOSIS:\n${debuggerReport}\n\n✅ SOLUTIONS:\n1. 🔧 Close Chrome DevTools (F12) on this tab\n2. 🚫 Disable other debugging extensions\n3. 🔄 Restart Chrome to clear all debugger sessions\n\n💡 Only one debugger can be attached to a tab at a time.`);
          } else if (errorMessage.includes('Inspected target navigated or closed')) {
            throw new Error('❌ Page Changed During Setup\n\n✅ SOLUTION:\n1. 🔄 Refresh the page\n2. ⏳ Wait for full page load\n3. 🎬 Try recording again');
          } else if (errorMessage.includes('No such target')) {
            throw new Error('❌ Tab No Longer Available\n\n✅ SOLUTION:\n1. 🔄 Refresh the page\n2. ⏳ Wait for full page load\n3. 🎬 Try recording again');
          } else {
            throw new Error(`❌ Debugger Attachment Failed\n\n🔍 DIAGNOSIS:\n${debuggerReport}\n\n❌ Error: ${errorMessage}\n\n✅ SOLUTIONS:\n1. 🔄 Refresh the page\n2. 🚫 Disable other extensions\n3. 🕵️ Use incognito mode\n4. 🌐 Try a different website\n5. 🔄 Restart Chrome\n\n💡 After ${maxRetries} attempts, this appears to be a system-level issue.`);
          }
        } else {
          // Wait before retry with exponential backoff
          const waitTime = Math.pow(2, retryCount - 1) * 1000; // 1s, 2s, 4s
          console.log(`⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // Enable comprehensive network monitoring
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
        maxTotalBufferSize: 10000000,
        maxResourceBufferSize: 5000000
      });
      console.log('✅ Network monitoring enabled');
    } catch (error) {
      console.error('❌ Failed to enable network monitoring:', error);
      // Detach debugger if network monitoring fails
      await chrome.debugger.detach({ tabId }).catch(() => {});
      throw new Error('Failed to enable network monitoring. Please try again.');
    }
    
    // ENHANCED: Enable additional debugging domains for complete capture
    // These are optional enhancements - failure won't prevent basic recording
    
    // Enable Service Worker debugging (optional)
    try {
      await chrome.debugger.sendCommand({ tabId }, 'ServiceWorker.enable');
      console.log('✅ ServiceWorker debugging enabled');
    } catch (error) {
      console.log('ℹ️ ServiceWorker debugging not available (Chrome version may not support it)');
    }
    
    // Enable background services monitoring (optional)
    try {
      await chrome.debugger.sendCommand({ tabId }, 'BackgroundService.startObserving', {
        service: 'backgroundFetch'
      });
      await chrome.debugger.sendCommand({ tabId }, 'BackgroundService.startObserving', {
        service: 'pushMessaging'
      });
      await chrome.debugger.sendCommand({ tabId }, 'BackgroundService.startObserving', {
        service: 'backgroundSync'
      });
      console.log('✅ Background services monitoring enabled');
    } catch (error) {
      console.log('ℹ️ Background services monitoring not available');
    }

    // Create recording session
    const session: RecordingSession = {
      id: `session_${Date.now()}`,
      name: `Recording - ${new URL(tab.url || '').hostname}`,
      startTime: Date.now(),
      requests: [],
      tabId,
      url: tab.url || '',
      status: 'recording'
    };

    this.recordingSessions.set(tabId, session);
    this.harProcessor.startSession(session.id);

    // Update extension icon
    await this.updateIcon(tabId, true);

    return session;
  }

  async stopRecording(tabId: number): Promise<HARData> {
    const session = this.recordingSessions.get(tabId);
    if (!session) {
      throw new Error('No recording session found');
    }

    // Update session
    session.endTime = Date.now();
    session.status = 'stopped';

    // Wait for all pending response bodies to complete (max 5s timeout)
    const pending = this.pendingBodies.get(tabId);
    if (pending && pending.size > 0) {
      console.log(`Waiting for ${pending.size} pending response bodies...`);
      const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
      await Promise.race([
        Promise.all(pending),
        timeout,
      ]);
    }
    this.pendingBodies.delete(tabId);

    // Get HAR data
    const harData = this.harProcessor.finalize(session);

    // Save session
    await this.storageService.saveSession(session);

    // Clean up
    this.recordingSessions.delete(tabId);
    this.harProcessor.endSession(session.id);

    // Detach debugger
    try {
      await chrome.debugger.detach({ tabId });
    } catch (error) {
      console.warn('Failed to detach debugger:', error);
    }

    // Update icon
    await this.updateIcon(tabId, false);

    return harData;
  }

  handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params: any
  ): void {
    if (!source.tabId) return;

    const session = this.recordingSessions.get(source.tabId);
    if (!session) return;

    // Process ALL network events for comprehensive capture
    switch (method) {
      // Standard network events
      case 'Network.requestWillBeSent':
        this.handleRequestWillBeSent(session, params);
        break;

      case 'Network.responseReceived':
        this.handleResponseReceived(session, params);
        break;

      case 'Network.loadingFinished':
        this.handleLoadingFinished(session, params);
        break;

      case 'Network.loadingFailed':
        this.handleLoadingFailed(session, params);
        break;

      // ENHANCED: WebSocket events
      case 'Network.webSocketCreated':
        this.handleWebSocketCreated(session, params);
        break;

      case 'Network.webSocketFrameSent':
      case 'Network.webSocketFrameReceived':
        this.handleWebSocketFrame(session, method, params);
        break;

      case 'Network.webSocketWillSendHandshakeRequest':
        this.handleWebSocketHandshake(session, params);
        break;

      case 'Network.webSocketHandshakeResponseReceived':
        this.handleWebSocketHandshakeResponse(session, params);
        break;

      // NEW: Server-Sent Events (SSE)
      case 'Network.eventSourceMessageReceived':
        this.handleServerSentEvent(session, params);
        break;

      // NEW: Service Worker network events
      case 'ServiceWorker.workerCreated':
        this.handleServiceWorkerCreated(session, params);
        break;

      case 'ServiceWorker.workerDestroyed':
        this.handleServiceWorkerDestroyed(session, params);
        break;

      // NEW: Background service events
      case 'BackgroundService.recordingStateChanged':
        this.handleBackgroundServiceEvent(session, params);
        break;

      // NEW: Network state changes
      case 'Network.dataReceived':
        this.handleDataReceived(session, params);
        break;

      case 'Network.resourceChangedPriority':
        this.handleResourcePriorityChange(session, params);
        break;
    }
  }

  private handleRequestWillBeSent(session: RecordingSession, params: any): void {
    const { requestId, request, timestamp, type, initiator } = params;

    // Enhanced debugging for authentication requests
    if (request.url.includes('/wapi/') || request.url.includes('/auth')) {
      console.log('🔍 Potential auth request detected:', {
        url: request.url,
        method: request.method,
        type,
        cookies: request.headers?.cookie ? 'Present' : 'None',
        headers: Object.keys(request.headers || {}),
        isApiRequest: this.isApiRequest(request.url, type, request, initiator)
      });
    }

    // Check if it's an API request with enhanced detection
    if (!this.isApiRequest(request.url, type, request, initiator)) return;

    const networkRequest: NetworkRequest = {
      id: requestId,
      url: request.url,
      method: request.method,
      type: this.getRequestType(request, initiator),
      timestamp: timestamp * 1000,
      requestHeaders: request.headers,
      requestBody: request.postData
    };

    // Apply data masking and add to session
    this.applyDataMasking(networkRequest).then(maskedRequest => {
      session.requests.push(maskedRequest);
      this.harProcessor.addRequest(session.id, maskedRequest);
    }).catch(error => {
      console.error('Data masking failed, using original request:', error);
      session.requests.push(networkRequest);
      this.harProcessor.addRequest(session.id, networkRequest);
    });
  }

  private handleResponseReceived(session: RecordingSession, params: any): void {
    const { requestId, response, timestamp } = params;

    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;

    // Update request with response data
    request.status = response.status;
    request.responseHeaders = response.headers;
    request.duration = (timestamp * 1000) - request.timestamp;

    // Detect gRPC/Protobuf from content-type
    const contentType = (response.headers?.['content-type'] || response.headers?.['Content-Type'] || '').toLowerCase();
    if (contentType.includes('grpc') || contentType.includes('protobuf') || contentType.includes('x-protobuf')) {
      request.type = 'gRPC';
    }

    // Update in HAR processor
    this.harProcessor.updateResponse(session.id, requestId, response);
  }

  private handleLoadingFinished(session: RecordingSession, params: any): void {
    const { requestId, encodedDataLength } = params;

    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;

    request.responseSize = encodedDataLength;

    // Track the pending body fetch so stopRecording can await it
    const bodyPromise = this.getResponseBody(session.tabId, requestId).then(body => {
      if (body) {
        request.responseBody = body;
        this.harProcessor.updateResponseBody(session.id, requestId, body);
      }
    }).catch(error => {
      console.warn(`Failed to get response body for ${requestId}:`, error);
    }).finally(() => {
      // Remove from pending set once done
      const pending = this.pendingBodies.get(session.tabId);
      if (pending) {
        pending.delete(bodyPromise);
      }
    });

    // Add to pending set
    if (!this.pendingBodies.has(session.tabId)) {
      this.pendingBodies.set(session.tabId, new Set());
    }
    this.pendingBodies.get(session.tabId)!.add(bodyPromise);
  }

  private handleLoadingFailed(session: RecordingSession, params: any): void {
    const { requestId, errorText, canceled } = params;

    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;

    request.error = canceled ? 'Canceled' : errorText;
  }

  private handleWebSocketCreated(session: RecordingSession, params: any): void {
    const { requestId, url } = params;

    const networkRequest: NetworkRequest = {
      id: requestId,
      url,
      method: 'WebSocket',
      type: 'WebSocket',
      timestamp: Date.now()
    };

    session.requests.push(networkRequest);
    this.harProcessor.addRequest(session.id, networkRequest);
  }

  private handleWebSocketFrame(
    session: RecordingSession, 
    method: string, 
    params: any
  ): void {
    const { requestId, response } = params;

    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;

    // Store WebSocket frames (simplified for now)
    if (!request.responseBody) {
      request.responseBody = [];
    }
    request.responseBody.push({
      type: method.includes('Sent') ? 'sent' : 'received',
      data: response.payloadData,
      timestamp: Date.now()
    });
  }

  private async getResponseBody(
    tabId: number, 
    requestId: string
  ): Promise<string | null> {
    try {
      const result = await chrome.debugger.sendCommand(
        { tabId },
        'Network.getResponseBody',
        { requestId }
      ) as any;
      return result?.body || null;
    } catch (error) {
      // Response body might not be available for all requests
      return null;
    }
  }

  private isApiRequest(url: string, type: string, request?: any, initiator?: any): boolean {
    // Filter out static resources
    const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.map', '.wasm', '.webp', '.avif'];
    const urlLower = url.toLowerCase();

    if (staticExtensions.some(ext => urlLower.includes(ext))) {
      return false;
    }

    // Filter out known non-API patterns (analytics, tracking, ads)
    const excludePatterns = [
      '/collect', '/track', '/analytics', '/metrics', '/beacon',
      '/pixel', '/impression', '/adserver', '/ads/', '/gtag/',
      '/ga/', '/gtm.js', 'google-analytics', 'googletagmanager',
      'facebook.com/tr', 'doubleclick.net', '/pagead/',
      'hotjar', 'fullstory', 'segment.io', 'mixpanel',
      'sentry.io/api', 'bugsnag', 'newrelic', 'datadog',
      '/favicon', '/_next/static', '/_nuxt/static'
    ];

    if (excludePatterns.some(pattern => urlLower.includes(pattern))) {
      return false;
    }

    // XHR or Fetch type is the primary signal - these are almost always API calls
    const isXhrOrFetch = type === 'XHR' || type === 'Fetch';

    // Strong API URL patterns (high confidence)
    const strongApiPatterns = [
      '/api/', '/wapi/', '/webapi/', '/v1/', '/v2/', '/v3/', '/v4/', '/v5/',
      '/graphql', '/rest/', '/rpc/', '/grpc/',
      '/auth/', '/login', '/logout', '/signin', '/signout',
      '/token', '/oauth', '/sso',
    ];

    const hasStrongApiPattern = strongApiPatterns.some(pattern => urlLower.includes(pattern));

    // Content-Type based API detection (strong signal)
    const isApiContentType = this.hasApiContentType(request?.headers || {});

    // API subdomains (strong signal)
    const strongDomainPatterns = ['api.', 'gateway.', 'backend.', 'rest.'];
    const hasApiDomain = strongDomainPatterns.some(pattern => urlLower.includes(pattern));

    // Decision logic: require at least one strong signal
    // XHR/Fetch alone is sufficient (browser explicitly marked it as such)
    if (isXhrOrFetch) return true;

    // Strong URL pattern is sufficient
    if (hasStrongApiPattern) return true;

    // API content-type is sufficient
    if (isApiContentType) return true;

    // API domain is sufficient
    if (hasApiDomain) return true;

    // Weaker signals: require combination of two or more
    const isNonGetMethod = request?.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    const isAuthRelated = this.isAuthenticationRelated(url, request);
    const isSpaApiCall = this.isSinglePageAppApiCall(initiator, url);

    // Weak URL patterns (need second signal to qualify)
    const weakApiPatterns = [
      '.json', '.xml', '/data/', '/service/',
      '/search', '/filter', '/query',
      '/upload', '/download', '/export', '/import',
      '/webhook', '/events', '/stream',
    ];
    const hasWeakApiPattern = weakApiPatterns.some(pattern => urlLower.includes(pattern));

    // Require at least two weak signals
    const weakSignalCount = [isNonGetMethod, isAuthRelated, isSpaApiCall, hasWeakApiPattern]
      .filter(Boolean).length;

    return weakSignalCount >= 2;
  }

  // NEW: Content-Type based API detection
  private hasApiContentType(headers: Record<string, string>): boolean {
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    const acceptHeader = headers['accept'] || headers['Accept'] || '';
    
    const apiContentTypes = [
      'application/json', 'application/xml', 'application/x-www-form-urlencoded',
      'multipart/form-data', 'application/protobuf', 'application/msgpack',
      'application/grpc', 'application/x-protobuf', 'application/octet-stream'
    ];
    
    const apiAcceptTypes = [
      'application/json', 'application/xml', 'text/xml',
      'application/hal+json', 'application/vnd.api+json'
    ];
    
    return apiContentTypes.some(type => contentType.includes(type)) ||
           apiAcceptTypes.some(type => acceptHeader.includes(type));
  }

  // NEW: Single Page Application API call detection
  private isSinglePageAppApiCall(initiator: any, url: string): boolean {
    if (!initiator) return false;
    
    // Check if request originated from JavaScript in a SPA context
    const isSpaInitiator = initiator.type === 'script' || initiator.type === 'fetch';
    
    // Check for common SPA frameworks patterns in URLs
    const spaPatterns = [
      '_next/', '_nuxt/', '__webpack', '__vite', '/_app/',
      '/api/', '/trpc/', '/graphql', '/_server/'
    ];
    
    const hasSpaPattern = spaPatterns.some(pattern => url.includes(pattern));
    
    // Check for AJAX-like headers (common in SPAs)
    const hasAjaxHeaders = initiator?.stack && 
      typeof initiator.stack === 'string' &&
      (initiator.stack.includes('XMLHttpRequest') || 
       initiator.stack.includes('fetch') ||
       initiator.stack.includes('axios'));
    
    return isSpaInitiator && (hasSpaPattern || hasAjaxHeaders);
  }

  // NEW: Authentication-specific request detection
  private isAuthenticationRelated(url: string, request?: any): boolean {
    // Check for authentication-related URL patterns
    const authUrlPatterns = [
      '/auth', '/login', '/logout', '/signin', '/signout',
      '/token', '/refresh', '/session', '/user', '/profile',
      '/oauth', '/sso', '/saml', '/oidc', '/jwt'
    ];
    
    const hasAuthUrlPattern = authUrlPatterns.some(pattern => 
      url.toLowerCase().includes(pattern)
    );
    
    // Check for authentication headers
    const headers = request?.headers || {};
    const hasAuthHeaders = this.hasAuthenticationHeaders(headers);
    
    // Check for authentication cookies
    const hasAuthCookies = this.hasAuthenticationCookies(headers);
    
    // Check for authentication query parameters
    const hasAuthQueryParams = this.hasAuthenticationQueryParams(url);
    
    return hasAuthUrlPattern || hasAuthHeaders || hasAuthCookies || hasAuthQueryParams;
  }

  private hasAuthenticationHeaders(headers: Record<string, string>): boolean {
    const authHeaderNames = [
      'authorization', 'x-auth-token', 'x-access-token', 'x-api-key',
      'x-session-id', 'x-csrf-token', 'x-xsrf-token'
    ];
    
    return authHeaderNames.some(headerName => 
      Object.keys(headers).some(key => key.toLowerCase() === headerName)
    );
  }

  private hasAuthenticationCookies(headers: Record<string, string>): boolean {
    const cookieHeader = headers['cookie'] || headers['Cookie'] || '';
    
    // Look for common authentication cookie patterns
    const authCookiePatterns = [
      'session', 'auth', 'token', 'login', 'userid', 'companyid',
      '_csrf', 'PLAY_SESSION', 'connect.sid'
    ];
    
    return authCookiePatterns.some(pattern => 
      cookieHeader.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  private hasAuthenticationQueryParams(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const authQueryParams = [
        'token', 'auth', 'session', 'userid', 'companyid',
        'access_token', 'refresh_token', 'api_key'
      ];
      
      return authQueryParams.some(param => urlObj.searchParams.has(param));
    } catch {
      // If URL parsing fails, check string patterns
      const authParamPatterns = [
        'token=', 'auth=', 'session=', 'userid=', 'access_token=', 'api_key='
      ];
      
      return authParamPatterns.some(pattern => 
        url.toLowerCase().includes(pattern)
      );
    }
  }

  // NEW: Enhanced WebSocket handshake handling
  private handleWebSocketHandshake(session: RecordingSession, params: any): void {
    const { requestId, request, timestamp } = params;
    
    console.log('🔌 WebSocket handshake request detected:', request.url);
    
    const networkRequest: NetworkRequest = {
      id: requestId,
      url: request.url,
      method: 'WEBSOCKET_HANDSHAKE',
      type: 'WebSocket',
      timestamp: timestamp * 1000,
      requestHeaders: request.headers,
      requestBody: 'WebSocket handshake request'
    };
    
    session.requests.push(networkRequest);
    this.harProcessor.addRequest(session.id, networkRequest);
  }

  private handleWebSocketHandshakeResponse(session: RecordingSession, params: any): void {
    const { requestId, response, timestamp } = params;
    
    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;
    
    request.status = response.status;
    request.responseHeaders = response.headers;
    request.duration = (timestamp * 1000) - request.timestamp;
    request.responseBody = 'WebSocket handshake successful';
    
    console.log('🔌 WebSocket handshake response received for:', request.url);
    this.harProcessor.updateResponse(session.id, requestId, response);
  }

  // NEW: Server-Sent Events handling
  private handleServerSentEvent(session: RecordingSession, params: any): void {
    const { requestId, timestamp, eventName, eventId, data } = params;
    
    console.log('📡 Server-Sent Event received:', eventName);
    
    // Find the SSE connection request
    let sseRequest = session.requests.find(r => r.id === requestId);
    
    if (!sseRequest) {
      // Create a new SSE request if not found
      sseRequest = {
        id: requestId,
        url: 'SSE_CONNECTION',
        method: 'GET',
        type: 'XHR', // SSE uses XHR under the hood
        timestamp: timestamp * 1000,
        requestHeaders: { 'Accept': 'text/event-stream' },
        responseBody: []
      };
      session.requests.push(sseRequest);
      this.harProcessor.addRequest(session.id, sseRequest);
    }
    
    // Add SSE data to response body
    if (!sseRequest.responseBody) {
      sseRequest.responseBody = [];
    }
    
    if (Array.isArray(sseRequest.responseBody)) {
      sseRequest.responseBody.push({
        timestamp: timestamp * 1000,
        eventName,
        eventId,
        data,
        type: 'server_sent_event'
      });
    }
  }

  // NEW: Service Worker network handling
  private handleServiceWorkerCreated(session: RecordingSession, params: any): void {
    const { workerId, url, scopeURL } = params;
    
    console.log('👷 Service Worker created:', url);
    
    // Enable network domain for this service worker
    try {
      chrome.debugger.sendCommand(
        { tabId: session.tabId },
        'ServiceWorker.deliverPushMessage',
        { origin: new URL(url).origin, registrationId: workerId }
      );
    } catch (error) {
      console.warn('Failed to enable Service Worker network monitoring:', error);
    }
  }

  private handleServiceWorkerDestroyed(session: RecordingSession, params: any): void {
    const { workerId } = params;
    console.log('👷 Service Worker destroyed:', workerId);
  }

  // NEW: Background service event handling
  private handleBackgroundServiceEvent(session: RecordingSession, params: any): void {
    const { isRecording, service } = params;
    console.log(`📱 Background service ${service} recording state:`, isRecording);
  }

  // NEW: Data received handling for streaming requests
  private handleDataReceived(session: RecordingSession, params: any): void {
    const { requestId, timestamp, dataLength, encodedDataLength } = params;
    
    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;
    
    // Track streaming data for large responses
    if (!request.responseSize) {
      request.responseSize = 0;
    }
    request.responseSize += dataLength;
    
    // Mark as streaming request if data is received in chunks
    if (!request.metadata) {
      request.metadata = {};
    }
    request.metadata.isStreaming = true;
    request.metadata.chunks = (request.metadata.chunks || 0) + 1;
  }

  // NEW: Resource priority change handling
  private handleResourcePriorityChange(session: RecordingSession, params: any): void {
    const { requestId, newPriority, timestamp } = params;
    
    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;
    
    if (!request.metadata) {
      request.metadata = {};
    }
    request.metadata.priority = newPriority;
    request.metadata.priorityChanged = timestamp * 1000;
  }

  private getRequestType(request: any, initiator: any): NetworkRequest['type'] {
    if (request.url.includes('/graphql')) return 'GraphQL';
    if (initiator?.type === 'xmlhttprequest') return 'XHR';
    if (initiator?.type === 'fetch') return 'Fetch';
    if (request.method === 'WebSocket') return 'WebSocket';
    return 'Fetch'; // Default
  }

  private async updateIcon(tabId: number, recording: boolean): Promise<void> {
    // Always use regular icons for now (recording icons not available)
    const path = {
      16: '/icons/icon16.png',
      32: '/icons/icon32.png', 
      48: '/icons/icon48.png',
      128: '/icons/icon128.png'
    };

    try {
      await chrome.action.setIcon({ tabId, path });
      await chrome.action.setTitle({ 
        tabId, 
        title: recording ? 'XHRScribe - Recording... 🔴' : 'XHRScribe - Click to start recording' 
      });
    } catch (error) {
      // Silently continue if icon update fails - it's not critical
      console.log('Note: Icon update not available in this context');
    }
  }

  handleDebuggerDetach(tabId: number): void {
    if (this.recordingSessions.has(tabId)) {
      this.stopRecording(tabId).catch(console.error);
    }
  }

  isRecording(tabId: number): boolean {
    return this.recordingSessions.has(tabId);
  }

  getStatus(tabId: number): { recording: boolean; session?: RecordingSession } {
    const session = this.recordingSessions.get(tabId);
    return {
      recording: !!session,
      session
    };
  }

  // Helper: fetch a session by ID, send error response if not found
  private async getSessionOrFail(
    sessionId: string,
    sendResponse: (response?: any) => void
  ): Promise<RecordingSession | null> {
    const sessions = await this.storageService.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      sendResponse({ success: false, error: 'Session not found' });
      return null;
    }
    return session;
  }

  // ==================== PARALLEL GENERATION HANDLERS ====================

  private async handleParallelGeneration(
    message: BackgroundMessage,
    sendResponse: (response?: any) => void
  ): Promise<void> {
    const { sessionId, options } = message.payload;
    const session = await this.getSessionOrFail(sessionId, sendResponse);
    if (!session) return;

    // Keep service worker alive during parallel generation
    const parallelSwManager = ServiceWorkerManager.getInstance();
    parallelSwManager.startActiveOperation();

    // Persist initial parallel generation state
    chrome.storage.session.set({
      generationState: {
        status: 'generating',
        sessionId,
        progress: 0,
        stage: 'Starting parallel generation...',
        startTime: Date.now(),
      }
    }).catch(() => {});

    let lastParallelWrite = 0;

    try {
      const orchestrator = ParallelGenerationOrchestrator.getInstance();

      const result = await orchestrator.generateAll(
        session,
        options,
        (progress) => {
          // Persist to storage (throttled)
          const now = Date.now();
          if (now - lastParallelWrite >= 2000) {
            lastParallelWrite = now;
            chrome.storage.session.set({
              generationState: {
                status: 'generating',
                sessionId,
                progress: Math.round(progress.overall * 100),
                stage: progress.currentTask || 'Generating...',
                startTime: Date.now(),
              }
            }).catch(() => {});
          }

          try {
            chrome.runtime.sendMessage({
              type: 'PARALLEL_GENERATION_PROGRESS',
              payload: progress
            }).catch(() => {});
          } catch {
            // Ignore messaging errors
          }
        }
      );

      const testCode = orchestrator.generateCombinedTestCode(result, options.framework);

      // Persist completed result
      chrome.storage.session.set({
        generationState: {
          status: 'complete',
          sessionId,
          progress: 100,
          stage: 'Complete',
          result: { code: testCode, id: `parallel_${Date.now()}`, framework: options.framework, qualityScore: 0, estimatedTokens: 0, estimatedCost: 0 },
        }
      }).catch(() => {});

      sendResponse({
        success: true,
        result: {
          ...result,
          testCode,
          timing: result.timing
        }
      });
    } catch (error) {
      // Persist error state
      chrome.storage.session.set({
        generationState: {
          status: 'error',
          sessionId,
          progress: 0,
          stage: 'Failed',
          error: error instanceof Error ? error.message : 'Parallel generation failed',
        }
      }).catch(() => {});

      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Parallel generation failed'
      });
    } finally {
      parallelSwManager.stopActiveOperation();
    }
  }

  private async handleExportOpenAPI(
    message: BackgroundMessage,
    sendResponse: (response?: any) => void
  ): Promise<void> {
    const { sessionId } = message.payload;
    const session = await this.getSessionOrFail(sessionId, sendResponse);
    if (!session) return;

    try {
      const extractor = SchemaExtractor.getInstance();
      const spec = extractor.extractOpenAPISpec(session);
      const json = extractor.exportAsJSON(spec);

      sendResponse({ success: true, content: json, spec });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'OpenAPI export failed'
      });
    }
  }

  private async handleExportGraphQL(
    message: BackgroundMessage,
    sendResponse: (response?: any) => void
  ): Promise<void> {
    const { sessionId } = message.payload;
    const session = await this.getSessionOrFail(sessionId, sendResponse);
    if (!session) return;

    try {
      const inferrer = GraphQLSchemaInference.getInstance();
      const schema = inferrer.inferSchema(session);

      sendResponse({
        success: true,
        content: schema.sdl,
        schema
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'GraphQL schema export failed'
      });
    }
  }

  private async handleExportEnvFile(
    message: BackgroundMessage,
    sendResponse: (response?: any) => void
  ): Promise<void> {
    const { sessionId } = message.payload;
    const session = await this.getSessionOrFail(sessionId, sendResponse);
    if (!session) return;

    try {
      const extractor = EnvironmentExtractor.getInstance();
      const result = extractor.extractVariables(session);

      sendResponse({
        success: true,
        content: result.envFile,
        variables: result.variables,
        environments: result.environments
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Environment extraction failed'
      });
    }
  }

  private async handleExportSecurityReport(
    message: BackgroundMessage,
    sendResponse: (response?: any) => void
  ): Promise<void> {
    const { sessionId, framework } = message.payload;
    const session = await this.getSessionOrFail(sessionId, sendResponse);
    if (!session) return;

    try {
      const generator = SecurityTestGenerator.getInstance();
      const suites = generator.generateSecurityTests(session);

      // Generate test code for each suite
      const testCodes = suites.map(suite =>
        generator.generateSecurityTestCode(suite, framework || 'jest')
      );

      // Calculate overall risk
      const overallRisk = suites.length > 0
        ? Math.round(suites.reduce((sum, s) => sum + s.riskScore, 0) / suites.length)
        : 0;

      sendResponse({
        success: true,
        suites,
        testCode: testCodes.join('\n\n'),
        overallRisk,
        totalTests: suites.reduce((sum, s) => sum + s.tests.length, 0)
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Security report generation failed'
      });
    }
  }
}