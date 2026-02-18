export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status?: number;
  type: 'XHR' | 'Fetch' | 'WebSocket' | 'GraphQL' | 'gRPC';
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
  | 'postman'
  | 'restassured'
  | 'k6'
  | 'artillery'
  | 'pactum'
  | 'karate'
  | 'pytest'
  | 'httpx';

export type AIProvider = 
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'local';

export type AIModel = 
  // OpenAI Models (Latest)
  | 'gpt-4.1'           // Most capable, multimodal
  | 'gpt-4.1-mini'      // Smaller, faster, cheaper
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
  // New parallel generation options
  parallelGeneration?: ParallelGenerationOptions;
}

export interface ParallelGenerationOptions {
  enabled: boolean;
  maxConcurrency: number;
  enableAssertions: boolean;
  enablePerformance: boolean;
  enableOpenAPI: boolean;
  enableGraphQL: boolean;
  enableScenarios: boolean;
  enableDataDriven: boolean;
  enableSecurity: boolean;
  enableAutoHealing: boolean;
  enableEnvironment: boolean;
}

export interface GenerationProgressCallback {
  (current: number, total: number, stage: string, endpoint?: string): void;
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
    | 'GENERATE_PARALLEL'
    | 'UPDATE_SETTINGS'
    | 'GET_SETTINGS'
    | 'EXPORT_TESTS'
    | 'EXPORT_OPENAPI'
    | 'EXPORT_GRAPHQL_SCHEMA'
    | 'EXPORT_ENV_FILE'
    | 'EXPORT_SECURITY_REPORT'
    | 'GET_STATUS'
    | 'SAVE_SESSION'
    | 'IMPORT_SESSION'
    | 'PING'
    | 'HEARTBEAT_PING'
    | 'CHECK_READY'
    | 'GENERATION_PROGRESS'
    | 'DIFF_SESSIONS'
    | 'CLEAR_GENERATION_STATE';
}

// WebSocket Frame Types
export interface ParsedWebSocketFrame {
  direction: 'sent' | 'received';
  data: string;
  timestamp: number;
  parsedData?: any;
  dataType: 'json' | 'text' | 'binary';
  size: number;
  eventType?: string;
  channel?: string;
}

export interface WebSocketFrameStats {
  totalFrames: number;
  sentFrames: number;
  receivedFrames: number;
  jsonFrames: number;
  totalBytes: number;
  eventTypes: string[];
  channels: string[];
  durationMs: number;
}

// Endpoint Grouping Types
export type EndpointCategory =
  | 'Auth' | 'CRUD' | 'Search' | 'Upload' | 'Webhook'
  | 'Admin' | 'Health' | 'Streaming' | 'GraphQL' | 'Other';

export interface EndpointGroup {
  resource: string;
  category: EndpointCategory;
  normalizedPath: string;
  methods: string[];
  isCrud: boolean;
  requestCount: number;
  endpoints: Array<{ method: string; path: string; count: number; statuses: number[] }>;
}

// Protobuf/gRPC Types
export interface ProtobufField {
  fieldNumber: number;
  wireType: number;
  wireTypeName: string;
  value: string | number | Uint8Array;
}

export interface ProtobufDecodeResult {
  success: boolean;
  fields: ProtobufField[];
  error?: string;
  rawHex?: string;
}

// Session Diff Types
export interface EndpointDiff {
  signature: string;
  method: string;
  path: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  changes?: {
    statusCodeChanged?: { from: number[]; to: number[] };
    durationChanged?: { from: number; to: number };
    responseSchemaChanged?: { addedKeys: string[]; removedKeys: string[] };
  };
  countA?: number;
  countB?: number;
}

export interface SessionDiffResult {
  sessionA: { id: string; name: string };
  sessionB: { id: string; name: string };
  added: EndpointDiff[];
  removed: EndpointDiff[];
  modified: EndpointDiff[];
  unchanged: EndpointDiff[];
  summary: { total: number; added: number; removed: number; modified: number; unchanged: number };
}

// Traffic Replay Types
export interface ReplayConfig {
  baseUrl?: string;
  delayMs: number;
  includeHeaders: boolean;
  skipPatterns: string[];
}

export interface ReplayResult {
  requestUrl: string;
  method: string;
  originalStatus: number;
  replayStatus: number;
  originalDuration: number;
  replayDuration: number;
  matched: boolean;
  error?: string;
}

export interface ReplaySessionResult {
  results: ReplayResult[];
  passed: number;
  failed: number;
  errors: number;
  avgOriginalDuration: number;
  avgReplayDuration: number;
}

export interface ContentMessage extends Message {
  type:
    | 'PING'
    | 'INJECT_SCRIPT'
    | 'CAPTURE_CONSOLE';
}