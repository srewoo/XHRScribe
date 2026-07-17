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
import { DataMaskingService } from '@/services/DataMaskingService';
import { ExportController } from './ExportController';
import { ServiceWorkerManager } from './ServiceWorkerManager';
import { Logger } from '@/services/logging/Logger';
import { isApiRequest, passesUserFilters } from './RequestClassifier';

export class BackgroundService {
  private static instance: BackgroundService;
  private recordingSessions: Map<number, RecordingSession> = new Map();
  private pendingBodies: Map<number, Set<Promise<void>>> = new Map();
  // Debounce handles for active-session snapshots (one per recording tab).
  private snapshotTimers: Map<number, number> = new Map();
  // Consecutive debugger re-attach attempts per tab (reset on success).
  private reattachAttempts: Map<number, number> = new Map();
  private harProcessor: HARProcessor = new HARProcessor();
  private storageService: StorageService = StorageService.getInstance();
  private aiService: AIService = AIService.getInstance();
  private exportService: ExportService = ExportService.getInstance();
  private exportController: ExportController = ExportController.getInstance();
  private dataMaskingService: DataMaskingService = DataMaskingService.getInstance();
  private cachedSettings: Settings | null = null;

  // Upper bound on retained WebSocket/SSE frames per request, so a long-lived
  // stream can't grow the in-memory session (and its 3s snapshot) without bound.
  private static readonly MAX_STREAM_FRAMES = 2000;
  // Hard cap on requests captured per recording session — bounds memory and the
  // periodic session snapshot on long recordings.
  private static readonly MAX_SESSION_REQUESTS = 5000;
  // Session ids we've already warned about hitting the cap (warn once each).
  private sessionCapWarned: Set<string> = new Set();

  // Tabs whose startRecording() is in flight but not yet in recordingSessions.
  // Closes the TOCTOU window between the has()-guard and the map population,
  // where two rapid START_RECORDING messages could both attach the debugger.
  private startingTabs: Set<number> = new Set();

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
    // getSettings() can return null (nothing stored yet / decrypt failure);
    // fall back to defaults so callers always get a usable Settings object.
    return this.cachedSettings ?? this.storageService.getDefaultSettings();
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

    const maskingOptions = this.buildMaskingOptions(settings);
    return this.dataMaskingService.maskRequest(request, maskingOptions);
  }

  /** Translate user privacy settings into DataMaskingService options. */
  private buildMaskingOptions(settings: any) {
    // Register any user-defined custom patterns (deduplicated by the service).
    if (settings.dataMasking.customPatterns?.length > 0) {
      settings.dataMasking.customPatterns.forEach((pattern: any) => {
        this.dataMaskingService.addCustomPattern(pattern);
      });
    }

    return {
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
  }

  /**
   * Single, guaranteed masking pass over a completed session. Runs after all
   * request/response data has arrived and before anything is persisted or
   * exported. Masking applies to request + response headers and bodies, so
   * this is the privacy choke point for the whole capture pipeline. Idempotent
   * — safe to call once at stop.
   */
  private async maskSessionData(session: RecordingSession): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.dataMasking?.enabled) {
      return;
    }

    const maskingOptions = this.buildMaskingOptions(settings);
    session.requests = session.requests.map(req =>
      this.dataMaskingService.maskRequest(req, maskingOptions)
    );
  }

  private snapshotKey(tabId: number): string {
    return `activeSession_${tabId}`;
  }

  /**
   * Debounced snapshot of an active recording session to session storage. If
   * the MV3 service worker is torn down mid-recording, the in-memory session
   * map is lost; this lets stopRecording recover whatever was captured so far
   * instead of throwing "No recording session found". Best-effort — failures
   * (e.g. quota) are logged and ignored.
   */
  private scheduleSessionSnapshot(tabId: number): void {
    if (this.snapshotTimers.has(tabId)) {
      return; // a write is already pending within the debounce window
    }
    const timer = setTimeout(() => {
      this.snapshotTimers.delete(tabId);
      const session = this.recordingSessions.get(tabId);
      if (!session) return;
      chrome.storage.session
        .set({ [this.snapshotKey(tabId)]: session })
        .catch((e: unknown) =>
          Logger.getInstance().warn('Failed to snapshot active session', { error: e }, 'BackgroundService')
        );
    }, 3000) as unknown as number;
    this.snapshotTimers.set(tabId, timer);
  }

  /** Attempt to recover a recording session from its session-storage snapshot. */
  private async recoverActiveSession(tabId: number): Promise<RecordingSession | null> {
    try {
      const stored = await chrome.storage.session.get(this.snapshotKey(tabId));
      const session = stored?.[this.snapshotKey(tabId)] as RecordingSession | undefined;
      if (session) {
        Logger.getInstance().info(
          `Recovered recording session for tab ${tabId} from snapshot (${session.requests?.length ?? 0} requests)`,
          null,
          'BackgroundService'
        );
        return session;
      }
    } catch (error) {
      Logger.getInstance().warn('Failed to recover active session', { error }, 'BackgroundService');
    }
    return null;
  }

  /** Clear a session snapshot and any pending snapshot timer for a tab. */
  private clearSessionSnapshot(tabId: number): void {
    const timer = this.snapshotTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      this.snapshotTimers.delete(tabId);
    }
    chrome.storage.session
      .remove(this.snapshotKey(tabId))
      .catch(() => { /* best-effort cleanup */ });
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
        case 'START_RECORDING': {
          const session = await this.startRecording(message.tabId!);
          sendResponse({ success: true, session });
          break;
        }

        case 'STOP_RECORDING': {
          const harData = await this.stopRecording(message.tabId!);
          sendResponse({ success: true, harData });
          break;
        }

        case 'GET_SESSIONS': {
          const sessions = await this.storageService.getSessions();
          sendResponse({ success: true, sessions });
          break;
        }

        case 'DELETE_SESSION':
          await this.storageService.deleteSession(message.payload.sessionId);
          sendResponse({ success: true });
          break;

        case 'DELETE_REQUESTS':
          await this.storageService.deleteRequestsFromSession(
            message.payload.sessionId,
            message.payload.requestIds
          );
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

        case 'GET_SETTINGS': {
          const settings = await this.storageService.getSettings();
          sendResponse({ success: true, settings });
          break;
        }

        case 'GET_STATUS': {
          const status = this.getStatus(message.tabId!);
          sendResponse({ success: true, status });
          break;
        }

        case 'CONTENT_SCRIPT_READY': {
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
        }

        case 'SAVE_SESSION':
          await this.storageService.saveSession(message.payload.session);
          sendResponse({ success: true });
          break;

        case 'GENERATE_TESTS': {
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
            chrome.storage.session.set({ generationState: state }).catch((e: unknown) => Logger.getInstance().warn('Failed to persist generation state', { error: e }, 'BackgroundService'));
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
              }).catch((e: unknown) => Logger.getInstance().debug('Popup not open for progress update', { error: e }, 'BackgroundService'));
            } catch {
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
            }).catch((e: unknown) => Logger.getInstance().warn('Failed to persist completed generation', { error: e }, 'BackgroundService'));

            sendResponse({ success: true, test: generatedTest });
          } catch (genError) {
            const isCancelled = genError instanceof DOMException && genError.name === 'AbortError';
            if (isCancelled) {
              chrome.storage.session.set({
                generationState: { status: 'cancelled', sessionId, progress: 0, stage: 'Generation cancelled' }
              }).catch(() => {});
              sendResponse({ success: false, cancelled: true });
            } else {
              // Persist error state
              chrome.storage.session.set({
                generationState: {
                  status: 'error',
                  sessionId,
                  progress: 0,
                  stage: 'Failed',
                  error: genError instanceof Error ? genError.message : 'Generation failed',
                }
              }).catch((e: unknown) => Logger.getInstance().warn('Failed to persist generation error', { error: e }, 'BackgroundService'));
              throw genError;
            }
          } finally {
            swManager.stopActiveOperation();
          }
          break;
        }

        case 'CANCEL_GENERATION':
          this.aiService.cancel();
          chrome.storage.session.set({
            generationState: { status: 'cancelled', progress: 0, stage: 'Generation cancelled' }
          }).catch(() => {});
          sendResponse({ success: true });
          break;

        case 'EXPORT_TESTS': {
          const { testId, format } = message.payload;
          const exportContent = await this.exportService.export(testId, format);
          sendResponse({ success: true, content: exportContent });
          break;
        }

        case 'IMPORT_SESSION':
          await this.storageService.saveSession(message.payload);
          sendResponse({ success: true });
          break;

        case 'CLEAR_GENERATION_STATE':
          chrome.storage.session.remove('generationState').catch((e: unknown) => Logger.getInstance().warn('Failed to clear generation state', { error: e }, 'BackgroundService'));
          sendResponse({ success: true });
          break;

        case 'PING':
        case 'HEARTBEAT_PING':
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

      // Non-destructive (plan.md 4.5): we no longer pre-emptively force-detach
      // debuggers belonging to OTHER extensions / DevTools. That was hostile and
      // racy. If the target tab already has a debugger, the attach loop below
      // handles reclaiming our own stale debugger; a genuine third-party
      // conflict surfaces as a clear attach error instead of us stealing the tab.
      const tabDebuggers = attachedTargets.filter(t => t.tabId === tabId);
      if (tabDebuggers.length > 0) {
        Logger.getInstance().warn(
          `Existing debugger detected on target tab ${tabId}; will attempt to reclaim during attach.`,
          null,
          'BackgroundService'
        );
      }

      // Too many active debuggers browser-wide — advise the user rather than act.
      if (attachedTargets.length > 10) {
        Logger.getInstance().warn(`High debugger usage detected (${attachedTargets.length} active)`, null, 'BackgroundService');
        return false;
      }

      return true;
    } catch (error) {
      Logger.getInstance().warn('Could not analyze debugger conflicts', error, 'BackgroundService');
      return true; // Proceed anyway
    }
  }

  async startRecording(tabId: number): Promise<RecordingSession> {
    // Check if already recording, or a start is already in flight for this tab.
    if (this.recordingSessions.has(tabId) || this.startingTabs.has(tabId)) {
      throw new Error('Already recording on this tab');
    }
    // Reserve the tab synchronously before any await so a concurrent
    // START_RECORDING can't pass the guard and double-attach the debugger.
    this.startingTabs.add(tabId);

    try {
      return await this.startRecordingInner(tabId);
    } finally {
      this.startingTabs.delete(tabId);
    }
  }

  private async startRecordingInner(tabId: number): Promise<RecordingSession> {
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
    
    // Prefetch settings BEFORE any capture event can fire. The capture path
    // reads this.cachedSettings synchronously (passesUserFilters); if it were
    // still null when the first request arrives, the user's include/exclude
    // filters would silently no-op. (plan.md 4.2)
    await this.getSettings();

    // Pre-flight debugger conflict resolution
    Logger.getInstance().info(`Starting recording on ${tab.url}`, null, 'BackgroundService');
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
      await this.enableNetworkDomains(tabId);
      console.log('✅ Network monitoring enabled');
    } catch (error) {
      console.error('❌ Failed to enable network monitoring:', error);
      // Detach debugger if network monitoring fails
      await chrome.debugger.detach({ tabId }).catch((e: unknown) => Logger.getInstance().warn('Failed to detach debugger', { error: e, tabId }, 'BackgroundService'));
      throw new Error('Failed to enable network monitoring. Please try again.');
    }

    this.reattachAttempts.delete(tabId);

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
    this.clearSessionSnapshot(tabId); // drop any stale snapshot from a prior run
    this.harProcessor.startSession(session.id);

    // Update extension icon
    await this.updateIcon(tabId, true);

    return session;
  }

  async stopRecording(tabId: number): Promise<HARData> {
    let session = this.recordingSessions.get(tabId);
    if (!session) {
      // The service worker may have been torn down and revived mid-recording,
      // dropping the in-memory session. Try the persisted snapshot before
      // giving up so the user does not lose what was already captured.
      const recovered = await this.recoverActiveSession(tabId);
      if (recovered) {
        session = recovered;
        this.recordingSessions.set(tabId, recovered);
        this.harProcessor.startSession(recovered.id);
        recovered.requests.forEach(req => this.harProcessor.addRequest(recovered.id, req));
      }
    }
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

    // Guaranteed privacy pass: mask request + response data across the whole
    // session before it is finalized into HAR, persisted, or exported.
    await this.maskSessionData(session);

    // Get HAR data (reads from the now-masked session.requests)
    const harData = this.harProcessor.finalize(session);

    // Save session
    await this.storageService.saveSession(session);

    // Save contract snapshots for API contract testing
    try {
      const { ContractSnapshotService } = await import('@/services/ContractSnapshotService');
      const contractService = ContractSnapshotService.getInstance();
      await contractService.saveSnapshots(session);
    } catch (error) {
      Logger.getInstance().warn('Failed to save contract snapshots', { error }, 'BackgroundService');
    }

    // Clean up
    this.recordingSessions.delete(tabId);
    this.clearSessionSnapshot(tabId);
    this.reattachAttempts.delete(tabId);
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

  private rehydrated = false;
  private rehydrating: Promise<void> | null = null;

  /**
   * Repopulate the in-memory recording-session map from session-storage
   * snapshots after a service-worker restart. Without this, a CDP event that
   * wakes the SW mid-recording finds no session and silently drops every
   * event until stopRecording. Idempotent; safe to call on wake.
   */
  async rehydrateActiveSessions(): Promise<void> {
    if (this.rehydrating) return this.rehydrating;
    this.rehydrating = (async () => {
      try {
        const all = await chrome.storage.session.get(null);
        for (const [key, value] of Object.entries(all || {})) {
          if (!key.startsWith('activeSession_')) continue;
          const tabId = Number(key.slice('activeSession_'.length));
          if (!Number.isFinite(tabId) || this.recordingSessions.has(tabId)) continue;
          this.recordingSessions.set(tabId, value as RecordingSession);
          Logger.getInstance().info(
            `Rehydrated recording session for tab ${tabId} after SW restart`,
            null,
            'BackgroundService'
          );
        }
      } catch (error) {
        Logger.getInstance().warn('Failed to rehydrate active sessions', { error }, 'BackgroundService');
      } finally {
        this.rehydrated = true;
      }
    })();
    return this.rehydrating;
  }

  handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params: any
  ): void {
    if (!source.tabId) return;

    const session = this.recordingSessions.get(source.tabId);
    if (!session) {
      // The SW may have restarted and lost the in-memory map. Kick off a
      // one-time rehydration so subsequent events for this tab are captured.
      if (!this.rehydrated) void this.rehydrateActiveSessions();
      return;
    }

    // Process ALL network events for comprehensive capture
    switch (method) {
      // Standard network events
      case 'Network.requestWillBeSent':
        this.handleRequestWillBeSent(session, params);
        break;

      case 'Network.responseReceived':
        this.handleResponseReceived(session, params);
        break;

      // The base request/response events omit the real cookies and several
      // security headers; the *ExtraInfo events carry them. Merge them in.
      case 'Network.requestWillBeSentExtraInfo':
        this.handleRequestExtraInfo(session, params);
        break;

      case 'Network.responseReceivedExtraInfo':
        this.handleResponseExtraInfo(session, params);
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

    // Check if it's an API request with enhanced detection
    if (!isApiRequest(request.url, type, request, initiator)) return;

    // Apply the user's capture filters (include/exclude domains, allowed types).
    if (!passesUserFilters(request.url, this.getRequestType(request, initiator), this.cachedSettings?.filtering)) return;

    // Cap per-session capture so a long recording on a busy SPA can't grow
    // memory (and the periodic session snapshot) without bound. Once at the
    // cap we stop adding new requests and warn once.
    if (session.requests.length >= BackgroundService.MAX_SESSION_REQUESTS) {
      if (!this.sessionCapWarned.has(session.id)) {
        this.sessionCapWarned.add(session.id);
        Logger.getInstance().warn(
          `Session ${session.id} hit the ${BackgroundService.MAX_SESSION_REQUESTS}-request capture cap; further requests are dropped.`,
          null,
          'BackgroundService'
        );
      }
      return;
    }

    const networkRequest: NetworkRequest = {
      id: requestId,
      url: request.url,
      method: request.method,
      type: this.getRequestType(request, initiator),
      timestamp: timestamp * 1000,
      requestHeaders: request.headers,
      requestBody: request.postData
    };

    // Add to session synchronously so that the response/loadingFinished
    // events (which look the request up by id) can always find it. Masking
    // is applied later as a single guaranteed pass in stopRecording — that
    // is the only point at which the request, response headers AND response
    // body are all present, so it is the only safe place to mask. Masking
    // here (before the response arrives) left response data unmasked.
    session.requests.push(networkRequest);
    this.harProcessor.addRequest(session.id, networkRequest);
    this.scheduleSessionSnapshot(session.tabId);
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

  // Merge the real request headers (including Cookie) that the base
  // requestWillBeSent event hides. Best-effort: only enriches an
  // already-captured request; masking of these headers happens later at stop.
  private handleRequestExtraInfo(session: RecordingSession, params: any): void {
    const { requestId, headers } = params;
    if (!requestId || !headers) return;
    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;
    request.requestHeaders = { ...(request.requestHeaders || {}), ...headers };
  }

  // Merge the real response headers (including Set-Cookie + security headers)
  // that the base responseReceived event hides.
  private handleResponseExtraInfo(session: RecordingSession, params: any): void {
    const { requestId, headers } = params;
    if (!requestId || !headers) return;
    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;
    request.responseHeaders = { ...(request.responseHeaders || {}), ...headers };
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
      timestamp: Date.now(),
      // 101 Switching Protocols — synthetic status so this frame-bearing
      // request survives HARProcessor's `filter(req => req.status)`. Without
      // it, all captured WebSocket frames were silently dropped from the HAR.
      status: 101
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

    // Ensure the request carries a status so it is not dropped from the HAR.
    if (!request.status) {
      request.status = 101;
    }

    // Accumulate WebSocket frames as an ordered list of {type,data,timestamp}.
    // HARProcessor.createHAREntry serializes this array to JSON text.
    if (!Array.isArray(request.responseBody)) {
      request.responseBody = [];
    }
    // Cap retained frames so a long-lived socket can't grow memory without
    // bound; keep the most recent frames (drop the oldest).
    if (request.responseBody.length >= BackgroundService.MAX_STREAM_FRAMES) {
      request.responseBody.shift();
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
      if (!result?.body) return null;
      // CDP returns binary/gzipped bodies base64-encoded. Decode them so we
      // don't hand corrupted (base64) text to masking and the LLM; fall back to
      // the raw value if decoding fails.
      if (result.base64Encoded) {
        try {
          return atob(result.body);
        } catch {
          return result.body;
        }
      }
      return result.body;
    } catch {
      // Response body might not be available for all requests
      return null;
    }
  }

  /**
   * Apply the user-configured capture filters (settings.filtering). Runs
   * synchronously against the cached settings during capture; if settings
   * haven't been cached yet the request is allowed through (masking still
   * happens later at stop-recording).
   */
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
        responseBody: [],
        // Synthetic 200 so the SSE stream survives HAR's status filter.
        status: 200
      };
      session.requests.push(sseRequest);
      this.harProcessor.addRequest(session.id, sseRequest);
    }
    
    // Add SSE data to response body
    if (!sseRequest.responseBody) {
      sseRequest.responseBody = [];
    }
    
    if (Array.isArray(sseRequest.responseBody)) {
      // Cap retained SSE events (drop oldest) to bound memory on long streams.
      if (sseRequest.responseBody.length >= BackgroundService.MAX_STREAM_FRAMES) {
        sseRequest.responseBody.shift();
      }
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
  private handleServiceWorkerCreated(_session: RecordingSession, params: any): void {
    // Informational only. Service-worker network traffic is already captured via
    // Network.enable on the target; the previous ServiceWorker.deliverPushMessage
    // call did NOT enable monitoring (it delivers a push message) and was removed.
    console.log('👷 Service Worker created:', params?.url);
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
    const { requestId, _timestamp, dataLength, _encodedDataLength } = params;
    
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
    } catch {
      // Silently continue if icon update fails - it's not critical
      console.log('Note: Icon update not available in this context');
    }
  }

  /**
   * Enable the CDP domains needed for capture. Network.enable is required (its
   * failure propagates); the ServiceWorker / BackgroundService domains are
   * best-effort enhancements. Reused on initial attach and on re-attach.
   */
  private async enableNetworkDomains(tabId: number): Promise<void> {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000,
    });
    try {
      await chrome.debugger.sendCommand({ tabId }, 'ServiceWorker.enable');
    } catch {
      // Optional — older Chrome may not support it.
    }
    try {
      await chrome.debugger.sendCommand({ tabId }, 'BackgroundService.startObserving', { service: 'backgroundFetch' });
      await chrome.debugger.sendCommand({ tabId }, 'BackgroundService.startObserving', { service: 'pushMessaging' });
      await chrome.debugger.sendCommand({ tabId }, 'BackgroundService.startObserving', { service: 'backgroundSync' });
    } catch {
      // Optional.
    }
  }

  /** Re-attach the debugger and re-enable Network after a navigation-induced
   *  detach. Retries briefly because the new renderer target may not be ready
   *  the instant the old one is torn down. Returns true on success. */
  private async reattachDebugger(tabId: number): Promise<boolean> {
    const protocols = ['1.3', '1.2', '1.1'];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // The previous attachment is already gone, but detach defensively in
        // case a stale one lingers; ignore the expected "not attached" error.
        await chrome.debugger.detach({ tabId }).catch(() => { /* not attached */ });

        let attached = false;
        for (const protocol of protocols) {
          try {
            await chrome.debugger.attach({ tabId }, protocol);
            attached = true;
            break;
          } catch {
            // try next protocol
          }
        }
        if (!attached) throw new Error('attach failed for all protocols');

        await this.enableNetworkDomains(tabId);
        Logger.getInstance().info(`Re-attached debugger after navigation (tab ${tabId})`, null, 'BackgroundService');
        return true;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    return false;
  }

  /**
   * Handle a debugger detach. A login flow that redirects/reloads can cause
   * Chrome to swap the renderer target and fire onDetach even though the tab is
   * still open — previously this stopped the recording. We now re-attach
   * transparently so capture survives navigations, and only finalize when the
   * tab is genuinely closed or DevTools takes over the debugger.
   */
  async handleDebuggerDetach(tabId: number, reason?: string): Promise<void> {
    if (!this.recordingSessions.has(tabId)) {
      return; // not recording this tab (or we detached intentionally on stop)
    }

    // DevTools opened on the tab, or the user cancelled — only one debugger can
    // attach, so re-attaching would fail/fight. Finalize what we captured.
    if (reason === 'canceled_by_user') {
      Logger.getInstance().warn(`Debugger taken over (DevTools?) on tab ${tabId} — stopping recording`, null, 'BackgroundService');
      await this.stopRecording(tabId).catch((e: unknown) => Logger.getInstance().error('stopRecording after detach failed', e, 'BackgroundService'));
      return;
    }

    // If the tab is gone, the capture is genuinely over — finalize it.
    let tabExists = false;
    try {
      const tab = await chrome.tabs.get(tabId);
      tabExists = !!tab;
    } catch {
      tabExists = false;
    }
    if (!tabExists) {
      await this.stopRecording(tabId).catch((e: unknown) => Logger.getInstance().error('stopRecording after tab close failed', e, 'BackgroundService'));
      return;
    }

    // Recoverable detach (e.g. navigation/renderer swap): re-attach.
    const attempts = (this.reattachAttempts.get(tabId) || 0) + 1;
    this.reattachAttempts.set(tabId, attempts);
    const MAX_REATTACHES = 5;
    if (attempts > MAX_REATTACHES) {
      Logger.getInstance().warn(`Gave up re-attaching debugger on tab ${tabId} after ${MAX_REATTACHES} attempts — stopping`, null, 'BackgroundService');
      this.reattachAttempts.delete(tabId);
      await this.stopRecording(tabId).catch((e: unknown) => Logger.getInstance().error('stopRecording after reattach exhaustion failed', e, 'BackgroundService'));
      return;
    }

    const ok = await this.reattachDebugger(tabId);
    if (ok) {
      this.reattachAttempts.delete(tabId); // healthy again — reset the counter
    } else if (this.recordingSessions.has(tabId)) {
      // Back off and try again on the next tick; the new page may still be loading.
      setTimeout(() => {
        if (this.recordingSessions.has(tabId)) {
          this.handleDebuggerDetach(tabId, reason).catch(() => { /* logged downstream */ });
        }
      }, 400 * attempts);
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
    }).catch((e: unknown) => Logger.getInstance().warn('Failed to persist parallel generation start', { error: e }, 'BackgroundService'));

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
            }).catch((e: unknown) => Logger.getInstance().warn('Failed to persist parallel progress', { error: e }, 'BackgroundService'));
          }

          try {
            chrome.runtime.sendMessage({
              type: 'PARALLEL_GENERATION_PROGRESS',
              payload: progress
            }).catch((e: unknown) => Logger.getInstance().debug('Popup not open for parallel progress', { error: e }, 'BackgroundService'));
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
      }).catch((e: unknown) => Logger.getInstance().warn('Failed to persist parallel completion', { error: e }, 'BackgroundService'));

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
      }).catch((e: unknown) => Logger.getInstance().warn('Failed to persist parallel generation error', { error: e }, 'BackgroundService'));

      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Parallel generation failed'
      });
    } finally {
      parallelSwManager.stopActiveOperation();
    }
  }

  // Export handlers delegate to ExportController (plan.md 3.6). BackgroundService
  // keeps session resolution + message plumbing; the extraction logic lives in
  // the controller.
  private async handleExportOpenAPI(message: BackgroundMessage, sendResponse: (response?: any) => void): Promise<void> {
    const session = await this.getSessionOrFail(message.payload.sessionId, sendResponse);
    if (!session) return;
    sendResponse(this.exportController.openAPI(session));
  }

  private async handleExportGraphQL(message: BackgroundMessage, sendResponse: (response?: any) => void): Promise<void> {
    const session = await this.getSessionOrFail(message.payload.sessionId, sendResponse);
    if (!session) return;
    sendResponse(this.exportController.graphQL(session));
  }

  private async handleExportEnvFile(message: BackgroundMessage, sendResponse: (response?: any) => void): Promise<void> {
    const session = await this.getSessionOrFail(message.payload.sessionId, sendResponse);
    if (!session) return;
    sendResponse(this.exportController.envFile(session));
  }

  private async handleExportSecurityReport(message: BackgroundMessage, sendResponse: (response?: any) => void): Promise<void> {
    const session = await this.getSessionOrFail(message.payload.sessionId, sendResponse);
    if (!session) return;
    sendResponse(this.exportController.securityReport(session, message.payload.framework));
  }
}