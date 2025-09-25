import axios, { AxiosError } from 'axios';
import { encode } from 'gpt-tokenizer';
import { HARData, GenerationOptions, GeneratedTest } from '@/types';
import { LLMProvider } from '../LLMService';
import { AuthFlow, AuthFlowAnalyzer } from '../../AuthFlowAnalyzer';

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
    options: GenerationOptions,
    authFlow?: AuthFlow,
    customAuthGuide?: string
  ): Promise<GeneratedTest> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const prompt = this.buildExhaustivePrompt(harData, options, authFlow, customAuthGuide);
    const promptTokens = this.countTokens(prompt);
    const systemPromptTokens = this.countTokens(this.getSystemPrompt());
    const totalInputTokens = promptTokens + systemPromptTokens;

    // Check token limits before making API call - be more aggressive with limits
    const modelLimit = this.getMaxTokens(options.model);
    if (totalInputTokens > modelLimit * 0.5) { // Leave 50% for response to ensure complete generation
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
            max_tokens: Math.min(16000, Math.floor((modelLimit - totalInputTokens) * 0.95)), // Use up to 95% of remaining tokens
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
          warnings: this.analyzeCode(generatedCode, options.framework),
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
4. Use proper test organization.
5. Include setup/teardown when necessary
6. Add comments explaining complex test scenarios
7. Ensure tests are maintainable and follow best practices
8. Mock external dependencies when appropriate
9. Include performance assertions where relevant
10. Add data-driven tests for multiple input combinations

IMPORTANT: Generate actual runnable code, not pseudocode or examples.`;
  }

  private buildExhaustivePrompt(harData: HARData, options: GenerationOptions, authFlow?: AuthFlow, customAuthGuide?: string): string {
    const framework = options.framework;
    const entries = harData.entries; // Process ALL entries, no artificial limits

    // Group endpoints by unique signature to avoid duplicates (GraphQL-aware)
    const uniqueEndpoints = new Map<string, typeof entries[0]>();
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
    
    let prompt = `🔥🔥🔥 NUCLEAR ALERT - CRITICAL REQUIREMENT 🔥🔥🔥

I AM PAYING FOR COMPLETE TEST GENERATION. INCOMPLETE RESPONSES WILL BE REJECTED.

YOU MUST GENERATE COMPLETE, FULLY-IMPLEMENTED ${framework} TEST CODE FOR ALL ${uniqueEndpoints.size} ENDPOINTS.

🚫 ABSOLUTELY FORBIDDEN - INSTANT REJECTION:
❌ "Continue adding more endpoint tests..." 
❌ "Follow the same pattern for remaining endpoints"
❌ "Add more tests here" or "TODO: implement more tests"
❌ "Similar tests can be added for other endpoints"
❌ "You can add more tests..." or "Additional tests..."
❌ "Repeat for other endpoints" or "...and so on"
❌ Any variation of "continue", "add more", "follow pattern"
❌ Stopping after generating only some endpoints
❌ Template or example code instead of actual tests

🔥 MANDATORY REQUIREMENTS:
✅ GENERATE ACTUAL WORKING CODE FOR ALL ${uniqueEndpoints.size} ENDPOINTS
✅ Each endpoint gets a complete test suite with 10-15 real test cases
✅ NO placeholder comments, NO template suggestions
✅ Production-ready, runnable code that I can use immediately

Framework: ${framework}
${this.getFrameworkInstructions(framework)}

🔥 CRITICAL CODE QUALITY REQUIREMENTS - ZERO TOLERANCE FOR BUGS:

⚠️ IMPORTS & SETUP:
✅ ALWAYS include proper imports at the top (e.g., const { test, expect } = require('@playwright/test');)
✅ Define ALL constants: BASE_URL, AUTH_URL, TEST_USERNAME, TEST_PASSWORD
✅ Use environment variables: process.env.BASE_URL || 'default_value'

⚠️ SYNTAX & STRUCTURE:
✅ Use ONLY ${framework === 'playwright' ? 'test()' : 'test() or it()'} functions (NO mixing)
✅ Use proper JavaScript syntax (NO TypeScript type annotations like ': string')
✅ Ensure proper bracket matching and indentation
✅ Use consistent request patterns: ${framework === 'playwright' ? 'async ({ request }) =>' : 'appropriate pattern'}
✅ ONE main test suite wrapping all endpoints

⚠️ VARIABLE CONSISTENCY:
✅ Use consistent variable names throughout
✅ Declare authToken properly: let authToken; (NOT let authToken: string;)
✅ Use responseBody consistently for all response parsing
✅ Use standard error property checking (error, not errorCode)

⚠️ REQUEST PATTERNS:
✅ ${framework === 'playwright' ? 'Always use ({ request }) parameter in test functions' : 'Use consistent request patterns'}
✅ Consistent header handling for authentication
✅ Proper async/await usage throughout
✅ Safe response parsing with content-type checking

⚠️ TEST ORGANIZATION:
✅ Clear, unique endpoint descriptions (e.g., "POST /login", "GET /users")
✅ Logical test numbering and grouping
✅ No duplicate describe blocks for same endpoint
✅ Proper test interdependency handling
✅ ONE main test suite wrapper, with individual test suites for each endpoint  
✅ ALL test functions at the same nesting level within their endpoint test suite
✅ NO test suites nested inside other test suites

⚠️ STRUCTURAL REQUIREMENTS:
✅ ALWAYS start with imports: const { test, expect } = require('@playwright/test');
✅ Declare variables: const BASE_URL, const TEST_USERNAME, const TEST_PASSWORD, let authToken;
✅ ONE main test suite wrapper with proper framework syntax
✅ Authentication setup with appropriate beforeAll/setup hook at the top level
✅ Each endpoint gets its own test suite with proper framework syntax
✅ All test functions inside endpoint test suites
✅ PROPER closing: each test suite ends properly
✅ Final closing for main test suite

🚫 NEVER DO THIS:
❌ Nested test suite duplicates  
❌ Missing imports or variable declarations
❌ Mixing different test function types
❌ Unclosed test suite blocks
❌ Missing authToken setup

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

    // Add authentication setup if detected
    if (authFlow) {
      prompt += this.generateAuthenticationSection(authFlow, framework, customAuthGuide);
    }

    prompt += `\n\n🎯 MANDATORY: GENERATE COMPLETE TESTS FOR ALL ${uniqueEndpoints.size} ENDPOINTS BELOW:\n`;

    // Generate specific requirements for each unique endpoint
    Array.from(uniqueEndpoints.values()).forEach((entry, index) => {
      const url = new URL(entry.request.url);
      const method = entry.request.method;
      const isGraphQL = url.pathname.includes('graphql');
      const requestBody = entry.request.postData?.text;
      const responseBody = entry.response.content.text;
      const statusCode = entry.response.status;
      
      prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 ENDPOINT ${index + 1}/${uniqueEndpoints.size}: ${method} ${url.pathname}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 REQUEST DETAILS:
Full URL: ${entry.request.url}
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
${requestBody ? requestBody.substring(0, 500) : 'No request body'}

📥 RESPONSE DETAILS:
Status: ${statusCode}
${entry.response.headers && entry.response.headers.length > 0 
  ? `Response Headers:\n${entry.response.headers.map(h => `${h.name}: ${h.value}`).join('\n')}`
  : 'No response headers'}

🍪 RESPONSE COOKIES:
${entry.response.cookies && entry.response.cookies.length > 0 
  ? entry.response.cookies.map(c => `${c.name}=${c.value}${c.domain ? `; Domain=${c.domain}` : ''}${c.httpOnly ? '; HttpOnly' : ''}${c.secure ? '; Secure' : ''}`).join('\n')
  : 'No response cookies'}

📦 RESPONSE BODY:
${responseBody ? responseBody.substring(0, 500) : 'No response body'}

🚨 MANDATORY TESTS FOR THIS ENDPOINT (Generate ALL of these):

1. ✅ HAPPY PATH TEST:
   - Valid request exactly as captured
   - Verify ${statusCode} status code
   - Validate response structure and content

2. ❌ ERROR TESTS (Generate 5-8 error scenarios):
   - 400: Invalid/malformed request data
   - 401: Missing/invalid authentication
   - 403: Insufficient permissions (if applicable)
   - 404: Invalid endpoint or resource not found
   - 422: Invalid request format or validation errors
   - 500: Server error simulation
   ${method !== 'GET' ? '- Test with invalid content-type headers' : ''}

3. 🔧 EDGE CASE TESTS (Generate 3-5 edge cases):
   - Empty/null values in request
   - Maximum/minimum boundary values
   - Special characters and Unicode
   - Large payload testing (if POST/PUT)
   ${isGraphQL ? '- GraphQL-specific edge cases (query depth, invalid syntax)' : ''}

4. 🛡️ SECURITY TESTS:
   - XSS injection attempts
   - SQL injection attempts (if applicable)
   - Authentication bypass attempts
   
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    });

    prompt += `

🔥🔥🔥 FINAL ULTIMATUM - NO EXCEPTIONS 🔥🔥🔥

I WILL REJECT ANY RESPONSE THAT:
❌ Contains "continue", "add more", "follow pattern", "similar tests", "and so on"
❌ Has fewer than ${uniqueEndpoints.size} describe blocks
❌ Stops generating after only some endpoints
❌ Uses placeholder or template comments

🎯 EXACT REQUIREMENTS:
1. Generate ${uniqueEndpoints.size} complete describe blocks (one per endpoint)
2. Each describe block contains 10-15 actual test cases
3. All code must be production-ready and runnable
4. No shortcuts, no placeholders, no "continue" instructions

📊 MANDATORY OUTPUT STRUCTURE:
Generate ${framework.toUpperCase()} test code following the framework's specific syntax and conventions.
Each endpoint must have a complete test suite with 10-15 individual test cases.
Use the framework's proper test organization, imports, and assertion methods.

🚨 BEFORE YOU RESPOND, VERIFY:
✅ ${uniqueEndpoints.size} test suites (one per endpoint)
✅ No "continue" or "add more" comments anywhere
✅ Every endpoint has complete test implementation
✅ Production-ready code that runs immediately

⚡ GENERATE COMPLETE TESTS FOR ALL ${uniqueEndpoints.size} ENDPOINTS NOW - NO EXCEPTIONS:`;

    return prompt;
  }

  private generateAuthenticationSection(authFlow: AuthFlow, framework: string, customAuthGuide?: string): string {
    let authSection = `\n\n🔐 ENHANCED AUTHENTICATION FLOW DETECTED:\n`;
    
    authSection += `Authentication Pattern: ${authFlow.authPattern}\n`;
    authSection += `Session Management: ${authFlow.sessionManagement}\n`;
    
    if (authFlow.loginEndpoint) {
      authSection += `Login Endpoint: ${authFlow.loginEndpoint.method} ${authFlow.loginEndpoint.url}\n`;
    }
    
    if (authFlow.authTokens.length > 0) {
      authSection += `Auth Tokens: ${authFlow.authTokens.map(t => `${t.type} (${t.source})`).join(', ')}\n`;
    }
    
    if (authFlow.sessionCookies.length > 0) {
      authSection += `Session Cookies: ${authFlow.sessionCookies.join(', ')}\n`;
    }
    
    // ENHANCED: OAuth 2.0 details
    if (authFlow.oauthFlow) {
      authSection += `OAuth Grant Type: ${authFlow.oauthFlow.grantType}\n`;
      authSection += `OAuth Scopes: ${authFlow.oauthFlow.scopes.join(', ')}\n`;
      authSection += `PKCE Enabled: ${authFlow.oauthFlow.pkceEnabled}\n`;
    }
    
    // ENHANCED: JWT details
    if (authFlow.jwtClaims) {
      authSection += `JWT Claims Detected: ${Object.keys(authFlow.jwtClaims).join(', ')}\n`;
    }
    
    // ENHANCED: Refresh token details
    if (authFlow.refreshToken) {
      authSection += `Refresh Token Endpoint: ${authFlow.refreshToken.endpoint}\n`;
      authSection += `Refresh Mechanism: ${authFlow.refreshToken.mechanism}\n`;
    }
    
    // ENHANCED: Additional security features
    if (authFlow.mfaRequired) {
      authSection += `MFA Required: YES\n`;
    }
    
    if (authFlow.csrfProtection) {
      authSection += `CSRF Protection: ${authFlow.csrfProtection.headerName}\n`;
    }
    
    authSection += `Protected Endpoints: ${authFlow.protectedEndpoints.length}\n`;

    authSection += `\n🚨 CRITICAL AUTHENTICATION REQUIREMENTS:\n`;
    authSection += `1. ✅ GENERATE COMPLETE AUTHENTICATION SETUP using the detected ${authFlow.authPattern} pattern\n`;
    authSection += `2. ✅ EXTRACT tokens/session data from login response and CHAIN to subsequent requests\n`;
    authSection += `3. ✅ Use environment variables for credentials (TEST_USERNAME, TEST_PASSWORD, API_KEY)\n`;
    authSection += `4. ✅ Include comprehensive beforeAll/beforeEach setup for authentication state\n`;
    authSection += `5. ✅ Generate auth-related error tests (401, 403) with proper error handling\n`;
    authSection += `6. ✅ Implement token refresh logic if refresh tokens are detected\n`;
    authSection += `7. ✅ Add CSRF token handling if CSRF protection is detected\n`;
    authSection += `8. ✅ Include proper cleanup/logout in afterAll hooks\n`;
    
    if (authFlow.oauthFlow) {
      authSection += `9. ✅ Implement OAuth 2.0 ${authFlow.oauthFlow.grantType} flow\n`;
      if (authFlow.oauthFlow.pkceEnabled) {
        authSection += `10. ✅ Include PKCE code challenge/verifier generation\n`;
      }
    }
    
    if (authFlow.mfaRequired) {
      authSection += `11. ✅ Handle MFA verification flow in tests\n`;
    }

    // Add custom authentication guide if provided by user (HIGHEST PRIORITY)
    if (customAuthGuide && customAuthGuide.trim()) {
      authSection += `\n\n🎯 CUSTOM AUTHENTICATION GUIDE (USER PROVIDED - HIGHEST PRIORITY):\n`;
      authSection += `${customAuthGuide.trim()}\n`;
      authSection += `\n🚨 CRITICAL: Follow the custom authentication guide above EXACTLY. This takes precedence over ALL auto-detected patterns.\n`;
      authSection += `The user has provided specific instructions for their authentication flow - implement it precisely!\n`;
    }

    // Add comprehensive framework-specific auth setup
    if (authFlow.loginEndpoint || authFlow.authTokens.length > 0) {
      const authFlowAnalyzer = AuthFlowAnalyzer.getInstance();
      const authSetup = authFlowAnalyzer.generateAuthSetup(authFlow, framework);
      if (authSetup) {
        authSection += `\n📋 COMPREHENSIVE AUTH SETUP TEMPLATE:\n\`\`\`${framework === 'cypress' ? 'javascript' : 'typescript'}\n${authSetup}\n\`\`\`\n`;
        authSection += `\n🔥 MANDATORY: Use this template as the foundation and extend it with detected authentication patterns!\n`;
      }
    }

    return authSection;
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
      
      playwright: `🚨 PLAYWRIGHT ONLY - NO JEST SYNTAX ALLOWED:
- ONLY use test.describe() for test suites (NEVER describe())
- ONLY use test() for test cases (NEVER it())
- ONLY use test.beforeAll/test.beforeEach/test.afterEach/test.afterAll (NEVER beforeAll/beforeEach/afterEach/afterAll)
- MUST import { test, expect } from '@playwright/test'
- Use { request } fixture for API testing
- Use expect() with Playwright-specific matchers
- Use test.skip() and test.only() for test control
❌ FORBIDDEN JEST SYNTAX: describe(), it(), beforeAll(), beforeEach(), afterAll(), afterEach()
✅ ONLY PLAYWRIGHT SYNTAX: test.describe(), test(), test.beforeAll(), test.beforeEach(), test.afterAll(), test.afterEach()`,
      
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
      
      restassured: `🚨 REST ASSURED (JAVA) ONLY - NO JAVASCRIPT SYNTAX ALLOWED:
- MANDATORY: Generate complete Java test class using REST Assured library
- MANDATORY: Use @Test annotations (TestNG or JUnit)
- MANDATORY: Import static io.restassured.RestAssured.* and static org.hamcrest.Matchers.*
- MANDATORY: Use given().when().then() BDD syntax for ALL tests
- MANDATORY: Use RequestSpecification for common configurations
- Use statusCode(), body(), header() methods for assertions
- Use Hamcrest matchers: equalTo(), notNullValue(), hasSize(), containsString()
- Include proper @BeforeClass for setup and @AfterClass for cleanup
- Use Response response = given().when().get() for advanced validations
❌ FORBIDDEN: Any JavaScript syntax, describe(), it(), expect(), async/await
✅ ONLY JAVA: public class, @Test, given().when().then(), assertThat()`,
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

  private analyzeCode(code: string, framework?: string): string[] {
    const warnings: string[] = [];

    // Framework-aware test structure detection
    const hasTests = this.detectTestStructure(code, framework);
    if (!hasTests) {
      warnings.push('No test structure found - ensure proper test organization');
    }

    if (!code.includes('400') && !code.includes('error')) {
      warnings.push('No error handling tests found - add negative test cases');
    }

    if (!code.includes('null') && !code.includes('undefined') && !code.includes('empty')) {
      warnings.push('No null/undefined checks - add edge case validation');
    }

    if (code.includes('localhost') || code.includes('127.0.0.1')) {
      warnings.push('Hardcoded localhost URLs - use environment variables');
    }

    // Framework-aware async detection
    const hasAsync = this.detectAsyncHandling(code, framework);
    if (!hasAsync) {
      warnings.push('No asynchronous handling detected - API tests should handle async operations');
    }

    // Framework-aware test case counting
    const testCount = this.countTestCases(code, framework);
    if (testCount < 10) {
      warnings.push(`Only ${testCount} test cases found - consider adding more for better coverage`);
    }

    return warnings;
  }

  private detectTestStructure(code: string, framework?: string): boolean {
    switch (framework) {
      case 'restassured':
        return code.includes('@Test') && code.includes('public');
      case 'playwright':
        return code.includes('test.describe') || code.includes('test(');
      case 'cypress':
        return code.includes('describe') && code.includes('cy.');
      case 'postman':
        return code.includes('"info"') && code.includes('"item"');
      default:
        return code.includes('describe') || code.includes('test') || code.includes('@Test');
    }
  }

  private detectAsyncHandling(code: string, framework?: string): boolean {
    switch (framework) {
      case 'restassured':
        // REST Assured doesn't need explicit async keywords - it's built into the library
        return code.includes('given()') || code.includes('when()');
      case 'postman':
        // Postman collections don't need async handling
        return true;
      default:
        return code.includes('async') || code.includes('await') || code.includes('.then');
    }
  }

  private countTestCases(code: string, framework?: string): number {
    switch (framework) {
      case 'restassured':
        // Count Java @Test methods
        return (code.match(/@Test\s+public\s+void/g) || []).length;
      case 'playwright':
        // Count Playwright test() calls
        return (code.match(/test\(/g) || []).length;
      case 'cypress':
        // Count it() calls in Cypress
        return (code.match(/it\(/g) || []).length;
      case 'postman':
        // Count test scripts in Postman collection items
        return (code.match(/"test"/g) || []).length;
      default:
        // Default JS/TS test patterns
        return (code.match(/it\(|test\(|it\.|test\./g) || []).length;
    }
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