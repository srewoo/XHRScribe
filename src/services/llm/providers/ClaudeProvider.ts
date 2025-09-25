import axios, { AxiosError } from 'axios';
import { encode } from 'gpt-tokenizer';
import { HARData, GenerationOptions, GeneratedTest } from '@/types';
import { LLMProvider } from '../LLMService';
import { AuthFlow } from '../../AuthFlowAnalyzer';

interface ClaudeErrorResponse {
  error?: {
    message: string;
    type: string;
  };
}

export class ClaudeProvider implements LLMProvider {
  private apiKey: string = '';
  private baseUrl = 'https://api.anthropic.com/v1';
  private maxRetries = 3;
  private retryDelay = 1000;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async generateTests(
    harData: HARData,
    options: GenerationOptions,
    authFlow?: AuthFlow,
    customAuthGuide?: string
  ): Promise<GeneratedTest> {
    if (!this.apiKey) {
      throw new Error('Claude API key not configured');
    }

    const prompt = this.buildPrompt(harData, options, authFlow, customAuthGuide);
    const promptTokens = this.countTokens(prompt);
    const systemPromptTokens = this.countTokens('You are an expert API test engineer. Generate clean, production-ready test code.');
    const totalInputTokens = promptTokens + systemPromptTokens;

    // Check token limits before making API call - leave more room for complete responses
    const modelLimit = this.getMaxTokens(options.model);
    if (totalInputTokens > modelLimit * 0.4) { // Leave 60% for response to ensure complete generation
      throw new Error(`Prompt too large for ${options.model}. Consider reducing the number of requests or using a model with higher token limits.`);
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/messages`,
          {
            model: options.model,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            system: 'You are an expert API test engineer. Generate clean, production-ready test code.',
            max_tokens: Math.min(32000, Math.floor((modelLimit - totalInputTokens) * 0.95)), // Use up to 95% of remaining tokens
            temperature: 0.7,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': this.apiKey,
              'anthropic-version': '2023-06-01',
            },
            timeout: 60000,
          }
        );

        const generatedCode = response.data.content[0].text;
        const completionTokens = this.countTokens(generatedCode);
        const totalTokens = totalInputTokens + completionTokens;
        const qualityScore = this.calculateQualityScore(generatedCode, harData);

        return {
          id: `test_${Date.now()}`,
          framework: options.framework,
          code: generatedCode,
          qualityScore,
          estimatedTokens: totalTokens,
          estimatedCost: this.estimateCost(totalTokens, options.model),
          warnings: this.analyzeCode(generatedCode, options.framework),
          suggestions: this.generateSuggestions(generatedCode, options),
        };
      } catch (error) {
        lastError = error as Error;
        
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError<ClaudeErrorResponse>;
          
          // Handle specific Claude error codes
          if (axiosError.response?.status === 401) {
            throw new Error('Invalid Claude API key. Please check your settings.');
          }
          
          if (axiosError.response?.status === 429) {
            // Rate limit - wait and retry
            if (attempt < this.maxRetries - 1) {
              await this.delay(this.retryDelay * (attempt + 1));
              continue;
            }
            throw new Error('Claude rate limit exceeded. Please try again later.');
          }
          
          if (axiosError.response?.status === 400) {
            const errorMessage = axiosError.response.data?.error?.message || 'Invalid request';
            throw new Error(`Claude API error: ${errorMessage}`);
          }
          
          if (axiosError.response?.status === 503 || axiosError.response?.status === 529) {
            // Service unavailable or overloaded - wait and retry
            if (attempt < this.maxRetries - 1) {
              await this.delay(this.retryDelay * (attempt + 1));
              continue;
            }
            throw new Error('Claude service temporarily unavailable. Please try again.');
          }
        }
        
        // For other errors, retry with exponential backoff
        if (attempt < this.maxRetries - 1) {
          await this.delay(this.retryDelay * Math.pow(2, attempt));
          continue;
        }
      }
    }

    // If all retries failed
    console.error('Claude API error after retries:', lastError);
    throw new Error(`Failed to generate tests with Claude: ${lastError?.message || 'Unknown error'}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  estimateCost(tokenCount: number, model: string): number {
    // Claude pricing as of 2024
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-opus-20240229': { input: 0.015, output: 0.075 }, // per 1k tokens
      'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
      'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
      'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
    };
    
    const modelPricing = pricing[model] || pricing['claude-3-haiku-20240307'];
    // Rough estimate: 60% input, 40% output
    const inputTokens = tokenCount * 0.6;
    const outputTokens = tokenCount * 0.4;
    
    return (inputTokens / 1000) * modelPricing.input + (outputTokens / 1000) * modelPricing.output;
  }

  countTokens(text: string): number {
    try {
      // Use gpt-tokenizer as approximation for Claude
      const tokens = encode(text);
      return tokens.length;
    } catch (error) {
      // Fallback to rough estimation
      return Math.ceil(text.length / 4);
    }
  }

  private getMaxTokens(model: string): number {
    const limits: Record<string, number> = {
      'claude-4-sonnet': 200000,           // Latest Claude 4
      'claude-3-7-sonnet': 200000,         // Claude 3.7
      'claude-3-5-sonnet-20241022': 200000, // Claude 3.5
      'claude-3-opus-20240229': 200000,     // Legacy
      'claude-3-sonnet-20240229': 200000,   // Legacy
      'claude-3-haiku-20240307': 200000,    // Legacy
    };
    return limits[model] || 100000;
  }

  private buildPrompt(harData: HARData, options: GenerationOptions, authFlow?: AuthFlow, customAuthGuide?: string): string {
    const framework = options.framework;
    const entries = harData.entries; // Process ALL entries

    let prompt = `🔥🔥🔥 NUCLEAR ALERT - NO INCOMPLETE RESPONSES ALLOWED 🔥🔥🔥

I AM PAYING FOR COMPLETE TEST GENERATION. INCOMPLETE RESPONSES WILL BE REJECTED.

YOU MUST GENERATE COMPLETE, FULLY-IMPLEMENTED ${framework} TEST CODE FOR ALL ${entries.length} ENDPOINTS.

🚫 ABSOLUTELY FORBIDDEN - INSTANT REJECTION:
❌ "Continue adding more endpoint tests..." 
❌ "Follow the same pattern for remaining endpoints"
❌ "Add more tests here" or "TODO: implement more tests"
❌ "Similar tests can be added for other endpoints"
❌ "You can add more tests..." or "Additional tests..."
❌ "Repeat for other endpoints" or "...and so on"
❌ Any variation of "continue", "add more", "follow pattern"
❌ Stopping after generating only some endpoints

🔥 MANDATORY REQUIREMENTS:
✅ GENERATE ACTUAL WORKING CODE FOR ALL ${entries.length} ENDPOINTS
✅ Each endpoint gets a complete test suite with 10-15 real test cases
✅ NO placeholder comments, NO template suggestions
✅ Production-ready, runnable code that I can use immediately
⚠️  Each endpoint MUST have its own test suite with 10-15 complete test cases

`;
    
    // Add framework-specific instructions
    prompt += this.getFrameworkInstructions(framework);
    prompt += '\n\n';
    
    // Add test requirements
    prompt += 'Requirements:\n';
    if (options.includeAuth) {
      prompt += '- Include authentication tests with proper token handling\n';
    }
    if (options.includeErrorScenarios) {
      prompt += '- Include comprehensive error scenario tests (400, 401, 403, 404, 500, 503)\n';
    }
    if (options.includePerformanceTests) {
      prompt += '- Include performance assertions and response time checks\n';
    }
    if (options.includeSecurityTests) {
      prompt += '- Include security tests (SQL injection, XSS, authentication bypass)\n';
    }
    if (options.generateMockData) {
      prompt += '- Generate realistic mock data using faker or similar libraries\n';
    }
    if (options.includeEdgeCases) {
      prompt += '- Include edge case tests (empty data, null values, boundary conditions)\n';
    }
    if (options.includeIntegrationTests) {
      prompt += '- Include integration tests that test multiple endpoints together\n';
    }

    // Add authentication instructions if provided
    if (authFlow) {
      prompt += `\n🔐 AUTHENTICATION DETECTED: ${authFlow.authPattern}\n`;
      if (authFlow.loginEndpoint) {
        prompt += `- Login Endpoint: ${authFlow.loginEndpoint.method} ${authFlow.loginEndpoint.url}\n`;
      }
      prompt += `- Protected Endpoints: ${authFlow.protectedEndpoints.length}\n`;
      prompt += `- CRITICAL: Include proper authentication setup and token chaining\n`;
    }

    // Add custom authentication guide if provided by user
    if (customAuthGuide && customAuthGuide.trim()) {
      prompt += `\n🎯 CUSTOM AUTHENTICATION GUIDE (USER PROVIDED):\n`;
      prompt += `${customAuthGuide.trim()}\n`;
      prompt += `\n🚨 CRITICAL: Follow the custom authentication guide above EXACTLY. This takes precedence over auto-detected patterns.\n`;
    }

    // Group requests by unique endpoint signature (GraphQL-aware)
    const uniqueEndpoints = new Map<string, any>();
    entries.forEach(entry => {
      try {
        const url = new URL(entry.request.url);
        let signature = `${entry.request.method}:${url.pathname}`;
        
        // ENHANCED: Special handling for GraphQL endpoints
        if (this.isGraphQLEndpoint(url.pathname, entry.request)) {
          const graphqlOperation = this.extractGraphQLOperation(entry.request);
          if (graphqlOperation) {
            signature = `${entry.request.method}:${url.pathname}:${graphqlOperation}`;
          }
        }
        
        if (!uniqueEndpoints.has(signature)) {
          uniqueEndpoints.set(signature, entry);
        }
      } catch {
        const signature = `${entry.request.method}:${entry.request.url}`;
        if (!uniqueEndpoints.has(signature)) {
          uniqueEndpoints.set(signature, entry);
        }
      }
    });

    prompt += `\n🎯 MANDATORY: Generate complete tests for ALL ${uniqueEndpoints.size} unique endpoints:\n`;
    
    Array.from(uniqueEndpoints.values()).forEach((entry, index) => {
      const url = new URL(entry.request.url);
      const method = entry.request.method;
      const requestBody = entry.request.postData?.text;
      const responseBody = entry.response.content.text;
      const statusCode = entry.response.status;
      
      prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 ENDPOINT ${index + 1}/${uniqueEndpoints.size}: ${method} ${url.pathname}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 REQUEST DETAILS:
URL: ${entry.request.url}
Method: ${method}
${url.search ? `Query Parameters: ${url.search}` : 'No query parameters'}

🔑 REQUEST HEADERS:
${entry.request.headers && entry.request.headers.length > 0 
  ? entry.request.headers.map(h => `${h.name}: ${h.value}`).join('\n')
  : 'No headers captured'}

🍪 REQUEST COOKIES:
${entry.request.cookies && entry.request.cookies.length > 0 
  ? entry.request.cookies.map(c => `${c.name}=${c.value}`).join('; ')
  : 'No cookies'}

📦 REQUEST BODY:
${requestBody ? requestBody.substring(0, 400) : 'No request body'}

📥 RESPONSE DETAILS:
Expected Status: ${statusCode}
${entry.response.headers && entry.response.headers.length > 0 
  ? `Response Headers:\n${entry.response.headers.map(h => `${h.name}: ${h.value}`).join('\n')}`
  : 'No response headers'}

🍪 RESPONSE COOKIES:
${entry.response.cookies && entry.response.cookies.length > 0 
  ? entry.response.cookies.map(c => `${c.name}=${c.value}${c.domain ? `; Domain=${c.domain}` : ''}${c.httpOnly ? '; HttpOnly' : ''}${c.secure ? '; Secure' : ''}`).join('\n')
  : 'No response cookies'}

📦 RESPONSE BODY:
${responseBody ? responseBody.substring(0, 400) : 'No response'}

🚨 MANDATORY: Generate ALL these test types:
- 1 Happy path test (valid request → ${statusCode})
- 5-8 Error tests (400, 401, 403, 404, 422, 500)
- 3-5 Edge case tests (null values, boundaries, special chars)
- 2-3 Security tests (XSS, injection attempts)

`;
    });

    prompt += `

🚨🚨🚨 FINAL VERIFICATION REQUIREMENTS 🚨🚨🚨

✅ MUST GENERATE: Complete test suite for ALL ${uniqueEndpoints.size} endpoints
❌ MUST NOT INCLUDE: "// Continue adding more tests..." or similar placeholders
✅ EACH ENDPOINT: Must have 10-15 individual test cases
✅ CODE QUALITY: Production-ready, runnable without modifications
✅ COVERAGE: Positive, negative, edge case, and security tests for every endpoint

📋 FINAL CHECKLIST:
- [ ] ${uniqueEndpoints.size}/${uniqueEndpoints.size} endpoints have complete test suites
- [ ] No placeholder or template comments
- [ ] Each endpoint has proper test organization
- [ ] Includes setup/teardown (beforeAll, beforeEach, afterEach)
- [ ] Uses environment variables for configuration
- [ ] Ready to run immediately

🚀 GENERATE COMPLETE ${framework} TEST CODE NOW:`;

    return prompt;
  }

  private groupRequestsByEndpoint(entries: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    entries.forEach(entry => {
      try {
        const url = new URL(entry.request.url);
        const endpoint = `${url.pathname}`;
        if (!grouped[endpoint]) {
          grouped[endpoint] = [];
        }
        grouped[endpoint].push(entry);
      } catch (error) {
        // If URL parsing fails, use the full URL
        const endpoint = entry.request.url;
        if (!grouped[endpoint]) {
          grouped[endpoint] = [];
        }
        grouped[endpoint].push(entry);
      }
    });
    
    return grouped;
  }

  private getFrameworkInstructions(framework: string): string {
    const instructions: Record<string, string> = {
      jest: `Use Jest testing framework with:
- describe() blocks for test suites
- it() or test() for individual tests
- beforeAll/beforeEach for setup
- afterAll/afterEach for cleanup
- expect() for assertions
- async/await for asynchronous tests`,
      
      playwright: `🚨 PLAYWRIGHT SYNTAX ONLY - ABSOLUTELY NO JEST SYNTAX:
- MANDATORY: test.describe() for test suites (NEVER describe())
- MANDATORY: test() for individual tests (NEVER it())
- MANDATORY: test.beforeAll/test.beforeEach for setup (NEVER beforeAll/beforeEach)
- MANDATORY: test.afterAll/test.afterEach for cleanup (NEVER afterAll/afterEach)
- MANDATORY: import { test, expect } from '@playwright/test'
- Use { request } fixture for API testing exclusively
- Use expect() with Playwright assertions ONLY
- Proper async/await with request context
❌ ABSOLUTELY FORBIDDEN: describe(), it(), beforeAll(), beforeEach(), afterAll(), afterEach()
✅ MUST USE ONLY: test.describe(), test(), test.beforeAll(), test.beforeEach(), test.afterAll(), test.afterEach()`,
      
      'mocha-chai': `Use Mocha with Chai assertions:
- describe() for test suites
- it() for individual tests
- before/beforeEach hooks
- after/afterEach hooks
- chai.expect() for assertions
- chai-http for HTTP requests`,
      
      cypress: `Use Cypress for API testing:
- describe() and it() blocks
- cy.request() for API calls
- cy.intercept() for mocking
- proper assertions with should()
- custom commands where appropriate`,
      
      puppeteer: `Use Puppeteer with Jest:
- describe() and test() blocks
- page.evaluate() for API calls
- proper browser context management
- screenshots on failure
- network interception where needed`,
      
      vitest: `Use Vitest testing framework:
- describe() and it() blocks
- vi.mock() for mocking
- expect() for assertions
- beforeAll/afterAll hooks
- proper TypeScript types`,
      
      supertest: `Use Supertest for API testing:
- describe() and it() blocks
- supertest(app) for requests
- .expect() for status assertions
- .expect() with callback for body assertions
- proper async/await usage`,
      
      postman: `Generate Postman collection JSON with:
- Proper collection structure
- Pre-request scripts
- Test scripts in JavaScript
- Environment variables
- Collection variables
- Response examples`,
      
      restassured: `🚨 REST ASSURED JAVA FRAMEWORK - NO JAVASCRIPT ALLOWED:
- MANDATORY: Generate complete Java test class using REST Assured
- MANDATORY: Use @Test annotations from TestNG or JUnit
- MANDATORY: Import static io.restassured.RestAssured.* and static org.hamcrest.Matchers.*
- MANDATORY: Use given().when().then() pattern for ALL API tests
- MANDATORY: Use RequestSpecification for shared configurations
- Use statusCode(), body(), header() methods for validations
- Use Hamcrest matchers: equalTo(), notNullValue(), hasSize(), containsString()
- Include @BeforeClass for setup and @AfterClass for cleanup
- Use Response objects for complex validations
❌ ABSOLUTELY FORBIDDEN: JavaScript syntax, describe(), it(), expect(), async/await
✅ MUST USE ONLY: Java syntax, @Test, given().when().then(), public class`,
    };

    return instructions[framework] || instructions.jest;
  }

  private calculateQualityScore(code: string, harData: HARData): number {
    let score = 5; // Base score

    // Check for test coverage
    const coveredEndpoints = harData.entries.filter(entry => {
      const url = entry.request.url;
      const pathname = new URL(url).pathname;
      return code.includes(url) || code.includes(pathname);
    }).length;
    
    score += Math.min(3, (coveredEndpoints / Math.min(harData.entries.length, 20)) * 3);

    // Check for assertions
    if (code.includes('expect') || code.includes('assert') || code.includes('.should')) score += 0.5;

    // Check for error handling
    if (code.includes('catch') || code.includes('try') || code.includes('.catch')) score += 0.5;

    // Check for async handling
    if (code.includes('async') || code.includes('await') || code.includes('.then')) score += 0.5;

    // Check for test organization
    if (code.includes('describe') || code.includes('test.describe')) score += 0.5;

    return Math.min(10, score);
  }

  private analyzeCode(code: string, framework?: string): string[] {
    const warnings: string[] = [];

    // Framework-aware assertion detection
    const hasAssertions = this.detectAssertions(code, framework);
    if (!hasAssertions) {
      warnings.push('No assertions found in generated tests');
    }

    if (code.includes('localhost') || code.includes('127.0.0.1')) {
      warnings.push('Tests contain hardcoded localhost URLs');
    }

    if (code.includes('Bearer') && !code.includes('process.env') && !code.includes('${')) {
      warnings.push('API keys or tokens may be hardcoded');
    }

    if (code.length < 200) {
      warnings.push('Generated tests seem incomplete');
    }

    // Framework-aware test organization detection
    const hasOrganization = this.detectTestOrganization(code, framework);
    if (!hasOrganization) {
      warnings.push('Tests lack proper organization structure');
    }

    return warnings;
  }

  private detectAssertions(code: string, framework?: string): boolean {
    switch (framework) {
      case 'restassured':
        return code.includes('assertThat') || code.includes('statusCode') || code.includes('equalTo');
      case 'postman':
        return code.includes('pm.test') || code.includes('pm.expect');
      default:
        return code.includes('expect') || code.includes('assert') || code.includes('should');
    }
  }

  private detectTestOrganization(code: string, framework?: string): boolean {
    switch (framework) {
      case 'restassured':
        return code.includes('@Test') && code.includes('public class');
      case 'postman':
        return code.includes('"info"') && code.includes('"item"');
      default:
        return code.includes('describe') || code.includes('suite') || code.includes('test.describe');
    }
  }

  private generateSuggestions(code: string, options: GenerationOptions): string[] {
    const suggestions: string[] = [];

    if (!code.includes('describe') && options.framework !== 'postman') {
      suggestions.push('Consider organizing tests in describe blocks for better structure');
    }

    if (!code.includes('timeout') && !code.includes('jest.setTimeout')) {
      suggestions.push('Consider adding timeout configurations for long-running tests');
    }

    if (!code.includes('beforeEach') && !code.includes('beforeAll') && !code.includes('setup')) {
      suggestions.push('Consider adding setup hooks for test initialization');
    }

    if (options.includePerformanceTests && !code.includes('performance.now') && !code.includes('Date.now')) {
      suggestions.push('Add explicit performance measurement using performance.now() or Date.now()');
    }

    if (!code.includes('afterEach') && !code.includes('afterAll') && !code.includes('cleanup')) {
      suggestions.push('Consider adding cleanup hooks to prevent test pollution');
    }

    if (!code.includes('mock') && !code.includes('stub') && !code.includes('spy')) {
      suggestions.push('Consider using mocks/stubs for external dependencies');
    }

    return suggestions;
  }

  private isGraphQLEndpoint(pathname: string, request: any): boolean {
    return pathname.includes('graphql') || pathname.includes('gql') || 
           (request.postData?.text && this.looksLikeGraphQL(request.postData.text));
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
    const requestBody = request.postData?.text;
    if (!requestBody) return null;
    
    try {
      const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
      const body = typeof requestBody === 'object' ? requestBody : JSON.parse(bodyStr);
      
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