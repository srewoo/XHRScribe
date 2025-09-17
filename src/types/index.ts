export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status?: number;
  type: 'XHR' | 'Fetch' | 'WebSocket' | 'GraphQL';
  timestamp: number;
  duration?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: any;
  responseBody?: any;
  responseSize?: number;
  error?: string;
  metadata?: {
    isStreaming?: boolean;
    chunks?: number;
    priority?: string;
    priorityChanged?: number;
    isBackground?: boolean;
    serviceWorker?: string;
    [key: string]: any;
  };
}

export interface RecordingSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  requests: NetworkRequest[];
  tabId: number;
  url: string;
  status: 'recording' | 'stopped' | 'processing';
  metadata?: {
    totalRequests?: number;
    apiRequests?: number;
    responseTime?: number;
    [key: string]: any;
  };
}

export interface HAREntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    cookies: any[];
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    postData?: {
      mimeType: string;
      text?: string;
      params?: Array<{ name: string; value: string }>;
    };
    headersSize: number;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: any[];
    headers: Array<{ name: string; value: string }>;
    content: {
      size: number;
      mimeType: string;
      text?: string;
      encoding?: string;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: {};
  timings: {
    blocked: number;
    dns: number;
    connect: number;
    send: number;
    wait: number;
    receive: number;
    ssl: number;
  };
}

export interface HARData {
  version: string;
  creator: {
    name: string;
    version: string;
  };
  entries: HAREntry[];
}

export type TestFramework = 
  | 'jest'
  | 'playwright'
  | 'mocha-chai'
  | 'mocha'
  | 'cypress'
  | 'puppeteer'
  | 'vitest'
  | 'supertest'
  | 'postman';

export type AIProvider = 
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'local';

export type AIModel = 
  // OpenAI Models (Latest)
  | 'gpt-4o'           // Most capable, multimodal
  | 'gpt-4o-mini'      // Smaller, faster, cheaper
  | 'gpt-4-turbo'      // Latest GPT-4 Turbo
  | 'gpt-3.5-turbo'    // Fast and cheap
  // Anthropic Claude Models (Latest)
  | 'claude-4-sonnet'            // Latest Claude 4 model
  | 'claude-3-7-sonnet'          // Claude 3.7 Sonnet  
  | 'claude-3-5-sonnet-20241022' // Claude 3.5 Sonnet
  | 'claude-3-opus-20240229'     // Legacy - Most capable Claude 3 model
  | 'claude-3-sonnet-20240229'   // Legacy - Balanced performance
  | 'claude-3-haiku-20240307'    // Legacy - Fast and cheap
  // Google Gemini Models (Latest)
  | 'gemini-2-5-pro'          // Latest Gemini 2.5 Pro
  | 'gemini-2-5-flash'        // Latest Gemini 2.5 Flash
  | 'gemini-1.5-pro-latest'   // Legacy - 2M context
  | 'gemini-1.5-flash'        // Legacy - Fast, efficient
  | 'gemini-1.5-flash-8b'     // Legacy - Smaller, faster
  // Local Models
  | 'llama-3.2'        // Latest Llama
  | 'codellama-70b'    // Code-specific
  | 'mixtral-8x7b'     // MoE model
  | 'deepseek-coder'   // Code-specific;

export interface GenerationOptions {
  framework: TestFramework;
  provider: AIProvider;
  model: AIModel;
  includeAuth: boolean;
  includeErrorScenarios: boolean;
  includePerformanceTests: boolean;
  includeSecurityTests: boolean;
  generateMockData: boolean;
  includeEdgeCases?: boolean;
  includeIntegrationTests?: boolean;
  includeNullTests?: boolean;
  includeBoundaryTests?: boolean;
  includeDataTypeTests?: boolean;
  includeConcurrencyTests?: boolean;
  includeIdempotencyTests?: boolean;
  testCoverage?: 'exhaustive' | 'standard' | 'minimal';
  complexity: 'basic' | 'intermediate' | 'advanced';
  customPrompt?: string;
}

export interface GeneratedTest {
  id: string;
  framework: TestFramework;
  code: string;
  qualityScore: number;
  estimatedTokens: number;
  estimatedCost: number;
  warnings?: string[];
  suggestions?: string[];
  metadata?: {
    generationMode?: 'batch' | 'individual';
    endpointsProcessed?: number;
    authFlow?: any;
    [key: string]: any;
  };
}

export interface Settings {
  aiProvider: AIProvider;
  aiModel: AIModel;
  apiKeys: {
    openai?: string;
    anthropic?: string;
    gemini?: string;
  };
  testFramework: TestFramework;
  privacyMode: 'local' | 'cloud' | 'hybrid';
  authGuide?: string; // Custom authentication instructions for LLM
  dataMasking: {
    enabled: boolean;
    maskPII: boolean;
    maskTokens: boolean;
    maskEmails: boolean;
    customPatterns: string[];
  };
  filtering: {
    includeDomains: string[];
    excludeDomains: string[];
    includeTypes: string[];
    minDuration: number;
    maxRequestSize: number;
  };
  advanced: {
    maxTokens: number;
    temperature: number;
    retryAttempts: number;
    timeout: number;
    cacheResponses: boolean;
  };
}

export interface AppState {
  recording: boolean;
  currentSession?: RecordingSession;
  sessions: RecordingSession[];
  settings: Settings;
  loading: boolean;
  error?: string;
}

export interface Message {
  type: string;
  payload?: any;
  error?: string;
  tabId?: number;
}

export interface BackgroundMessage extends Message {
  type: 
    | 'START_RECORDING'
    | 'STOP_RECORDING'
    | 'GET_SESSIONS'
    | 'DELETE_SESSION'
    | 'RENAME_SESSION'
    | 'GENERATE_TESTS'
    | 'UPDATE_SETTINGS'
    | 'GET_SETTINGS'
    | 'EXPORT_TESTS'
    | 'GET_STATUS'
    | 'SAVE_SESSION';
}

export interface ContentMessage extends Message {
  type:
    | 'PING'
    | 'INJECT_SCRIPT'
    | 'CAPTURE_CONSOLE';
}