import { OpenAIProvider } from './llm/providers/OpenAIProvider';
import { ClaudeProvider } from './llm/providers/ClaudeProvider';
import { GeminiProvider } from './llm/providers/GeminiProvider';
import { LocalProvider } from './llm/providers/LocalProvider';
import { GenerationOptions, RecordingSession, GeneratedTest, HARData, HAREntry } from '@/types';
import { normalizePath, getEndpointSignature } from './EndpointGrouper';
import { StorageService } from './StorageService';
import { AuthFlowAnalyzer } from './AuthFlowAnalyzer';
import { Logger } from '@/services/logging/Logger';
import { RateLimiter } from '@/services/rateLimit/RateLimiter';
import { countTokens as countTokensLazy } from '@/services/llm/tokenizer';

export class AIService {
  private static instance: AIService;
  private storageService: StorageService;
  private authFlowAnalyzer: AuthFlowAnalyzer;
  private abortController: AbortController | null = null;

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

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
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

  async generateTests(session: RecordingSession, options: GenerationOptions, excludedEndpoints?: Set<string>, progressCallback?: (current: number, total: number, stage: string, endpoint?: string) => void): Promise<GeneratedTest> {
    this.abortController = new AbortController();

    // Return a cached suite when the same session + options were generated
    // recently and caching is enabled — avoids paying for identical LLM calls.
    const { CacheService } = await import('@/services/cache/CacheService');
    const cache = CacheService.getInstance();
    let cacheKey: string | null = null;
    let cachingEnabled = false;
    try {
      const cfg = await this.storageService.getSettings();
      cachingEnabled = cfg?.advanced?.cacheResponses !== false;
      if (cachingEnabled) {
        // Load any entries persisted by a previous service-worker lifetime.
        await cache.hydrate();
        cacheKey = CacheService.generateKey(session.id, {
          options,
          excluded: excludedEndpoints ? Array.from(excludedEndpoints).sort() : [],
        });
        const cached = cache.get(cacheKey) as GeneratedTest | null;
        if (cached) {
          this.abortController = null;
          return { ...cached, warnings: [...(cached.warnings || []), 'Served from cache'] };
        }
      }
    } catch {
      // Cache is best-effort; fall through to a live generation.
    }

    // Load learned correction patterns and append to custom prompt
    try {
      const { CorrectionTracker } = await import('./CorrectionTracker');
      const tracker = CorrectionTracker.getInstance();
      const topPatterns = await tracker.getTopPatterns(3);
      if (topPatterns.length > 0) {
        const fewShot = tracker.buildFewShotExamples(topPatterns);
        options = { ...options, customPrompt: (options.customPrompt || '') + fewShot };
      }
    } catch {
      // CorrectionTracker not available — continue without
    }

    // Always use individual parallel processing for better quality and speed
    const result = await this.generateTestsIndividually(session, options, excludedEndpoints, progressCallback);

    // Validate → auto-fix → re-validate. DeepValidator scores the suite; if it
    // is not yet production/staging ready (or has critical issues), run the
    // IntelligentAutoFixer (rule-based fixes first, then AI for the remainder)
    // and re-validate. The fix is only accepted if it improves the score.
    try {
      const { DeepValidator } = await import('./DeepValidator');
      const validator = DeepValidator.getInstance();
      const harData = this.convertSessionToHAR(session);
      let validationResult = validator.validateTestSuite(result.code, harData, options.framework);

      let autoFixApplied = false;
      let issuesAutoFixed = 0;
      let scoreBeforeAutoFix: number | undefined;

      const notReady = !['production', 'staging'].includes(validationResult.readinessLevel);
      const hasCritical = validationResult.detailedIssues.some(i => i.severity === 'critical');

      if ((notReady || hasCritical) && validationResult.detailedIssues.length > 0) {
        try {
          const { IntelligentAutoFixer } = await import('./IntelligentAutoFixer');
          const fixer = IntelligentAutoFixer.getInstance();
          const fixResult = await fixer.autoFixWithAI(
            result.code,
            validationResult.detailedIssues,
            options.framework
          );

          if (fixResult.fixedCode && fixResult.issuesFixed.length > 0) {
            const reValidation = validator.validateTestSuite(
              fixResult.fixedCode,
              harData,
              options.framework
            );
            // Accept the fix only if it did not regress the score.
            if (reValidation.overallScore >= validationResult.overallScore) {
              scoreBeforeAutoFix = validationResult.overallScore;
              result.code = fixResult.fixedCode;
              validationResult = reValidation;
              autoFixApplied = true;
              issuesAutoFixed = fixResult.issuesFixed.length;
              result.warnings = [
                ...(result.warnings || []),
                `Auto-fixer resolved ${issuesAutoFixed} issue(s); score ${scoreBeforeAutoFix} → ${reValidation.overallScore}`,
              ];
            }
          }
        } catch (fixError) {
          Logger.getInstance().warn('Auto-fixer failed, keeping original output', { error: fixError }, 'AIService');
        }
      }

      result.validation = {
        overallScore: validationResult.overallScore,
        readinessLevel: validationResult.readinessLevel,
        issueCount: validationResult.detailedIssues.length,
        criticalIssues: validationResult.detailedIssues.filter(i => i.severity === 'critical').length,
        suggestions: validationResult.improvementSuggestions.slice(0, 5),
        autoFixApplied,
        issuesAutoFixed,
        scoreBeforeAutoFix,
      };
    } catch (error) {
      Logger.getInstance().warn('DeepValidator failed, skipping validation', { error }, 'AIService');
    }

    if (cachingEnabled && cacheKey) {
      cache.set(cacheKey, result);
    }

    this.abortController = null;
    return result;
  }

  private async generateTestsIndividually(session: RecordingSession, options: GenerationOptions, excludedEndpoints?: Set<string>, progressCallback?: (current: number, total: number, stage: string, endpoint?: string) => void): Promise<GeneratedTest> {
    try {
      console.log('🔥 Using INDIVIDUAL endpoint processing for guaranteed completeness');
      
      // Get settings for API keys
      const apiSettings = await this.storageService.getSettings();
      if (!apiSettings) {
        throw new Error('Settings not found. Please configure your API keys.');
      }

      // Filter out excluded endpoints if provided
      let filteredSession = session;
      console.log(`🔍 Endpoint filtering: excludedEndpoints=${excludedEndpoints ? `Set(${excludedEndpoints.size})` : 'undefined'}, total requests=${session.requests.length}`);
      if (excludedEndpoints && excludedEndpoints.size > 0) {
        console.log(`🔍 Excluded signatures:`, Array.from(excludedEndpoints));
        const filteredRequests = session.requests.filter(request => {
          const signature = getEndpointSignature(request);
          const included = !excludedEndpoints.has(signature);
          if (!included) {
            console.log(`  ❌ Excluding: ${signature}`);
          }
          return included;
        });

        console.log(`🔍 Filtered: ${session.requests.length} → ${filteredRequests.length} requests`);
        filteredSession = {
          ...session,
          requests: filteredRequests
        };
      } else {
        console.log(`🔍 No excluded endpoints — generating tests for ALL ${session.requests.length} requests`);
      }

      // Analyze authentication flow
      const authFlow = this.authFlowAnalyzer.analyzeAuthFlow(filteredSession.requests);
      console.log('Detected authentication flow:', authFlow);

      // Get user's custom authentication guide if available
      const authSettings = await this.storageService.getSettings();
      const customAuthGuide = authSettings?.authGuide;

      console.log(`🔐 Custom Auth Guide: ${customAuthGuide ? 'ENABLED ✅' : 'NOT PROVIDED ❌'}`);
      if (customAuthGuide) {
        console.log(`📋 Auth Guide Preview: "${customAuthGuide.substring(0, 100)}..."`);
      }

      // Group unique endpoints with GraphQL operation awareness
      const uniqueEndpoints = this.groupUniqueEndpoints(filteredSession.requests);
      console.log(`Processing ${uniqueEndpoints.length} unique endpoints individually`);

      // Get the appropriate provider
      const provider = this.getProvider(apiSettings, options.provider);
      // Alternate providers to try if the primary fails on an endpoint.
      const fallbackTypes = this.getFallbackProviderTypes(apiSettings, options.provider);

      // Generate tests for each endpoint individually
      const individualTests: string[] = [];
      const warnings: string[] = [];
      const successScores: number[] = [];
      const failedEndpoints: string[] = [];

      // Process endpoints in parallel batches
      const batchSize = 5; // Process 5 endpoints at a time
      for (let i = 0; i < uniqueEndpoints.length; i += batchSize) {
        if (this.abortController?.signal.aborted) {
          throw new DOMException('Generation cancelled', 'AbortError');
        }
        const batch = uniqueEndpoints.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (endpoint, index) => {
          const currentIndex = i + index + 1;
          const endpointName = `${endpoint.method} ${endpoint.url}`;
          const maxRetries = 1; // Up to 2 total attempts (1 initial + 1 retry)

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const attemptLabel = attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : '';
              console.log(`Generating tests for endpoint ${currentIndex}/${uniqueEndpoints.length}: ${endpointName}${attemptLabel}`);

              // Send progress update
              if (progressCallback) {
                const stage = attempt > 0 ? `Retrying (${attempt}/${maxRetries})` : 'Generating tests';
                progressCallback(currentIndex, uniqueEndpoints.length, stage, endpointName);
              }

              // Create single-endpoint HAR data
              const singleEndpointHAR = this.createSingleEndpointHAR(endpoint);

              // Throttle to the provider's requests-per-minute budget before
              // issuing the real API call (client-side rate limiting).
              await RateLimiter.getInstance().waitForSlot(options.provider);

              // Generate tests for this specific endpoint
              const endpointTest = await provider.generateTests(singleEndpointHAR, {
                ...options,
                complexity: 'intermediate'
              }, authFlow, customAuthGuide, this.abortController?.signal);

              if (attempt > 0) {
                console.log(`✅ Retry succeeded for ${endpointName} on attempt ${attempt + 1}`);
              }

              return {
                endpoint: endpointName,
                code: endpointTest.code,
                qualityScore: endpointTest.qualityScore,
                warnings: endpointTest.warnings || [],
                failed: false
              };
            } catch (error: any) {
              const errorDetail = error.response
                ? `${error.response.status}: ${JSON.stringify(error.response.data)}`
                : error.message || String(error);
              Logger.getInstance().error(`Attempt ${attempt + 1} failed for ${endpointName}: ${errorDetail}`, null, 'AIService');

              // If we have retries left, wait with exponential backoff then retry
              if (attempt < maxRetries) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt), 4000);
                console.log(`⏳ Waiting ${backoffMs}ms before retry...`);
                await this.delay(backoffMs);
                continue;
              }

              // All retries exhausted on the primary provider. Fall back to any
              // other configured provider (cheap-first) before giving up.
              // (plan.md 3.5)
              Logger.getInstance().error(`All ${maxRetries + 1} attempts failed for ${endpointName} on ${options.provider}`, null, 'AIService');
              for (const fbType of fallbackTypes) {
                if (this.abortController?.signal.aborted) break;
                try {
                  const fbProvider = this.getProvider(apiSettings, fbType);
                  await RateLimiter.getInstance().waitForSlot(fbType);
                  const fbHAR = this.createSingleEndpointHAR(endpoint);
                  const fbTest = await fbProvider.generateTests(
                    fbHAR,
                    { ...options, provider: fbType, complexity: 'intermediate' },
                    authFlow,
                    customAuthGuide,
                    this.abortController?.signal
                  );
                  Logger.getInstance().warn(`Fallback provider ${fbType} generated ${endpointName} after ${options.provider} failed`, null, 'AIService');
                  return {
                    endpoint: endpointName,
                    code: fbTest.code,
                    qualityScore: fbTest.qualityScore,
                    warnings: [...(fbTest.warnings || []), `Generated via fallback provider "${fbType}" after "${options.provider}" failed.`],
                    failed: false
                  };
                } catch (fbError: any) {
                  Logger.getInstance().warn(`Fallback provider ${fbType} also failed for ${endpointName}: ${fbError?.message || fbError}`, null, 'AIService');
                }
              }

              return {
                endpoint: endpointName,
                code: `// Failed to generate tests for ${endpointName} after ${maxRetries + 1} attempts\n// Error: ${error.message}`,
                qualityScore: 0,
                warnings: [`Failed to generate tests after ${maxRetries + 1} attempts${fallbackTypes.length ? ` (and ${fallbackTypes.length} fallback provider(s))` : ''}: ${error.message}`],
                failed: true
              };
            }
          }

          // TypeScript requires a return here (unreachable)
          return {
            endpoint: endpointName,
            code: `// Failed to generate tests for ${endpointName}`,
            qualityScore: 0,
            warnings: ['Generation failed'],
            failed: true
          };
        });

        const batchResults = await Promise.all(batchPromises);
        
        // Collect results
        batchResults.forEach(result => {
          individualTests.push(result.code);
          warnings.push(...result.warnings);
          if (result.failed) {
            failedEndpoints.push(result.endpoint);
          } else {
            successScores.push(result.qualityScore);
          }
        });
      }

      // Merge all individual tests into a cohesive test suite
      const mergedTestCode = this.mergeIndividualTests(individualTests, authFlow, options.framework);
      
      // Calculate combined metrics
      const estimatedTokens = this.estimateTokens(mergedTestCode);
      const estimatedCost = provider.estimateCost(estimatedTokens, options.model);

      const succeeded = successScores.length;
      const failed = failedEndpoints.length;
      console.log(`Individual processing complete: ${succeeded}/${uniqueEndpoints.length} endpoints succeeded, ${failed} failed`);

      // Honest quality score: the average of the endpoints that ACTUALLY
      // generated. Failed endpoints are excluded from the average (they're
      // reported separately) but drag nothing artificially upward — there is no
      // floor. If nothing succeeded, the score is 0.
      const qualityScore = succeeded > 0
        ? Math.round((successScores.reduce((a, b) => a + b, 0) / succeeded) * 10) / 10
        : 0;

      // Surface failures prominently at the top of the warnings list.
      const summaryWarnings: string[] = [];
      if (failed > 0) {
        summaryWarnings.push(
          `⚠️ ${failed} of ${uniqueEndpoints.length} endpoint(s) failed to generate and are marked with "// Failed" comments: ${failedEndpoints.join(', ')}`
        );
      }
      summaryWarnings.push(
        `Generated ${succeeded}/${uniqueEndpoints.length} endpoints via individual processing.`
      );

      return {
        id: `test-${Date.now()}`,
        framework: options.framework,
        code: mergedTestCode,
        qualityScore,
        estimatedTokens: estimatedTokens,
        estimatedCost: estimatedCost,
        warnings: [...summaryWarnings, ...warnings],
        metadata: {
          generationMode: 'individual',
          endpointsProcessed: succeeded,
          failedEndpoints,
        },
      };

    } catch (error) {
      Logger.getInstance().error('Individual test generation failed', error, 'AIService');
      throw error;
    }
  }

  // Helper methods for individual processing
  private groupUniqueEndpoints(requests: any[]): any[] {
    const uniqueEndpoints = new Map<string, any>();
    requests.forEach(request => {
      try {
        const url = new URL(request.url);
        let signature = `${request.method}:${normalizePath(url.pathname)}`;
        
        // ENHANCED: Special handling for GraphQL endpoints
        if (this.isGraphQLEndpoint(url.pathname, request)) {
          const graphqlOperation = this.extractGraphQLOperation(request);
          if (graphqlOperation) {
            signature = `${request.method}:${url.pathname}:${graphqlOperation}`;
            console.log(`GraphQL operation detected: ${signature}`);
          }
        }
        
        if (!uniqueEndpoints.has(signature)) {
          uniqueEndpoints.set(signature, request);
          console.log(`Unique endpoint detected: ${signature}`);
        }
      } catch (error) {
        Logger.getInstance().warn(`Failed to parse URL for request: ${request.url}`, { error }, 'AIService');
        const fallbackSignature = `${request.method}:${request.url}`;
        if (!uniqueEndpoints.has(fallbackSignature)) {
          uniqueEndpoints.set(fallbackSignature, request);
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

    // Frameworks that don't use JS describe() blocks — keep raw output
    const rawFrameworks = ['restassured', 'karate', 'k6', 'artillery', 'pytest', 'httpx', 'postman'];

    // Process each individual test - framework-aware extraction
    individualTests.forEach((testCode, index) => {
      if (framework === 'postman') {
        // For Postman, extract request item from LLM output (strip collection wrapper if present)
        const extracted = this.extractPostmanItem(testCode);
        testBlocks.push(extracted);
      } else if (rawFrameworks.includes(framework)) {
        // Non-JS frameworks: keep raw code, just add separator comment
        const commentPrefix = framework === 'karate' ? '#' : (framework === 'pytest' || framework === 'httpx') ? '#' : '//';
        testBlocks.push(`${commentPrefix} Endpoint ${index + 1} tests\n${testCode}`);
      } else {
        // JS frameworks: extract describe blocks
        const describeMatch = testCode.match(/describe\(['"`]([^'"`]+)['"`],\s*\(\)\s*=>\s*\{([\s\S]*)\}\);?\s*$/);
        if (describeMatch) {
          const [, testName, testContent] = describeMatch;
          const cleanContent = testContent.trim();

          if (framework === 'playwright') {
            testBlocks.push(`  test.describe('${testName}', () => {\n${cleanContent}\n  });`);
          } else {
            testBlocks.push(`  describe('${testName}', () => {\n${cleanContent}\n  });`);
          }
        } else {
          // Fallback: try to extract any describe block
          const fallbackMatch = testCode.match(/describe\([^{]+\{([\s\S]*)\}/);
          if (fallbackMatch) {
            testBlocks.push(`  // Endpoint ${index + 1} tests\n${fallbackMatch[0]}`);
          } else {
            // Last resort: keep raw code
            testBlocks.push(`  // Endpoint ${index + 1} tests\n  ${testCode.replace(/\n/g, '\n  ')}`);
          }
        }
      }
    });

    // Combine everything into a single test suite with framework-appropriate wrapper
    const combinedTestSuite = this.wrapTestSuiteForFramework(
      framework, 
      testBlocks.join('\n\n'), 
      sharedSetup
    );

    return combinedTestSuite;
  }

  private wrapTestSuiteForFramework(framework: string, testContent: string, sharedSetup?: string): string {
    const setupSection = sharedSetup ? `  // Authentication setup\n${sharedSetup.split('\n').map(line => `  ${line}`).join('\n')}\n` : '';

    switch (framework) {
      case 'restassured':
        // Java classes are standalone
        return testContent;

      case 'karate':
        // Karate uses Feature file format — no JS wrapper
        return testContent;

      case 'k6':
        // k6 uses export default function — no JS wrapper
        return testContent;

      case 'artillery':
        // Artillery uses YAML config — no JS wrapper
        return testContent;

      case 'pytest':
      case 'httpx':
        // Python frameworks — no JS wrapper
        return testContent;

      case 'postman':
        // Postman collection wrapper
        return `{
  "info": {
    "name": "API Test Suite - Complete Coverage",
    "description": "Generated from XHRScribe recording",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
${testContent}
  ]
}`;

      case 'playwright':
        return `import { test, expect } from '@playwright/test';

test.describe('API Test Suite - Complete Coverage', () => {
${setupSection}${testContent}
});`;

      default:
        // For Jest, Vitest, Mocha, Cypress, Supertest, PactumJS, Puppeteer, Mocha/Chai
        return `describe('API Test Suite - Complete Coverage', () => {
${setupSection}${testContent}
});`;
    }
  }

  /** Extract request item JSON from LLM output, stripping collection wrapper if present */
  private extractPostmanItem(code: string): string {
    // Strip JS-style comments (JSON doesn't support them)
    let cleaned = code
      .replace(/\/\/[^\n]*/g, '')     // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\n{3,}/g, '\n')        // collapse excessive empty lines
      .trim();

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(cleaned);

      // If it's a full collection with "item" array, extract the items
      if (parsed.info && Array.isArray(parsed.item)) {
        // Return just the item objects as JSON strings
        return parsed.item.map((item: any) => JSON.stringify(item, null, 2)).join(',\n');
      }

      // If it's already a request item (has "request" or "event"), return as-is
      if (parsed.request || parsed.event || parsed.name) {
        return JSON.stringify(parsed, null, 2);
      }

      // Unknown structure, return cleaned
      return cleaned;
    } catch {
      // Not valid JSON — try to find the first complete JSON object
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.info && Array.isArray(parsed.item)) {
            return parsed.item.map((item: any) => JSON.stringify(item, null, 2)).join(',\n');
          }
          if (parsed.request || parsed.event || parsed.name) {
            return JSON.stringify(parsed, null, 2);
          }
        } catch {
          // Fall through
        }
      }
      // Return cleaned code as-is
      return cleaned;
    }
  }

  private estimateTokens(text: string): number {
    // Use the real tokenizer (lazy-loaded) so the surfaced cost estimate is
    // accurate rather than a chars/4 approximation.
    return countTokensLazy(text);
  }

  /**
   * Ordered list of alternate cloud providers to try when the primary fails,
   * cheapest first, restricted to providers the user has an API key for and
   * excluding the primary. The local provider is intentionally excluded — it
   * requires a running Ollama and would silently change output character.
   */
  private getFallbackProviderTypes(settings: any, primary: string): string[] {
    const cheapFirst = ['gemini', 'openai', 'anthropic'];
    const keys = settings?.apiKeys || {};
    return cheapFirst.filter(t => t !== primary && !!keys[t]);
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


  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  private isGraphQLEndpoint(pathname: string, request: any): boolean {
    return pathname.includes('graphql') || pathname.includes('gql') || 
           (request.requestBody && this.looksLikeGraphQL(request.requestBody));
  }

  private looksLikeGraphQL(requestBody: any): boolean {
    if (!requestBody) return false;
    
    try {
      const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
      const body = typeof requestBody === 'object' ? requestBody : JSON.parse(bodyStr);
      
      // Check for GraphQL query patterns
      return !!(body.query || body.operationName || body.variables || 
                bodyStr.includes('query ') || bodyStr.includes('mutation ') || 
                bodyStr.includes('subscription '));
    } catch {
      return false;
    }
  }

  private extractGraphQLOperation(request: any): string | null {
    if (!request.requestBody) return null;
    
    try {
      const bodyStr = typeof request.requestBody === 'string' ? request.requestBody : JSON.stringify(request.requestBody);
      const body = typeof request.requestBody === 'object' ? request.requestBody : JSON.parse(bodyStr);
      
      // Priority 1: Use operationName if available
      if (body.operationName && typeof body.operationName === 'string') {
        return body.operationName;
      }
      
      // Priority 2: Extract operation name from query string
      if (body.query && typeof body.query === 'string') {
        const queryMatch = body.query.match(/(?:query|mutation|subscription)\s+([a-zA-Z][a-zA-Z0-9_]*)/);
        if (queryMatch && queryMatch[1]) {
          return queryMatch[1];
        }
        
        // Priority 3: Use operation type + hash for unnamed operations
        const operationType = body.query.trim().match(/^(query|mutation|subscription)/);
        if (operationType) {
          const queryHash = this.simpleHash(body.query);
          return `${operationType[1]}_${queryHash}`;
        }
      }
      
      // Priority 4: Fallback to request body hash
      const bodyHash = this.simpleHash(bodyStr);
      return `operation_${bodyHash}`;
      
    } catch (error) {
      Logger.getInstance().warn('Failed to extract GraphQL operation', { error }, 'AIService');
      return null;
    }
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8);
  }
}