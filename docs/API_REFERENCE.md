# XHRscribe API Reference

## 🎯 Core Services API

### TestGenerationService

The main service for orchestrating test generation workflows.

#### Methods

##### `generateFromSession(session, options, settings)`
Generates tests from a recording session.

**Parameters:**
- `session: RecordingSession` - The recorded session data
- `options: TestGenerationOptions` - Generation configuration
- `settings: ExtensionSettings` - User settings and preferences

**Returns:** `Promise<GeneratedTest>`

**Example:**
```typescript
const testService = new TestGenerationService();
const generatedTest = await testService.generateFromSession(
  session,
  {
    includeErrorScenarios: true,
    generateRealisticData: true,
    includeAuthenticationTests: true,
    testComplexity: 'intermediate'
  },
  settings
);
```

##### `estimateCost(session, options, settings)`
Estimates the cost of test generation.

**Parameters:**
- `session: RecordingSession` - The session to analyze
- `options: TestGenerationOptions` - Generation options
- `settings: ExtensionSettings` - User settings

**Returns:** `Promise<CostInfo>`

##### `exportTest(test, format, destination)`
Exports generated tests in various formats.

**Parameters:**
- `test: GeneratedTest` - The test to export
- `format: 'file' | 'clipboard' | 'vscode'` - Export format
- `destination?: string` - Optional destination path

**Returns:** `Promise<boolean>`

### LLMService

Manages multiple LLM providers and test generation requests.

#### Methods

##### `generateTests(request)`
Generates tests using the configured LLM provider.

**Parameters:**
- `request: TestGenerationRequest` - Complete test generation request

**Returns:** `Promise<TestGenerationResponse>`

##### `switchProvider(provider, apiKey, model)`
Switches to a different LLM provider.

**Parameters:**
- `provider: LLMProvider` - Provider name
- `apiKey: string` - API key for the provider
- `model: string` - Model to use

**Returns:** `Promise<boolean>`

##### `getAvailableModels(provider)`
Gets available models for a provider.

**Parameters:**
- `provider: LLMProvider` - Provider to query

**Returns:** `string[]`

### AnalyticsService

Tracks usage metrics and provides insights.

#### Methods

##### `track(event, properties, sessionId?)`
Tracks a custom event.

**Parameters:**
- `event: string` - Event name
- `properties: Record<string, any>` - Event properties
- `sessionId?: string` - Optional session ID

**Returns:** `void`

##### `getUsageMetrics()`
Gets comprehensive usage metrics.

**Returns:** `UsageMetrics`

##### `getPerformanceInsights()`
Gets performance insights and recommendations.

**Returns:** `PerformanceInsights`

## 🔧 Type Definitions

### Core Types

#### `TestGenerationOptions`
```typescript
interface TestGenerationOptions {
  includeErrorScenarios: boolean;
  generateRealisticData: boolean;
  includePerformanceAssertions: boolean;
  groupByEndpoint: boolean;
  includeSetupTeardown: boolean;
  customAssertions: string[];
  
  // Enhanced options
  includeAuthenticationTests: boolean;
  generateDataValidationTests: boolean;
  includeRetryLogic: boolean;
  generateMockData: boolean;
  testComplexity: 'basic' | 'intermediate' | 'advanced';
  includeSecurityTests: boolean;
  generateLoadTests: boolean;
  customPromptTemplates: PromptTemplate[];
}
```

#### `TestMetadata`
```typescript
interface TestMetadata {
  framework: TestFramework;
  totalTests: number;
  coverage: {
    endpoints: number;
    methods: number;
    statusCodes: number;
    authenticationScenarios: number;
    errorScenarios: number;
  };
  qualityScore: number;
  generationTime: number;
  testCategories: TestCategory[];
  complexityAnalysis: ComplexityAnalysis;
  recommendedImprovements: string[];
  estimatedExecutionTime: number;
  tokenUsage?: number;
}
```

#### `ComplexityAnalysis`
```typescript
interface ComplexityAnalysis {
  overall: 'low' | 'medium' | 'high';
  factors: {
    endpointCount: number;
    methodVariety: number;
    authenticationComplexity: 'none' | 'basic' | 'advanced';
    dataComplexity: 'simple' | 'moderate' | 'complex';
    errorScenarios: number;
  };
  recommendations: string[];
}
```

#### `GeneratedTest`
```typescript
interface GeneratedTest {
  id: string;
  sessionId: string;
  code: string;
  metadata: TestMetadata;
  createdAt: Date;
  framework: TestFramework;
  exported: boolean;
}
```

### LLM Provider Types

#### `TestGenerationRequest`
```typescript
interface TestGenerationRequest {
  harData: HARFile;
  settings: ExtensionSettings;
  sessionId: string;
  options: TestGenerationOptions;
}
```

#### `TestGenerationResponse`
```typescript
interface TestGenerationResponse {
  success: boolean;
  testCode: string;
  metadata: TestMetadata;
  warnings: string[];
  errors: string[];
  cost?: CostInfo;
}
```

#### `CostInfo`
```typescript
interface CostInfo {
  provider: string;
  tokensUsed: number;
  estimatedCost: number;
  currency: string;
}
```

### Analytics Types

#### `UsageMetrics`
```typescript
interface UsageMetrics {
  totalSessions: number;
  totalTests: number;
  averageTestsPerSession: number;
  frameworkUsage: Record<TestFramework, number>;
  providerUsage: Record<string, number>;
  totalCost: number;
  averageQualityScore: number;
  timeRange: {
    start: Date;
    end: Date;
  };
}
```

#### `AnalyticsEvent`
```typescript
interface AnalyticsEvent {
  event: string;
  properties: Record<string, any>;
  timestamp: Date;
  sessionId: string;
  userId: string;
}
```

## 🎨 UI Components API

### RecordingTab

Main component for recording sessions.

#### Props
```typescript
interface RecordingTabProps {
  onSessionStart?: (session: RecordingSession) => void;
  onSessionStop?: (session: RecordingSession) => void;
  onSessionPause?: (session: RecordingSession) => void;
}
```

### TestsTab

Component for managing generated tests.

#### Props
```typescript
interface TestsTabProps {
  onTestGenerate?: (test: GeneratedTest) => void;
  onTestExport?: (test: GeneratedTest, format: string) => void;
  onTestDelete?: (testId: string) => void;
}
```

### SettingsTab

Component for extension configuration.

#### Props
```typescript
interface SettingsTabProps {
  onSettingsChange?: (settings: ExtensionSettings) => void;
  onProviderTest?: (provider: LLMProvider) => Promise<boolean>;
}
```

## 🔌 Extension APIs

### Chrome Extension Integration

#### Background Script
```typescript
// Listen for recording events
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Network.responseReceived') {
    // Process network response
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_RECORDING':
      // Start recording logic
      break;
    case 'STOP_RECORDING':
      // Stop recording logic
      break;
  }
});
```

#### Content Script
```typescript
// Inject recording capabilities
window.addEventListener('beforeunload', () => {
  // Save session data
});

// Monitor network requests
const originalFetch = window.fetch;
window.fetch = function(...args) {
  // Intercept and log fetch requests
  return originalFetch.apply(this, args);
};
```

## 🔒 Security APIs

### Encryption Service

#### Methods

##### `encrypt(data, key?)`
Encrypts sensitive data using AES-256.

**Parameters:**
- `data: string` - Data to encrypt
- `key?: string` - Optional encryption key

**Returns:** `string` - Encrypted data

##### `decrypt(encryptedData, key?)`
Decrypts encrypted data.

**Parameters:**
- `encryptedData: string` - Data to decrypt
- `key?: string` - Optional decryption key

**Returns:** `string` - Decrypted data

### Data Masking Service

#### Methods

##### `maskSensitiveData(data, rules?)`
Masks sensitive information in data.

**Parameters:**
- `data: any` - Data to mask
- `rules?: MaskingRule[]` - Custom masking rules

**Returns:** `any` - Masked data

##### `detectPII(text)`
Detects personally identifiable information.

**Parameters:**
- `text: string` - Text to analyze

**Returns:** `PIIDetectionResult[]`

## 🌐 Browser Compatibility APIs

### Feature Detection

#### Methods

##### `isFeatureSupported(feature)`
Checks if a browser feature is supported.

**Parameters:**
- `feature: string` - Feature to check

**Returns:** `boolean`

##### `getBrowserCapabilities()`
Gets comprehensive browser capability information.

**Returns:** `BrowserCapabilities`

### Cross-Browser Utilities

#### Methods

##### `normalizeAPI(apiName, params)`
Normalizes API calls across different browsers.

**Parameters:**
- `apiName: string` - API name
- `params: any` - API parameters

**Returns:** `Promise<any>`

## 📊 Performance APIs

### Performance Monitoring

#### Methods

##### `startPerformanceTracking(operation)`
Starts tracking performance for an operation.

**Parameters:**
- `operation: string` - Operation name

**Returns:** `PerformanceTracker`

##### `getPerformanceMetrics()`
Gets current performance metrics.

**Returns:** `PerformanceMetrics`

### Memory Management

#### Methods

##### `optimizeMemoryUsage()`
Optimizes memory usage by cleaning up unused resources.

**Returns:** `Promise<void>`

##### `getMemoryUsage()`
Gets current memory usage statistics.

**Returns:** `MemoryUsage`

## 🔧 Configuration APIs

### Settings Management

#### Methods

##### `getSettings()`
Gets current extension settings.

**Returns:** `Promise<ExtensionSettings>`

##### `updateSettings(settings)`
Updates extension settings.

**Parameters:**
- `settings: Partial<ExtensionSettings>` - Settings to update

**Returns:** `Promise<void>`

##### `resetSettings()`
Resets settings to default values.

**Returns:** `Promise<void>`

### Provider Configuration

#### Methods

##### `configureProvider(provider, config)`
Configures an LLM provider.

**Parameters:**
- `provider: LLMProvider` - Provider to configure
- `config: ProviderConfig` - Provider configuration

**Returns:** `Promise<boolean>`

##### `testProviderConnection(provider)`
Tests connection to an LLM provider.

**Parameters:**
- `provider: LLMProvider` - Provider to test

**Returns:** `Promise<boolean>`

## 🚀 Export APIs

### Test Export

#### Methods

##### `exportToFile(test, format, filename?)`
Exports test to a file.

**Parameters:**
- `test: GeneratedTest` - Test to export
- `format: string` - Export format
- `filename?: string` - Optional filename

**Returns:** `Promise<boolean>`

##### `exportToClipboard(test, format)`
Exports test to clipboard.

**Parameters:**
- `test: GeneratedTest` - Test to export
- `format: string` - Export format

**Returns:** `Promise<boolean>`

##### `exportToVSCode(test, projectPath?)`
Exports test directly to VSCode.

**Parameters:**
- `test: GeneratedTest` - Test to export
- `projectPath?: string` - Optional project path

**Returns:** `Promise<boolean>`

## 🔍 Debugging APIs

### Debug Utilities

#### Methods

##### `enableDebugMode(level)`
Enables debug mode with specified level.

**Parameters:**
- `level: 'info' | 'warn' | 'error' | 'debug'` - Debug level

**Returns:** `void`

##### `getDebugLogs(filter?)`
Gets debug logs with optional filtering.

**Parameters:**
- `filter?: LogFilter` - Optional log filter

**Returns:** `DebugLog[]`

##### `exportDebugData()`
Exports debug data for troubleshooting.

**Returns:** `Promise<string>`
