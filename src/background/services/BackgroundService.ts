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
          
          const generatedTest = await this.aiService.generateTests(targetSession, options);
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
    
    // Enable network domain
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000
    });

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

    // Process network events
    switch (method) {
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

      case 'Network.webSocketCreated':
        this.handleWebSocketCreated(session, params);
        break;

      case 'Network.webSocketFrameSent':
      case 'Network.webSocketFrameReceived':
        this.handleWebSocketFrame(session, method, params);
        break;
    }
  }

  private handleRequestWillBeSent(session: RecordingSession, params: any): void {
    const { requestId, request, timestamp, type, initiator } = params;

    // Check if it's an API request
    if (!this.isApiRequest(request.url, type)) return;

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

  private isApiRequest(url: string, type: string): boolean {
    // Filter out static resources
    const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.map', '.wasm'];
    const urlLower = url.toLowerCase();
    
    if (staticExtensions.some(ext => urlLower.includes(ext))) {
      return false;
    }

    // Enhanced API endpoint detection patterns
    const apiPatterns = [
      '/api/', '/v1/', '/v2/', '/v3/', '/v4/', '/graphql', '.json', '.xml',
      '/collect', '/track', '/analytics', '/metrics', '/webhook', '/beacon',
      '.ashx', '.asmx', '.php', '/rest/', '/service/', '/data/',
      '/ccm/', '/g/', '/ping', '/log', '/event', '/submit'
    ];
    
    const isApiPattern = apiPatterns.some(pattern => url.includes(pattern));
    const isXhrOrFetch = type === 'XHR' || type === 'Fetch';
    
    // Check for query parameters that indicate API calls
    const hasApiQueryParams = url.includes('?') && (
      url.includes('callback=') || 
      url.includes('format=') || 
      url.includes('api_key=') ||
      url.includes('token=') ||
      url.includes('auth=') ||
      url.includes('key=') ||
      url.includes('id=') ||
      url.includes('data=')
    );

    // Check for common API domains/subdomains
    const apiDomainPatterns = [
      'api.', 'analytics.', 'tracking.', 'metrics.', 'data.',
      'collect.', 'beacon.', 'events.', 'telemetry.'
    ];
    
    const hasApiDomain = apiDomainPatterns.some(pattern => url.includes(pattern));

    return isXhrOrFetch || isApiPattern || hasApiQueryParams || hasApiDomain;
  }

  private getRequestType(request: any, initiator: any): NetworkRequest['type'] {
    if (request.url.includes('/graphql')) return 'GraphQL';
    if (initiator?.type === 'xmlhttprequest') return 'XHR';
    if (initiator?.type === 'fetch') return 'Fetch';
    if (request.method === 'WebSocket') return 'WebSocket';
    return 'Fetch'; // Default
  }

  private async updateIcon(tabId: number, recording: boolean): Promise<void> {
    const path = recording ? {
      16: '/icons/icon16-recording.png',
      32: '/icons/icon32-recording.png',
      48: '/icons/icon48-recording.png',
      128: '/icons/icon128-recording.png'
    } : {
      16: '/icons/icon16.png',
      32: '/icons/icon32.png',
      48: '/icons/icon48.png',
      128: '/icons/icon128.png'
    };

    try {
      await chrome.action.setIcon({ tabId, path });
      await chrome.action.setTitle({ 
        tabId, 
        title: recording ? 'XHRScribe - Recording...' : 'XHRScribe - Click to start recording' 
      });
    } catch (error) {
      console.warn('Failed to update icon:', error);
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