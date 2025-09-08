import { HARData, GenerationOptions, GeneratedTest, AIProvider, AIModel } from '@/types';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { LocalProvider } from './providers/LocalProvider';

export interface LLMProvider {
  generateTests(
    harData: HARData,
    options: GenerationOptions
  ): Promise<GeneratedTest>;
  estimateCost(tokenCount: number, model?: string): number;
  countTokens(text: string): number;
}

export class LLMService {
  private static instance: LLMService;
  private providers: Map<AIProvider, LLMProvider> = new Map();
  private cache: Map<string, GeneratedTest> = new Map();

  private constructor() {
    this.initializeProviders();
  }

  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  private initializeProviders(): void {
    this.providers.set('openai', new OpenAIProvider());
    this.providers.set('anthropic', new AnthropicProvider());
    this.providers.set('gemini', new GeminiProvider());
    this.providers.set('local', new LocalProvider());
  }

  async generateTests(
    harData: HARData,
    options: GenerationOptions
  ): Promise<GeneratedTest> {
    // Check cache first
    const cacheKey = this.getCacheKey(harData, options);
    if (this.cache.has(cacheKey) && options.provider !== 'local') {
      return this.cache.get(cacheKey)!;
    }

    // Get provider
    const provider = this.providers.get(options.provider);
    if (!provider) {
      throw new Error(`Provider ${options.provider} not supported`);
    }

    // Generate tests
    const result = await provider.generateTests(harData, options);

    // Cache result
    if (options.provider !== 'local') {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  estimateCost(
    harData: HARData,
    provider: AIProvider,
    _model: AIModel
  ): { tokens: number; cost: number } {
    const llmProvider = this.providers.get(provider);
    if (!llmProvider) {
      return { tokens: 0, cost: 0 };
    }

    // Estimate tokens based on HAR data
    const harString = JSON.stringify(harData);
    const tokens = llmProvider.countTokens(harString);
    const cost = llmProvider.estimateCost(tokens);

    return { tokens, cost };
  }

  private getCacheKey(harData: HARData, options: GenerationOptions): string {
    const key = {
      entries: harData.entries.length,
      framework: options.framework,
      provider: options.provider,
      model: options.model,
      options: {
        auth: options.includeAuth,
        errors: options.includeErrorScenarios,
        perf: options.includePerformanceTests,
        security: options.includeSecurityTests,
        mock: options.generateMockData,
      },
    };
    return JSON.stringify(key);
  }

  clearCache(): void {
    this.cache.clear();
  }

  buildPrompt(harData: HARData, options: GenerationOptions): string {
    const frameworkInstructions = this.getFrameworkInstructions(options.framework);
    const testTypes = this.getTestTypeInstructions(options);
    const endpointAnalysis = this.analyzeEndpoints(harData);

    return `You are an expert API test engineer with deep knowledge of ${options.framework}.

CRITICAL REQUIREMENT: You MUST generate tests for ALL ${endpointAnalysis.totalEndpoints} unique API endpoints found in the HAR data.

ENDPOINT ANALYSIS:
${endpointAnalysis.summary}

TASK: Generate comprehensive test suites from the provided HAR data.

${frameworkInstructions}

${testTypes}

MANDATORY REQUIREMENTS:
1. Generate tests for ALL ${endpointAnalysis.totalEndpoints} unique endpoints listed above
2. Each endpoint MUST have its own describe block
3. Use proper async/await patterns
4. Include meaningful test descriptions
5. Add proper setup and teardown
6. Use realistic test data (not production data)
7. Follow ${options.framework} best practices
8. Include proper error handling
9. Add data-driven test scenarios where applicable
10. Verify that your output covers ALL endpoints - do not skip any

VERIFICATION: Before completing, ensure you have generated tests for:
${endpointAnalysis.endpointList}

HAR DATA:
${JSON.stringify(harData, null, 2)}

Generate production-ready test code that follows best practices and includes comprehensive coverage for ALL endpoints.`;
  }

  private getFrameworkInstructions(framework: string): string {
    const instructions: Record<string, string> = {
      jest: `JEST FRAMEWORK REQUIREMENTS:
- Use describe blocks for test organization
- Use beforeAll/beforeEach for setup
- Use afterAll/afterEach for cleanup
- Use expect assertions with proper matchers
- Include mock functions where appropriate`,
      
      playwright: `PLAYWRIGHT FRAMEWORK REQUIREMENTS:
- Use test.describe for test organization
- Use test.beforeAll/beforeEach for setup
- Include page object patterns where appropriate
- Use proper selectors and waiting strategies
- Include screenshot assertions for UI tests`,
      
      'mocha-chai': `MOCHA/CHAI FRAMEWORK REQUIREMENTS:
- Use describe blocks for test organization
- Use before/beforeEach hooks for setup
- Use after/afterEach hooks for cleanup
- Use chai expect/should assertions
- Include chai-http for API testing`,
      
      cypress: `CYPRESS FRAMEWORK REQUIREMENTS:
- Use describe blocks for test organization
- Use beforeEach for setup
- Use cy commands for API testing
- Include proper waiting and retry strategies
- Use fixtures for test data`,
      
      puppeteer: `PUPPETEER FRAMEWORK REQUIREMENTS:
- Use describe blocks for test organization
- Include browser and page setup
- Use proper selectors and waiting
- Include screenshot comparisons
- Handle navigation and API interception`,
      
      vitest: `VITEST FRAMEWORK REQUIREMENTS:
- Use describe blocks for test organization
- Use beforeAll/beforeEach for setup
- Use vi for mocking
- Use expect assertions
- Include parallel test execution`,
      
      supertest: `SUPERTEST FRAMEWORK REQUIREMENTS:
- Use describe blocks for test organization
- Import and configure supertest
- Use proper HTTP method chaining
- Include status code assertions
- Add response body validations`,
      
      postman: `POSTMAN COLLECTION REQUIREMENTS:
- Create proper collection structure
- Include pre-request scripts
- Add comprehensive tests in Tests tab
- Use environment variables
- Include response schema validation`,
    };

    return instructions[framework] || instructions.jest;
  }

  private getTestTypeInstructions(options: GenerationOptions): string {
    const instructions: string[] = [];

    if (options.includeAuth) {
      instructions.push(`AUTHENTICATION TESTS:
- Test with valid credentials
- Test with invalid credentials
- Test token expiration
- Test permission levels`);
    }

    if (options.includeErrorScenarios) {
      instructions.push(`ERROR SCENARIO TESTS:
- Test 400 Bad Request scenarios
- Test 401 Unauthorized scenarios
- Test 404 Not Found scenarios
- Test 500 Internal Server Error handling
- Test timeout scenarios`);
    }

    if (options.includePerformanceTests) {
      instructions.push(`PERFORMANCE TESTS:
- Assert response times < 1000ms for standard requests
- Assert response times < 3000ms for complex operations
- Include load testing scenarios
- Test concurrent request handling`);
    }

    if (options.includeSecurityTests) {
      instructions.push(`SECURITY TESTS:
- Test for SQL injection vulnerabilities
- Test for XSS vulnerabilities
- Validate proper CORS headers
- Check for sensitive data exposure
- Test rate limiting`);
    }

    if (options.generateMockData) {
      instructions.push(`MOCK DATA GENERATION:
- Generate realistic test data
- Use faker or similar libraries
- Create edge case data
- Include boundary value testing`);
    }

    return instructions.join('\n\n');
  }

  private analyzeEndpoints(harData: HARData): {
    totalEndpoints: number;
    summary: string;
    endpointList: string;
  } {
    const endpoints = new Map<string, {method: string, path: string, url: string, count: number}>();
    
    harData.entries.forEach(entry => {
      const url = new URL(entry.request.url);
      const signature = `${entry.request.method}:${url.pathname}`;
      
      if (endpoints.has(signature)) {
        endpoints.get(signature)!.count++;
      } else {
        endpoints.set(signature, {
          method: entry.request.method,
          path: url.pathname,
          url: entry.request.url,
          count: 1
        });
      }
    });

    const endpointDetails = Array.from(endpoints.values());
    
    const summary = endpointDetails.map((ep, index) => 
      `${index + 1}. ${ep.method} ${ep.path} (${new URL(ep.url).hostname}) - ${ep.count} request(s)`
    ).join('\n');

    const endpointList = endpointDetails.map(ep => 
      `- ${ep.method} ${ep.path}`
    ).join('\n');

    return {
      totalEndpoints: endpoints.size,
      summary,
      endpointList
    };
  }

  getModelCapabilities(model: AIModel): {
    maxTokens: number;
    costPer1kTokens: number;
    quality: 'high' | 'medium' | 'low';
  } {
    const capabilities: Record<string, any> = {
      'gpt-4o': { maxTokens: 128000, costPer1kTokens: 0.01, quality: 'high' },
      'gpt-4o-mini': { maxTokens: 128000, costPer1kTokens: 0.0003, quality: 'medium' },
      'gpt-4-turbo': { maxTokens: 128000, costPer1kTokens: 0.01, quality: 'high' },
      'gpt-4': { maxTokens: 8192, costPer1kTokens: 0.03, quality: 'high' },
      'gpt-3.5-turbo': { maxTokens: 16384, costPer1kTokens: 0.0015, quality: 'medium' },
      'claude-3.5-sonnet': { maxTokens: 200000, costPer1kTokens: 0.003, quality: 'high' },
      'claude-3-haiku': { maxTokens: 200000, costPer1kTokens: 0.00025, quality: 'medium' },
      'claude-3-opus': { maxTokens: 200000, costPer1kTokens: 0.015, quality: 'high' },
      'gemini-1.5-pro': { maxTokens: 1000000, costPer1kTokens: 0.007, quality: 'high' },
      'gemini-1.5-flash': { maxTokens: 1000000, costPer1kTokens: 0.00035, quality: 'medium' },
      'gemini-pro': { maxTokens: 32000, costPer1kTokens: 0.001, quality: 'medium' },
      'llama-3.1': { maxTokens: 128000, costPer1kTokens: 0, quality: 'medium' },
      'codellama': { maxTokens: 16000, costPer1kTokens: 0, quality: 'low' },
    };

    return (
      capabilities[model] || {
        maxTokens: 4096,
        costPer1kTokens: 0.002,
        quality: 'medium',
      }
    );
  }
}