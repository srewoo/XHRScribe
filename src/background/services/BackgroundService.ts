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

export class BackgroundService {
  private static instance: BackgroundService;
  private recordingSessions: Map<number, RecordingSession> = new Map();
  private harProcessor: HARProcessor = new HARProcessor();
  private storageService: StorageService = StorageService.getInstance();
  private aiService: AIService = AIService.getInstance();
  private exportService: ExportService = ExportService.getInstance();
  // private requestIdCounter = 0;

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
      aiModel: 'gpt-4o-mini',
      apiKeys: {},
      testFramework: 'jest',
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
          const excludedEndpoints = options.excludedEndpoints ? new Set<string>(options.excludedEndpoints) : undefined;
          
          const generatedTest = await this.aiService.generateTests(targetSession, options, excludedEndpoints);
          sendResponse({ success: true, test: generatedTest });
          break;

        case 'EXPORT_TESTS':
          const { testId, format } = message.payload;
          const exportContent = await this.exportService.export(testId, format);
          sendResponse({ success: true, content: exportContent });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  async startRecording(tabId: number): Promise<RecordingSession> {
    // Check if already recording
    if (this.recordingSessions.has(tabId)) {
      throw new Error('Already recording on this tab');
    }

    // Get tab info
    const tab = await chrome.tabs.get(tabId);
    
    // Attach debugger
    await chrome.debugger.attach({ tabId }, '1.3');
    
    // Enable comprehensive network monitoring
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000
    });
    
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

    // Add to session
    session.requests.push(networkRequest);

    // Process in HAR processor
    this.harProcessor.addRequest(session.id, networkRequest);
  }

  private handleResponseReceived(session: RecordingSession, params: any): void {
    const { requestId, response, timestamp } = params;

    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;

    // Update request with response data
    request.status = response.status;
    request.responseHeaders = response.headers;
    request.duration = (timestamp * 1000) - request.timestamp;

    // Update in HAR processor
    this.harProcessor.updateResponse(session.id, requestId, response);
  }

  private handleLoadingFinished(session: RecordingSession, params: any): void {
    const { requestId, encodedDataLength } = params;

    const request = session.requests.find(r => r.id === requestId);
    if (!request) return;

    request.responseSize = encodedDataLength;

    // Get response body if needed
    this.getResponseBody(session.tabId, requestId).then(body => {
      if (body) {
        request.responseBody = body;
        this.harProcessor.updateResponseBody(session.id, requestId, body);
      }
    }).catch(console.error);
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

    // ENHANCED: Comprehensive API endpoint detection patterns
    const apiPatterns = [
      // Standard API patterns
      '/api/', '/wapi/', '/webapi/', '/v1/', '/v2/', '/v3/', '/v4/', '/v5/', '/graphql', '.json', '.xml',
      '/collect', '/track', '/analytics', '/metrics', '/webhook', '/beacon',
      '.ashx', '.asmx', '.php', '/rest/', '/service/', '/data/',
      '/ccm/', '/g/', '/ping', '/log', '/event', '/submit',
      
      // ADVANCED: Additional business logic endpoints
      '/execute', '/process', '/handle', '/workflow', '/action',
      '/command', '/query', '/search', '/filter', '/validate',
      
      // ENHANCED: Authentication and session endpoints
      '/auth', '/auth/', '/login', '/logout', '/signin', '/signout',
      '/token', '/refresh', '/session', '/user', '/profile',
      
      // ADVANCED: Real-time communication endpoints
      '/sse', '/events', '/stream', '/push', '/live', '/realtime',
      '/ws/', '/websocket', '/socket.io', '/signalr',
      
      // ADVANCED: File operations
      '/upload', '/download', '/export', '/import', '/sync',
      '/backup', '/restore', '/migrate',
      
      // ADVANCED: Microservice patterns
      '/internal/', '/micro/', '/service-', '/lambda/', '/function/',
      '/rpc/', '/grpc/', '/thrift/',
      
      // ADVANCED: API versioning and environments
      '/alpha/', '/beta/', '/canary/', '/preview/', '/staging/',
      '/dev/', '/test/', '/sandbox/',
      
      // ADVANCED: Integration and automation
      '/integration/', '/automation/', '/scheduler/', '/job/',
      '/task/', '/worker/', '/queue/'
    ];
    
    const isApiPattern = apiPatterns.some(pattern => url.includes(pattern));
    const isXhrOrFetch = type === 'XHR' || type === 'Fetch';
    
    // ENHANCED: Content-Type based API detection
    const isApiContentType = this.hasApiContentType(request?.headers || {});
    
    // ENHANCED: Query parameters that indicate API calls
    const hasApiQueryParams = url.includes('?') && (
      url.includes('callback=') || url.includes('format=') || 
      url.includes('api_key=') || url.includes('token=') ||
      url.includes('auth=') || url.includes('key=') ||
      url.includes('id=') || url.includes('data=') ||
      url.includes('query=') || url.includes('filter=') ||
      url.includes('sort=') || url.includes('limit=') ||
      url.includes('offset=') || url.includes('page=')
    );

    // ENHANCED: API domains/subdomains detection
    const apiDomainPatterns = [
      'api.', 'analytics.', 'tracking.', 'metrics.', 'data.',
      'collect.', 'beacon.', 'events.', 'telemetry.',
      'graph.', 'gateway.', 'service.', 'micro.',
      'backend.', 'server.', 'endpoint.', 'rest.'
    ];
    
    const hasApiDomain = apiDomainPatterns.some(pattern => url.includes(pattern));

    // ADVANCED: Single Page Application (SPA) API detection
    const isSpaApiCall = this.isSinglePageAppApiCall(initiator, url);
    
    // ADVANCED: HTTP method based detection (non-GET requests are often APIs)
    const isNonGetMethod = request?.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    
    // ENHANCED: Authentication-specific detection
    const isAuthRelated = this.isAuthenticationRelated(url, request);

    // COMPREHENSIVE: Combine all detection methods
    return isXhrOrFetch || isApiPattern || hasApiQueryParams || hasApiDomain || 
           isApiContentType || isSpaApiCall || isNonGetMethod || isAuthRelated;
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
}