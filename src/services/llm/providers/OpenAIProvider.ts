import axios, { AxiosError } from 'axios';
import { encode } from 'gpt-tokenizer';
import { HARData, GenerationOptions, GeneratedTest } from '@/types';
import { LLMProvider } from '../LLMService';

interface OpenAIErrorResponse {
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string = '';
  private baseUrl = 'https://api.openai.com/v1';
  private maxRetries = 3;
  private retryDelay = 1000;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async generateTests(
    harData: HARData,
    options: GenerationOptions
  ): Promise<GeneratedTest> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const prompt = this.buildExhaustivePrompt(harData, options);
    const promptTokens = this.countTokens(prompt);
    const systemPromptTokens = this.countTokens(this.getSystemPrompt());
    const totalInputTokens = promptTokens + systemPromptTokens;

    // Check token limits before making API call
    const modelLimit = this.getMaxTokens(options.model);
    if (totalInputTokens > modelLimit * 0.7) { // Leave 30% for response
      throw new Error(`Prompt too large for ${options.model}. Consider reducing the number of requests or using a model with higher token limits.`);
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/chat/completions`,
          {
            model: options.model,
            messages: [
              {
                role: 'system',
                content: this.getSystemPrompt()
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3, // Lower temperature for more consistent test generation
            max_tokens: Math.min(4000, modelLimit - totalInputTokens),
            top_p: 0.9,
            frequency_penalty: 0.1,
            presence_penalty: 0.1
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`
            },
            timeout: 60000 // 60 second timeout for complex test generation
          }
        );

        const generatedCode = response.data.choices[0]?.message?.content || '';
        const totalTokens = response.data.usage?.total_tokens || totalInputTokens;
        const qualityScore = this.calculateQualityScore(generatedCode, harData);

        return {
          id: `test_${Date.now()}`,
          framework: options.framework,
          code: generatedCode,
          qualityScore,
          estimatedTokens: totalTokens,
          estimatedCost: this.estimateCost(totalTokens, options.model),
          warnings: this.analyzeCode(generatedCode),
          suggestions: this.generateSuggestions(generatedCode, options),
        };
      } catch (error) {
        lastError = error as Error;
        
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError<OpenAIErrorResponse>;
          
          // Handle specific OpenAI error codes
          if (axiosError.response?.status === 401) {
            throw new Error('Invalid OpenAI API key. Please check your settings.');
          }
          
          if (axiosError.response?.status === 429) {
            // Rate limit - wait and retry
            if (attempt < this.maxRetries - 1) {
              await this.delay(this.retryDelay * (attempt + 1));
              continue;
            }
            throw new Error('OpenAI rate limit exceeded. Please try again later.');
          }
          
          if (axiosError.response?.status === 400) {
            const errorMessage = axiosError.response.data?.error?.message || 'Invalid request';
            throw new Error(`OpenAI API error: ${errorMessage}`);
          }
          
          if (axiosError.response?.status === 503) {
            // Service unavailable - wait and retry
            if (attempt < this.maxRetries - 1) {
              await this.delay(this.retryDelay * (attempt + 1));
              continue;
            }
            throw new Error('OpenAI service temporarily unavailable. Please try again.');
          }
        }
        
        // For other errors, retry with exponential backoff
        if (attempt < this.maxRetries - 1) {
          await this.delay(this.retryDelay * Math.pow(2, attempt));
          continue;
        }
      }
    }
    
    throw lastError || new Error('Failed to generate tests after multiple attempts');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  estimateCost(tokenCount: number, model?: string): number {
    const modelPricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    };
    
    const pricing = modelPricing[model || 'gpt-3.5-turbo'] || modelPricing['gpt-3.5-turbo'];
    
    // Estimate 70% input, 30% output for test generation
    const inputTokens = tokenCount * 0.7;
    const outputTokens = tokenCount * 0.3;
    
    return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  }

  countTokens(text: string): number {
    try {
      // Use gpt-tokenizer for accurate token counting
      const tokens = encode(text);
      return tokens.length;
    } catch (error) {
      // Fallback to rough estimation if encoding fails
      return Math.ceil(text.length / 4);
    }
  }

  private getSystemPrompt(): string {
    return `You are an expert QA automation engineer specializing in comprehensive API testing. 
Your task is to generate EXHAUSTIVE test suites with >80% code coverage.

REQUIREMENTS:
1. Generate tests that cover ALL possible scenarios
2. Include positive, negative, edge cases, and boundary tests
3. Add detailed assertions for response structure, data types, and business logic
4. Use proper test organization with describe/it blocks
5. Include setup/teardown when necessary
6. Add comments explaining complex test scenarios
7. Ensure tests are maintainable and follow best practices
8. Mock external dependencies when appropriate
9. Include performance assertions where relevant
10. Add data-driven tests for multiple input combinations

IMPORTANT: Generate actual runnable code, not pseudocode or examples.`;
  }

  private buildExhaustivePrompt(harData: HARData, options: GenerationOptions): string {
    const framework = options.framework;
    const entries = harData.entries.slice(0, 20); // Limit for token management
    
    let prompt = `Generate an EXHAUSTIVE ${framework} test suite with >80% coverage for the following API endpoints.

Framework: ${framework}
${this.getFrameworkInstructions(framework)}

MANDATORY TEST CATEGORIES TO INCLUDE:

1. ✅ POSITIVE/HAPPY PATH TESTS (20% of tests):
   - Successful requests with valid data
   - All successful response codes (200, 201, 204, etc.)
   - Verify response structure and data types
   - Validate business logic and data relationships

2. ❌ NEGATIVE/ERROR TESTS (30% of tests):
   - 400 Bad Request - Invalid/malformed input
   - 401 Unauthorized - Missing/invalid auth
   - 403 Forbidden - Insufficient permissions
   - 404 Not Found - Non-existent resources
   - 409 Conflict - Duplicate/conflicting data
   - 422 Unprocessable Entity - Validation failures
   - 429 Too Many Requests - Rate limiting
   - 500 Internal Server Error - Server failures
   - 503 Service Unavailable - Downtime simulation

3. 🔧 EDGE CASES & BOUNDARY TESTS (25% of tests):
   - Empty strings, null, undefined values
   - Maximum length strings (10000+ chars)
   - Minimum/maximum numeric values (0, -1, MAX_INT)
   - Special characters: !@#$%^&*()<>?:"{}[]|\\
   - Unicode and emoji: 你好世界 😀🎉
   - HTML/Script injection: <script>alert('xss')</script>
   - SQL injection attempts: ' OR '1'='1
   - Decimal precision boundaries
   - Date/time edge cases (leap years, timezone boundaries)
   - Array boundaries (empty, 1 item, 1000+ items)
   - Pagination limits and offsets
   - Concurrent request handling
   - Idempotency for PUT/DELETE

4. 📊 DATA VALIDATION TESTS (15% of tests):
   - Required field validation
   - Data type validation (string, number, boolean, array, object)
   - Format validation (email, phone, UUID, date formats)
   - Enum/allowable values validation
   - Regex pattern matching
   - Nested object validation
   - Array element validation
   - Cross-field validation rules

5. 🔒 SECURITY TESTS (10% of tests):
   - Authentication bypass attempts
   - Authorization/permission tests
   - CORS validation
   - Input sanitization verification
   - Sensitive data exposure checks
   - Rate limiting validation
   - Token expiration handling

`;

    // Add performance requirements if requested
    if (options.includePerformanceTests) {
      prompt += `
6. ⚡ PERFORMANCE TESTS:
   - Response time < 1000ms for GET
   - Response time < 2000ms for POST/PUT
   - Payload size validation
   - Timeout handling (30s)
   - Load testing preparations
`;
    }

    prompt += `\n\nAPI ENDPOINTS TO TEST:\n`;
    
    // Analyze each endpoint and provide specific test requirements
    entries.forEach((entry, index) => {
      const url = new URL(entry.request.url);
      const method = entry.request.method;
      const isGraphQL = url.pathname.includes('graphql');
      const requestBody = entry.request.postData?.text;
      const responseBody = entry.response.content.text;
      const statusCode = entry.response.status;
      
      prompt += `
${index + 1}. ${method} ${entry.request.url}
   Path: ${url.pathname}
   Status: ${statusCode}
   ${requestBody ? `Request Body: ${requestBody.substring(0, 500)}` : 'No request body'}
   ${responseBody ? `Response Sample: ${responseBody.substring(0, 500)}` : 'No response body'}
   
   SPECIFIC TESTS REQUIRED FOR THIS ENDPOINT:
   - Test with valid request (as captured)
   - Test with each missing required field
   - Test with invalid data types for each field
   - Test with boundary values for numeric/string fields
   - Test authentication scenarios
   - Test malformed JSON/XML
   - Test with extra unexpected fields
   - Test concurrent requests
   - Test request size limits
   ${isGraphQL ? `
   - Test GraphQL query depth limits
   - Test invalid GraphQL syntax
   - Test GraphQL injection
   - Test over-fetching prevention
   ` : ''}
`;
    });

    prompt += `

TESTING GUIDELINES:
1. Use descriptive test names that explain the scenario
2. Group related tests using describe blocks
3. Include both positive and negative assertions
4. Use beforeEach/afterEach for test setup/cleanup
5. Mock external dependencies
6. Use test data factories/builders for complex objects
7. Include retry logic for flaky tests
8. Add timeout configurations
9. Use environment variables for sensitive data
10. Generate at least 15-20 tests per endpoint

COVERAGE REQUIREMENTS:
- Statement Coverage: >80%
- Branch Coverage: >75%
- Function Coverage: >80%
- Line Coverage: >80%

Generate the complete test suite now:`;

    return prompt;
  }

  private getFrameworkInstructions(framework: string): string {
    const instructions: Record<string, string> = {
      jest: `Use Jest with:
- describe/it/test blocks for organization
- expect assertions with toBe, toEqual, toHaveProperty, etc.
- async/await for asynchronous tests
- beforeAll/beforeEach/afterEach/afterAll for setup/teardown
- jest.mock() for mocking dependencies
- expect.assertions() for async error tests`,
      
      playwright: `Use Playwright with:
- test.describe/test blocks
- expect assertions
- API testing context with request fixture
- test.beforeAll/beforeEach/afterEach/afterAll
- test.skip/test.only for test control
- Custom fixtures for reusable setup`,
      
      'mocha-chai': `Use Mocha/Chai with:
- describe/it blocks
- chai expect/should assertions
- async/await or done callbacks
- before/beforeEach/afterEach/after hooks
- sinon for mocking/stubbing
- chai-http for API testing`,
      
      cypress: `Use Cypress with:
- describe/it blocks
- cy.request() for API testing
- cy.wrap() for promises
- expect assertions
- before/beforeEach/afterEach/after hooks
- cy.intercept() for mocking`,
      
      puppeteer: `Use Puppeteer with Jest:
- describe/it blocks
- async/await for all operations
- expect assertions
- page.evaluate() for API calls
- Request interception for mocking`,
      
      vitest: `Use Vitest with:
- describe/it/test blocks
- expect assertions
- vi.mock() for mocking
- beforeAll/beforeEach/afterEach/afterAll
- concurrent tests with test.concurrent`,
      
      supertest: `Use Supertest with:
- describe/it blocks
- supertest(app) for requests
- .expect() for assertions
- async/await for requests
- .send() for request bodies
- .set() for headers`,
      
      postman: `Generate Postman collection with:
- Pre-request scripts
- Test scripts with pm.test()
- pm.expect() assertions
- Environment variables with {{variable}}
- Collection variables
- Response validation
- Newman CLI compatible`,
    };

    return instructions[framework] || instructions.jest;
  }

  private getMaxTokens(model: string): number {
    const limits: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 16384,
    };
    return limits[model] || 4096;
  }

  private calculateQualityScore(code: string, harData: HARData): number {
    let score = 0;
    const maxScore = 10;
    const weights = {
      coverage: 3,      // 30% - How many endpoints are covered
      assertions: 2,    // 20% - Quality of assertions
      errorHandling: 2, // 20% - Error scenarios covered
      organization: 1.5, // 15% - Code organization
      edgeCases: 1.5   // 15% - Edge cases covered
    };

    // Check endpoint coverage
    const coveredEndpoints = harData.entries.filter(entry => {
      const url = new URL(entry.request.url);
      return code.includes(url.pathname) || code.includes(entry.request.url);
    }).length;
    const coverageRatio = coveredEndpoints / Math.max(harData.entries.length, 1);
    score += coverageRatio * weights.coverage;

    // Check for quality assertions
    const assertionPatterns = [
      'expect', 'assert', 'should', 'toBe', 'toEqual', 'toHaveProperty',
      'toContain', 'toMatch', 'toThrow', 'rejects', 'resolves'
    ];
    const assertionCount = assertionPatterns.filter(pattern => code.includes(pattern)).length;
    score += Math.min(assertionCount / assertionPatterns.length, 1) * weights.assertions;

    // Check error handling coverage
    const errorPatterns = ['400', '401', '403', '404', '422', '500', 'catch', 'error', 'fail'];
    const errorCount = errorPatterns.filter(pattern => code.includes(pattern)).length;
    score += Math.min(errorCount / errorPatterns.length, 1) * weights.errorHandling;

    // Check code organization
    const organizationPatterns = ['describe', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'];
    const organizationCount = organizationPatterns.filter(pattern => code.includes(pattern)).length;
    score += Math.min(organizationCount / organizationPatterns.length, 1) * weights.organization;

    // Check edge cases
    const edgeCasePatterns = ['null', 'undefined', 'empty', 'boundary', 'special', 'injection', 'max', 'min'];
    const edgeCaseCount = edgeCasePatterns.filter(pattern => 
      code.toLowerCase().includes(pattern)
    ).length;
    score += Math.min(edgeCaseCount / edgeCasePatterns.length, 1) * weights.edgeCases;

    return Math.min(Math.round(score), maxScore);
  }

  private analyzeCode(code: string): string[] {
    const warnings: string[] = [];

    // Check for comprehensive coverage
    if (!code.includes('describe') && !code.includes('test')) {
      warnings.push('No test blocks found - ensure proper test structure');
    }

    if (!code.includes('400') && !code.includes('error')) {
      warnings.push('No error handling tests found - add negative test cases');
    }

    if (!code.includes('null') && !code.includes('undefined')) {
      warnings.push('No null/undefined checks - add edge case validation');
    }

    if (code.includes('localhost') || code.includes('127.0.0.1')) {
      warnings.push('Hardcoded localhost URLs - use environment variables');
    }

    if (!code.includes('async') && !code.includes('await') && !code.includes('.then')) {
      warnings.push('No asynchronous handling detected - API tests should be async');
    }

    // Count test cases
    const testCount = (code.match(/it\(|test\(|it\.|test\./g) || []).length;
    if (testCount < 10) {
      warnings.push(`Only ${testCount} test cases found - consider adding more for better coverage`);
    }

    return warnings;
  }

  private generateSuggestions(code: string, options: GenerationOptions): string[] {
    const suggestions: string[] = [];

    // Framework-specific suggestions
    if (options.framework === 'jest' && !code.includes('mock')) {
      suggestions.push('Consider using jest.mock() for external dependencies');
    }

    if (!code.includes('timeout')) {
      suggestions.push('Add timeout configurations for long-running tests');
    }

    if (!code.includes('retry')) {
      suggestions.push('Consider adding retry logic for flaky tests');
    }

    if (!code.includes('data-driven') && !code.includes('each') && !code.includes('forEach')) {
      suggestions.push('Use data-driven tests for multiple input combinations');
    }

    if (!code.includes('performance') && options.includePerformanceTests) {
      suggestions.push('Add performance timing assertions');
    }

    if (!code.includes('cleanup') && !code.includes('afterEach')) {
      suggestions.push('Add cleanup in afterEach to prevent test pollution');
    }

    return suggestions;
  }
}