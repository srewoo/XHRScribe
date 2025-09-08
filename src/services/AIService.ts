import { OpenAIProvider } from './llm/providers/OpenAIProvider';
import { ClaudeProvider } from './llm/providers/ClaudeProvider';
import { GeminiProvider } from './llm/providers/GeminiProvider';
import { LocalProvider } from './llm/providers/LocalProvider';
import { GenerationOptions, RecordingSession, GeneratedTest, Settings, HARData, HAREntry } from '@/types';
import { StorageService } from './StorageService';

export class AIService {
  private static instance: AIService;
  private storageService: StorageService;

  private constructor() {
    this.storageService = StorageService.getInstance();
  }

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  private convertSessionToHAR(session: RecordingSession): HARData {
    const entries: HAREntry[] = session.requests.map(request => ({
      startedDateTime: new Date(request.timestamp).toISOString(),
      time: request.duration || 0,
      request: {
        method: request.method,
        url: request.url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(request.requestHeaders || {}).map(([name, value]) => ({
          name,
          value: String(value)
        })),
        queryString: [],
        postData: request.requestBody ? {
          mimeType: 'application/json',
          text: typeof request.requestBody === 'string' 
            ? request.requestBody 
            : JSON.stringify(request.requestBody)
        } : undefined,
        headersSize: -1,
        bodySize: -1
      },
      response: {
        status: request.status || 200,
        statusText: '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(request.responseHeaders || {}).map(([name, value]) => ({
          name,
          value: String(value)
        })),
        content: {
          size: request.responseSize || 0,
          mimeType: 'application/json',
          text: request.responseBody ? 
            (typeof request.responseBody === 'string' 
              ? request.responseBody 
              : JSON.stringify(request.responseBody)) : undefined
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: request.responseSize || 0
      },
      cache: {},
      timings: {
        blocked: -1,
        dns: -1,
        connect: -1,
        send: 0,
        wait: request.duration || 0,
        receive: 0,
        ssl: -1
      }
    }));

    return {
      version: '1.2',
      creator: {
        name: 'XHRScribe',
        version: '1.0.0'
      },
      entries
    };
  }

  async generateTests(session: RecordingSession, options: GenerationOptions): Promise<GeneratedTest> {
    try {
      // Get settings for API keys
      const settings = await this.storageService.getSettings();
      if (!settings) {
        throw new Error('Settings not found. Please configure your API keys.');
      }

      // Convert RecordingSession to HARData
      const harData = this.convertSessionToHAR(session);
      
      // Validate HAR data completeness
      const validation = this.validateHARCompleteness(harData);
      if (!validation.isComplete) {
        console.warn('HAR data validation warnings:', validation.warnings);
      }
      
      // Log endpoint summary for debugging
      console.log('Generating tests for endpoints:', validation.endpoints);

      // Select the appropriate provider
      let provider;
      let apiKey = '';

      switch (options.provider) {
        case 'openai':
          apiKey = settings.apiKeys.openai || '';
          if (!apiKey) {
            throw new Error('OpenAI API key not configured. Please add it in settings.');
          }
          provider = new OpenAIProvider();
          (provider as any).setApiKey(apiKey); // Use setApiKey method
          break;

        case 'anthropic':
          apiKey = settings.apiKeys.anthropic || '';
          if (!apiKey) {
            throw new Error('Anthropic API key not configured. Please add it in settings.');
          }
          provider = new ClaudeProvider();
          (provider as any).setApiKey(apiKey); // Use setApiKey method
          break;

        case 'gemini':
          apiKey = settings.apiKeys.gemini || '';
          if (!apiKey) {
            throw new Error('Gemini API key not configured. Please add it in settings.');
          }
          provider = new GeminiProvider();
          (provider as any).setApiKey(apiKey); // Use setApiKey method
          break;

        case 'local':
          provider = new LocalProvider();
          break;

        default:
          throw new Error(`Unsupported AI provider: ${options.provider}`);
      }

      // Generate the test code with HARData
      console.log('Generating tests with provider:', options.provider);
      const generatedTest = await provider.generateTests(harData, options);

      // Post-generation validation
      const coverage = this.validateTestCoverage(generatedTest.code, validation.endpoints);
      if (coverage.missingEndpoints.length > 0) {
        console.warn('Missing tests for endpoints:', coverage.missingEndpoints);
        generatedTest.warnings = generatedTest.warnings || [];
        generatedTest.warnings.push(`Missing tests for: ${coverage.missingEndpoints.join(', ')}`);
      }
      
      // Add coverage information to suggestions
      if (coverage.coveredEndpoints.length > 0) {
        generatedTest.suggestions = generatedTest.suggestions || [];
        generatedTest.suggestions.push(`Successfully generated tests for ${coverage.coveredEndpoints.length}/${validation.endpoints.length} endpoints`);
      }

      // The provider already returns a GeneratedTest object
      // Just add/override the ID to ensure uniqueness
      generatedTest.id = `test_${Date.now()}`;

      return generatedTest;
    } catch (error) {
      console.error('Error generating tests:', error);
      throw error;
    }
  }

  private validateHARCompleteness(harData: HARData): {
    isComplete: boolean;
    warnings: string[];
    endpoints: string[];
  } {
    const endpoints = new Set<string>();
    const warnings: string[] = [];
    
    harData.entries.forEach(entry => {
      try {
        const url = new URL(entry.request.url);
        const endpoint = `${entry.request.method} ${url.pathname}`;
        endpoints.add(endpoint);
        
        // Check for potential issues
        if (!entry.response.status) {
          warnings.push(`No status code for ${endpoint}`);
        }
        if (entry.request.method === 'POST' && !entry.request.postData) {
          warnings.push(`POST request without body data: ${endpoint}`);
        }
      } catch (error) {
        warnings.push(`Invalid URL format: ${entry.request.url}`);
        // Still add endpoint with original URL
        const endpoint = `${entry.request.method} ${entry.request.url}`;
        endpoints.add(endpoint);
      }
    });
    
    return {
      isComplete: warnings.length === 0,
      warnings,
      endpoints: Array.from(endpoints)
    };
  }

  private validateTestCoverage(testCode: string, expectedEndpoints: string[]): {
    missingEndpoints: string[];
    coveredEndpoints: string[];
  } {
    const missingEndpoints: string[] = [];
    const coveredEndpoints: string[] = [];
    
    expectedEndpoints.forEach(endpoint => {
      const [method, path] = endpoint.split(' ');
      
      // Create multiple patterns to check for endpoint coverage
      const patterns = [
        // Direct method and path match
        new RegExp(`describe.*${method}.*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        // Path only match (for cases where method is in the path)
        new RegExp(`describe.*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        // Method only with partial path
        new RegExp(`describe.*${method}`, 'i'),
        // URL-based patterns
        new RegExp(`${method.toLowerCase()}.*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
      ];
      
      const isCovered = patterns.some(pattern => pattern.test(testCode));
      
      if (isCovered) {
        coveredEndpoints.push(endpoint);
      } else {
        missingEndpoints.push(endpoint);
      }
    });
    
    return { missingEndpoints, coveredEndpoints };
  }

  // These methods are now handled by the providers themselves
  // Keeping them commented in case we need fallback implementations later
  /*
  private calculateQualityScore(testCode: string): number { ... }
  private estimateTokens(text: string): number { ... }
  private estimateCost(text: string, provider: string): number { ... }
  private analyzeWarnings(testCode: string, options: GenerationOptions): string[] { ... }
  private generateSuggestions(testCode: string, options: GenerationOptions): string[] { ... }
  */
}