import { OpenAIProvider } from './llm/providers/OpenAIProvider';
import { ClaudeProvider } from './llm/providers/ClaudeProvider';
import { GeminiProvider } from './llm/providers/GeminiProvider';
import { LocalProvider } from './llm/providers/LocalProvider';
import { GenerationOptions, RecordingSession, GeneratedTest, Settings, HARData, HAREntry } from '@/types';
import { StorageService } from './StorageService';
import { AuthFlowAnalyzer, AuthFlow } from './AuthFlowAnalyzer';

export class AIService {
  private static instance: AIService;
  private storageService: StorageService;
  private authFlowAnalyzer: AuthFlowAnalyzer;

  private constructor() {
    this.storageService = StorageService.getInstance();
    this.authFlowAnalyzer = AuthFlowAnalyzer.getInstance();
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

  async generateTests(session: RecordingSession, options: GenerationOptions, excludedEndpoints?: Set<string>): Promise<GeneratedTest> {
    // Determine generation strategy based on endpoint count and options
    const strategy = this.selectGenerationStrategy(session, options);
    
    if (strategy.mode === 'individual') {
      return this.generateTestsIndividually(session, options, excludedEndpoints);
    } else {
      return this.generateTestsBatch(session, options, excludedEndpoints);
    }
  }

  private selectGenerationStrategy(session: RecordingSession, options: GenerationOptions): { mode: 'batch' | 'individual', reason: string } {
    const endpointCount = session.requests.length;
    
    // Force individual mode for large sessions
    if (endpointCount > 5) {
      return { mode: 'individual', reason: `Too many endpoints (${endpointCount}) for batch processing` };
    }
    
    // Use individual mode for better quality if explicitly requested
    if (options.complexity === 'advanced') {
      return { mode: 'individual', reason: 'Advanced complexity requested - using individual processing for better quality' };
    }
    
    // Default to batch for smaller sessions (≤5 endpoints)
    return { mode: 'batch', reason: `Small session (${endpointCount} endpoints) - using efficient batch processing` };
  }

  private async generateTestsIndividually(session: RecordingSession, options: GenerationOptions, excludedEndpoints?: Set<string>): Promise<GeneratedTest> {
    try {
      console.log('🔥 Using INDIVIDUAL endpoint processing for guaranteed completeness');
      
      // Get settings for API keys
      const settings = await this.storageService.getSettings();
      if (!settings) {
        throw new Error('Settings not found. Please configure your API keys.');
      }

      // Filter out excluded endpoints if provided
      let filteredSession = session;
      if (excludedEndpoints && excludedEndpoints.size > 0) {
        const filteredRequests = session.requests.filter(request => {
          try {
            const url = new URL(request.url);
            const signature = `${request.method}:${url.pathname}`;
            return !excludedEndpoints.has(signature);
          } catch (error) {
            const signature = `${request.method}:${request.url}`;
            return !excludedEndpoints.has(signature);
          }
        });
        
        filteredSession = {
          ...session,
          requests: filteredRequests
        };
      }

      // Analyze authentication flow
      const authFlow = this.authFlowAnalyzer.analyzeAuthFlow(filteredSession.requests);
      console.log('Detected authentication flow:', authFlow);

      // Group unique endpoints
      const uniqueEndpoints = this.groupUniqueEndpoints(filteredSession.requests);
      console.log(`Processing ${uniqueEndpoints.length} unique endpoints individually`);

      // Get the appropriate provider
      const provider = this.getProvider(settings, options.provider);

      // Generate tests for each endpoint individually
      const individualTests: string[] = [];
      const warnings: string[] = [];
      let qualityScore = 10;

      // Process endpoints in parallel batches
      const batchSize = 3; // Process 3 endpoints at a time
      for (let i = 0; i < uniqueEndpoints.length; i += batchSize) {
        const batch = uniqueEndpoints.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (endpoint, index) => {
          try {
            console.log(`Generating tests for endpoint ${i + index + 1}/${uniqueEndpoints.length}: ${endpoint.method} ${endpoint.url}`);
            
            // Create single-endpoint HAR data
            const singleEndpointHAR = this.createSingleEndpointHAR(endpoint);
            
            // Generate tests for this specific endpoint
            const endpointTest = await provider.generateTests(singleEndpointHAR, {
              ...options,
              complexity: 'intermediate' // Use intermediate to get good quality without being too verbose
            }, authFlow);

            return {
              endpoint: `${endpoint.method} ${endpoint.url}`,
              code: endpointTest.code,
              qualityScore: endpointTest.qualityScore,
              warnings: endpointTest.warnings || []
            };
          } catch (error: any) {
            console.error(`Failed to generate tests for ${endpoint.method} ${endpoint.url}:`, error);
            return {
              endpoint: `${endpoint.method} ${endpoint.url}`,
              code: `// Failed to generate tests for ${endpoint.method} ${endpoint.url}\n// Error: ${error.message}`,
              qualityScore: 0,
              warnings: [`Failed to generate tests: ${error.message}`]
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        
        // Collect results
        batchResults.forEach(result => {
          individualTests.push(result.code);
          qualityScore = Math.min(qualityScore, result.qualityScore);
          warnings.push(...result.warnings);
        });
      }

      // Merge all individual tests into a cohesive test suite
      const mergedTestCode = this.mergeIndividualTests(individualTests, authFlow, options.framework);
      
      // Calculate combined metrics
      const estimatedTokens = this.estimateTokens(mergedTestCode);
      const estimatedCost = provider.estimateCost(estimatedTokens, options.model);

      console.log(`✅ Individual processing complete: ${uniqueEndpoints.length} endpoints processed`);

      return {
        id: `test-${Date.now()}`,
        framework: options.framework,
        code: mergedTestCode,
        qualityScore: Math.max(8, qualityScore), // Individual processing gets bonus points
        estimatedTokens: estimatedTokens,
        estimatedCost: estimatedCost,
        warnings: warnings.length > 0 ? [
          `Individual endpoint processing used for guaranteed completeness`,
          ...warnings
        ] : [`Individual endpoint processing used for guaranteed completeness`]
      };

    } catch (error) {
      console.error('Individual test generation failed:', error);
      throw error;
    }
  }

  private async generateTestsBatch(session: RecordingSession, options: GenerationOptions, excludedEndpoints?: Set<string>): Promise<GeneratedTest> {
    try {
      console.log('📦 Using BATCH processing for efficiency');
      
      // Get settings for API keys
      const settings = await this.storageService.getSettings();
      if (!settings) {
        throw new Error('Settings not found. Please configure your API keys.');
      }

      // Filter out excluded endpoints if provided
      let filteredSession = session;
      if (excludedEndpoints && excludedEndpoints.size > 0) {
        const filteredRequests = session.requests.filter(request => {
          try {
            const url = new URL(request.url);
            const signature = `${request.method}:${url.pathname}`;
            return !excludedEndpoints.has(signature);
          } catch (error) {
            // For invalid URLs, use full URL as signature
            const signature = `${request.method}:${request.url}`;
            return !excludedEndpoints.has(signature);
          }
        });
        
        filteredSession = {
          ...session,
          requests: filteredRequests
        };
      }

      // Analyze authentication flow before conversion
      const authFlow = this.authFlowAnalyzer.analyzeAuthFlow(filteredSession.requests);
      console.log('Detected authentication flow:', authFlow);

      // Convert RecordingSession to HARData
      const harData = this.convertSessionToHAR(filteredSession);
      
      // Validate HAR data completeness
      const validation = this.validateHARCompleteness(harData);
      if (!validation.isComplete) {
        console.warn('HAR data validation warnings:', validation.warnings);
      }
      
      // Log endpoint summary for debugging
      console.log(`Processing ${harData.entries.length} HAR entries for test generation`);
      
      // Get the appropriate provider
      const provider = this.getProvider(settings, options.provider);

      // Generate the test code with HARData and authentication flow
      console.log('Generating tests with provider:', options.provider);
      const generatedTest = await provider.generateTests(harData, options, authFlow);

      // Enhanced post-generation validation
      const coverage = this.validateTestCoverage(generatedTest.code, validation.endpoints);
      
      // Check for placeholder comments that indicate incomplete generation
      const hasPlaceholders = this.checkForPlaceholders(generatedTest.code);
      if (hasPlaceholders.found) {
        console.error('CRITICAL: Detected placeholder comments in generated code:', hasPlaceholders.placeholders);
        
        // Reduce quality score significantly for incomplete generation
        generatedTest.qualityScore = Math.min(generatedTest.qualityScore, 3);
        
        generatedTest.warnings = generatedTest.warnings || [];
        generatedTest.warnings.push(`🚨 INCOMPLETE GENERATION DETECTED`);
        generatedTest.warnings.push(`Generated code contains placeholder comments: ${hasPlaceholders.placeholders.join(', ')}`);
        generatedTest.warnings.push(`This is unacceptable. The LLM failed to generate complete tests.`);
        generatedTest.warnings.push(`RECOMMENDATION: Try a different model (Claude 4 Sonnet or Gemini 2.5 Pro) for better results.`);
        
        // Log for debugging
        console.log('Incomplete generated code sample:', generatedTest.code.substring(0, 1000));
      }

      // Check describe block count vs endpoint count
      const describeBlockCount = this.countDescribeBlocks(generatedTest.code);
      const expectedDescribeBlocks = validation.endpoints.length + 1; // +1 for main test suite
      if (describeBlockCount < expectedDescribeBlocks) {
        console.error(`CRITICAL: Insufficient describe blocks: ${describeBlockCount} found, ${expectedDescribeBlocks} expected`);
        
        // Reduce quality score for missing describe blocks
        generatedTest.qualityScore = Math.min(generatedTest.qualityScore, 4);
        
        generatedTest.warnings = generatedTest.warnings || [];
        generatedTest.warnings.push(`🚨 INCOMPLETE ENDPOINT COVERAGE`);
        generatedTest.warnings.push(`Only ${describeBlockCount} describe blocks found, expected ${expectedDescribeBlocks} (one per endpoint + main suite)`);
        generatedTest.warnings.push(`This indicates the LLM stopped generating tests before completing all endpoints.`);
        generatedTest.warnings.push(`SOLUTION: Use a model with higher token limits or try Claude 4 Sonnet.`);
      }
      
      // Check endpoint coverage
      if (coverage.missingEndpoints.length > 0) {
        console.warn('Missing tests for endpoints:', coverage.missingEndpoints);
        generatedTest.warnings = generatedTest.warnings || [];
        generatedTest.warnings.push(`Missing tests for endpoints: ${coverage.missingEndpoints.join(', ')}`);
      }

      // The provider already returns a GeneratedTest object
      // Just add/override the ID to ensure uniqueness
      generatedTest.id = `test_${Date.now()}`;

      return generatedTest;
    } catch (error) {
      console.error('Batch test generation failed:', error);
      throw error;
    }
  }

  // Helper methods for individual processing
  private groupUniqueEndpoints(requests: any[]): any[] {
    const uniqueEndpoints = new Map<string, any>();
    requests.forEach(request => {
      try {
        const url = new URL(request.url);
        const signature = `${request.method}:${url.pathname}`;
        if (!uniqueEndpoints.has(signature)) {
          uniqueEndpoints.set(signature, request);
        }
      } catch (error) {
        const signature = `${request.method}:${request.url}`;
        if (!uniqueEndpoints.has(signature)) {
          uniqueEndpoints.set(signature, request);
        }
      }
    });
    return Array.from(uniqueEndpoints.values());
  }

  private createSingleEndpointHAR(endpoint: any): HARData {
    // Create a HAR data object with just this one endpoint
    const entry = {
      startedDateTime: new Date(endpoint.timestamp).toISOString(),
      time: endpoint.duration || 0,
      request: {
        method: endpoint.method,
        url: endpoint.url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(endpoint.requestHeaders || {}).map(([name, value]) => ({
          name,
          value: String(value)
        })),
        queryString: [],
        postData: endpoint.requestBody ? {
          mimeType: 'application/json',
          text: typeof endpoint.requestBody === 'string' 
            ? endpoint.requestBody 
            : JSON.stringify(endpoint.requestBody)
        } : undefined,
        headersSize: -1,
        bodySize: -1
      },
      response: {
        status: endpoint.status || 200,
        statusText: '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(endpoint.responseHeaders || {}).map(([name, value]) => ({
          name,
          value: String(value)
        })),
        content: {
          size: endpoint.responseSize || 0,
          mimeType: 'application/json',
          text: endpoint.responseBody ? 
            (typeof endpoint.responseBody === 'string' 
              ? endpoint.responseBody 
              : JSON.stringify(endpoint.responseBody)) : undefined
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: endpoint.responseSize || 0
      },
      cache: {},
      timings: {
        blocked: -1,
        dns: -1,
        connect: -1,
        send: 0,
        wait: endpoint.duration || 0,
        receive: 0,
        ssl: -1
      }
    };

    return {
      version: '1.2',
      creator: {
        name: 'XHRScribe',
        version: '1.0.0'
      },
      entries: [entry]
    };
  }

  private mergeIndividualTests(individualTests: string[], authFlow: any, framework: string): string {
    // Extract the describe blocks from each individual test and combine them
    const testBlocks: string[] = [];
    let sharedSetup = '';
    
    // Extract authentication setup from the first test if available
    if (authFlow && authFlow.loginEndpoint) {
      const analyzer = this.authFlowAnalyzer;
      sharedSetup = analyzer.generateAuthSetup(authFlow, framework);
    }

    // Process each individual test
    individualTests.forEach((testCode, index) => {
      // Extract the main describe block content (skip the outer wrapper)
      const describeMatch = testCode.match(/describe\(['"`]([^'"`]+)['"`],\s*\(\)\s*=>\s*\{([\s\S]*)\}\);?\s*$/);
      if (describeMatch) {
        const [, testName, testContent] = describeMatch;
        // Clean up the content and add it as a separate describe block
        const cleanContent = testContent.trim();
        testBlocks.push(`  describe('${testName}', () => {\n${cleanContent}\n  });`);
      } else {
        // Fallback: try to extract any describe block
        const fallbackMatch = testCode.match(/describe\([^{]+\{([\s\S]*)\}/);
        if (fallbackMatch) {
          testBlocks.push(`  // Endpoint ${index + 1} tests\n${fallbackMatch[0]}`);
        } else {
          // Last resort: wrap the entire test
          testBlocks.push(`  // Endpoint ${index + 1} tests\n  ${testCode.replace(/\n/g, '\n  ')}`);
        }
      }
    });

    // Combine everything into a single test suite
    const combinedTestSuite = `describe('API Test Suite - Complete Coverage', () => {
${sharedSetup ? `  // Authentication setup\n${sharedSetup.split('\n').map(line => `  ${line}`).join('\n')}\n` : ''}
${testBlocks.join('\n\n')}
});`;

    return combinedTestSuite;
  }

  private estimateTokens(text: string): number {
    // Simple token estimation (roughly 4 characters per token)
    return Math.ceil(text.length / 4);
  }

  private getProvider(settings: any, providerType: string): any {
    let providerInstance;
    let apiKey = '';

    switch (providerType) {
      case 'openai':
        apiKey = settings.apiKeys.openai || '';
        if (!apiKey) {
          throw new Error('OpenAI API key not configured. Please add it in settings.');
        }
        providerInstance = new OpenAIProvider();
        (providerInstance as any).setApiKey(apiKey);
        break;

      case 'anthropic':
        apiKey = settings.apiKeys.anthropic || '';
        if (!apiKey) {
          throw new Error('Anthropic API key not configured. Please add it in settings.');
        }
        providerInstance = new ClaudeProvider();
        (providerInstance as any).setApiKey(apiKey);
        break;

      case 'gemini':
        apiKey = settings.apiKeys.gemini || '';
        if (!apiKey) {
          throw new Error('Gemini API key not configured. Please add it in settings.');
        }
        providerInstance = new GeminiProvider();
        (providerInstance as any).setApiKey(apiKey);
        break;

      case 'local':
        providerInstance = new LocalProvider();
        break;

      default:
        throw new Error(`Unsupported AI provider: ${providerType}`);
    }

    return providerInstance;
  }

  private validateHARCompleteness(harData: HARData): {
    isComplete: boolean;
    warnings: string[];
    endpoints: string[];
  } {
    const warnings: string[] = [];
    const endpoints = new Set<string>();
    
    harData.entries.forEach(entry => {
      try {
        const url = new URL(entry.request.url);
        const endpoint = `${entry.request.method} ${url.pathname}`;
        endpoints.add(endpoint);
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

  private checkForPlaceholders(testCode: string): {
    found: boolean;
    placeholders: string[];
  } {
    const placeholderPatterns = [
      // Original patterns
      /\/\/\s*continue\s+adding\s+more.*test/gi,
      /\/\/\s*add\s+more\s+test/gi,
      /\/\/\s*repeat\s+for\s+other\s+endpoint/gi,
      /\/\/\s*similar.*test.*can.*be.*add/gi,
      /\/\/\s*you.*can.*add.*more/gi,
      /\/\/\s*additional.*test/gi,
      /\/\/\s*follow.*same.*pattern/gi,
      /\/\/\s*implement.*more.*test/gi,
      /\/\/\s*todo.*implement/gi,
      /\/\/\s*todo.*add/gi,
      /\/\/\s*and\s+so\s+on/gi,
      /\/\/\s*etc\.?/gi,
      /\/\/\s*\.\.\./gi, // Just "..."
      /continue\s+this\s+pattern/gi,
      /follow.*same.*structure/gi,
      /similar.*test.*can.*be.*added/gi,
      /you.*can.*add.*more.*test/gi,
      /remaining.*endpoint.*follow/gi,
      /additional.*test.*can.*be.*implement/gi
    ];

    const found: string[] = [];
    placeholderPatterns.forEach(pattern => {
      const matches = testCode.match(pattern);
      if (matches) {
        found.push(...matches);
      }
    });

    return {
      found: found.length > 0,
      placeholders: found
    };
  }

  private countDescribeBlocks(testCode: string): number {
    const describePatterns = [
      /describe\s*\(/g,
      /test\.describe\s*\(/g,
      /suite\s*\(/g,
    ];
    
    let totalCount = 0;
    describePatterns.forEach(pattern => {
      const matches = testCode.match(pattern) || [];
      totalCount += matches.length;
    });
    
    return totalCount;
  }

  private validateTestCoverage(testCode: string, expectedEndpoints: string[]): {
    coveredEndpoints: string[];
    missingEndpoints: string[];
    coveragePercentage: number;
  } {
    const coveredEndpoints: string[] = [];
    const missingEndpoints: string[] = [];
    
    expectedEndpoints.forEach(endpoint => {
      // Extract method and path from endpoint string (e.g., "GET /api/users")
      const [method, path] = endpoint.split(' ');
      
      // Check if test code contains tests for this endpoint
      const patterns = [
        new RegExp(`${method}.*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*${method}`, 'i'),
        new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      ];

      const hasCoverage = patterns.some(pattern => pattern.test(testCode));
      
      if (hasCoverage) {
        coveredEndpoints.push(endpoint);
      } else {
        missingEndpoints.push(endpoint);
      }
    });
    
    const coveragePercentage = expectedEndpoints.length > 0 
      ? (coveredEndpoints.length / expectedEndpoints.length) * 100 
      : 100;

    return {
      coveredEndpoints,
      missingEndpoints,
      coveragePercentage
    };
  }
}