import { TestFramework, HAREntry } from '@/types';

export class TestGenerationTemplates {
  static getSystemPrompt(framework: TestFramework, authGuide?: string): string {
    if (framework === 'restassured') {
      return `You are an expert Java QA automation engineer specializing in REST Assured API testing.
Your task is to generate comprehensive, production-ready Java test classes from API traffic data.

🚨🚨🚨 ABSOLUTE CRITICAL REQUIREMENTS FOR REST ASSURED 🚨🚨🚨:
1. Generate PURE JAVA CODE ONLY - ZERO JavaScript syntax allowed
2. Use REST Assured library syntax EXCLUSIVELY - NO mixing with other frameworks
3. MANDATORY: Start with import statements for REST Assured and Hamcrest
4. MANDATORY: Create public class with descriptive name
5. MANDATORY: Use @Test methods for each test scenario
6. MANDATORY: given().when().then() pattern for ALL API calls
7. MANDATORY: Hamcrest matchers for ALL assertions (equalTo, notNullValue, hasSize, etc.)
8. FORBIDDEN: Any mention of describe(), it(), expect(), async/await, const, let, function
9. REQUIRED: @BeforeClass for setup, @AfterClass for cleanup
10. REQUIRED: Use statusCode(), body(), header() for response validation

${authGuide ? `AUTHENTICATION GUIDE:\n${authGuide}\n` : ''}

IMPORTANT: Each API endpoint should have its own @Test method with comprehensive scenarios covering:
- Success scenarios with proper assertions
- Error handling (statusCode(400), statusCode(401), etc.)
- Edge cases with boundary testing
- Data validation using Hamcrest matchers
- Performance checks with time(lessThan(1000L))
- Security validations`;
    }

    const basePrompt = `You are an expert test automation engineer specializing in ${framework} test generation.
Your task is to generate comprehensive, production-ready test suites from API traffic data.

CRITICAL REQUIREMENTS:
1. Generate COMPLETE test files with ALL imports, setup, and teardown
2. Include proper error handling and assertions
3. Use realistic test data (not production data)
4. Follow ${framework} best practices
5. Include both positive and negative test cases
6. Add proper test descriptions and documentation
7. Ensure tests are independent and idempotent
8. Include performance assertions where applicable
9. Add security validation tests
10. Generate tests for EACH individual API endpoint separately

${authGuide ? `AUTHENTICATION GUIDE:\n${authGuide}\n` : ''}

IMPORTANT: Each API endpoint should have its own test organization with multiple test cases covering:
- Success scenarios
- Error handling (4xx, 5xx)
- Edge cases
- Data validation
- Performance checks
- Security validations`;

    return basePrompt;
  }

  static getFrameworkSpecificInstructions(framework: TestFramework): string {
    const instructions: Record<TestFramework, string> = {
      jest: `
Use Jest with axios or fetch for HTTP requests.
Structure:
- describe blocks for each endpoint
- beforeEach/afterEach for setup/teardown
- expect assertions
- async/await syntax
- Mock external dependencies`,

      playwright: `
🚨 CRITICAL PLAYWRIGHT REQUIREMENTS - NO JEST SYNTAX ALLOWED:

MANDATORY SYNTAX:
- ONLY test.describe() for test grouping (NEVER describe())
- ONLY test() for individual tests (NEVER it())
- ONLY test.beforeEach/test.afterEach for hooks (NEVER beforeEach/afterEach)
- ONLY test.beforeAll/test.afterAll for setup/cleanup (NEVER beforeAll/afterAll)
- MUST import { test, expect } from '@playwright/test'

API TESTING STRUCTURE:
- Use { request } fixture for all HTTP calls
- Use await request.get(), request.post(), etc.
- Use expect(response.status()).toBe() for status checks
- Use await response.json() for response parsing
- Proper async/await throughout

❌ ABSOLUTELY FORBIDDEN: describe(), it(), beforeAll(), beforeEach(), afterAll(), afterEach()
✅ ONLY ALLOWED: test.describe(), test(), test.beforeAll(), test.beforeEach(), test.afterAll(), test.afterEach()`,

      'mocha-chai': `
Use Mocha with Chai assertions and axios/supertest.
Structure:
- describe/it blocks
- before/after hooks
- chai expect/should assertions
- async/await or done callbacks
- Sinon for mocking`,

      mocha: `
Use Mocha with built-in assert and axios.
Structure:
- describe/it blocks
- before/after/beforeEach/afterEach hooks
- assert statements
- async/await syntax
- Function declarations for proper 'this' context`,

      cypress: `
Use Cypress cy.request for API testing.
Structure:
- describe/it blocks
- cy.request() for API calls
- cy.wrap for assertions
- before/beforeEach hooks
- Custom commands for reusability`,

      puppeteer: `
Use Puppeteer's page.evaluate for API testing.
Structure:
- describe/it blocks
- page.evaluate for requests
- Jest expect assertions
- async/await syntax`,

      vitest: `
Use Vitest with fetch or axios.
Structure:
- describe/test blocks
- beforeEach/afterEach
- expect assertions
- vi.mock for mocking
- Parallel execution by default`,

      supertest: `
Use Supertest with Express app testing.
Structure:
- describe/it blocks
- request(app) syntax
- .expect() chaining
- async/await or callbacks
- Jest or Mocha as test runner`,

      postman: `
🚨 CRITICAL: Generate ONLY valid Postman Collection JSON format - NO JavaScript test code!

REQUIRED JSON STRUCTURE:
- Complete Postman Collection v2.1.0 format
- Each API endpoint as separate "item" in collection
- Proper request configuration (method, headers, body, URL)
- Test scripts using pm.test() in "event" arrays
- Environment variables in "variable" array
- Pre-request scripts for authentication if needed

⚠️  OUTPUT MUST BE: Valid JSON that can be imported into Postman
⚠️  DO NOT OUTPUT: describe(), it(), expect(), or any JavaScript test framework code`,

      restassured: `
🚨🚨🚨 CRITICAL: PURE JAVA CODE ONLY - ZERO JavaScript SYNTAX ALLOWED 🚨🚨🚨

MANDATORY JAVA STRUCTURE:
- Use @Test annotations from TestNG or JUnit (NOT describe/it blocks)
- Import static io.restassured.RestAssured.*
- Import static org.hamcrest.Matchers.*
- Create public class with descriptive name
- Use given().when().then() BDD-style syntax for ALL API calls
- Include proper Hamcrest matchers for assertions (equalTo, notNullValue, hasSize)
- Use @BeforeClass/@AfterClass for setup/teardown
- Use RequestSpecification for shared configurations

🚫 ABSOLUTELY FORBIDDEN JAVASCRIPT SYNTAX:
- describe() blocks, it() functions, expect() calls
- async/await, const, let, var declarations
- function declarations, arrow functions
- Any JavaScript test framework patterns

✅ ONLY ALLOWED JAVA SYNTAX:
- public class ClassName { }
- @Test public void methodName() { }
- given().when().then() chains
- statusCode(), body(), header() validations`,

      k6: `
Use k6 for load and performance testing.
Structure:
- Import http from 'k6/http' and check from 'k6'
- Export options object for test configuration (vus, duration, thresholds)
- Export default function as main test entry
- Use http.get(), http.post() etc for requests
- Use check() for assertions
- Use sleep() between iterations
- Group related requests with group()`,

      artillery: `
Generate Artillery YAML configuration.
Structure:
- config section with target URL and phases
- scenarios array with test flows
- Use capture for response data extraction
- Define proper load phases (duration, arrivalRate)
- Include think time between requests
- Add assertions with expect`,

      pactum: `
Use PactumJS for API testing.
Structure:
- Import { spec, request } from 'pactum'
- Use describe/it blocks from Mocha or Jest
- Use spec() for fluent API testing
- Chain .get(), .post(), .withHeaders(), .withJson()
- Use .expectStatus(), .expectJson(), .expectJsonLike()
- Use request.setBaseUrl() for configuration`,

      karate: `
Generate Karate .feature files.
Structure:
- Feature declaration with description
- Background section for common setup (url, headers)
- Scenario sections for each test case
- Use Given/When/Then/And keywords
- Use Karate match syntax for assertions
- Support for JSON path expressions`,

      pytest: `
Use Pytest with requests library.
Structure:
- Import pytest and requests
- Use test_ prefix for test functions
- Use @pytest.fixture for setup/teardown
- Use assert statements for assertions
- Use @pytest.mark for test categorization
- Include proper type hints`,

      httpx: `
Use HTTPX for async Python API testing.
Structure:
- Import pytest, httpx, asyncio
- Use @pytest.mark.asyncio decorator
- Use async with httpx.AsyncClient()
- Use await for all HTTP calls
- Use assert for validations
- Include proper typing hints`
    };

    return instructions[framework] || instructions.jest;
  }

  static formatTestPrompt(
    har: HAREntry[],
    framework: TestFramework,
    options: any,
    authGuide?: string
  ): string {
    const systemPrompt = this.getSystemPrompt(framework, authGuide);
    const frameworkInstructions = this.getFrameworkSpecificInstructions(framework);

    // Group requests by endpoint
    const endpointGroups = this.groupByEndpoint(har);

    // Framework-specific prompt construction
    if (framework === 'postman') {
      return `${systemPrompt}

${frameworkInstructions}

GENERATE POSTMAN COLLECTION FOR THESE API ENDPOINTS:

${JSON.stringify(endpointGroups, null, 2)}

🚨 CRITICAL REQUIREMENTS FOR POSTMAN:
- Generate COMPLETE Postman Collection JSON (v2.1.0 format)
- Create separate "item" for EACH endpoint  
- Include proper request configuration (method, headers, body, URL)
- Add comprehensive test scripts in "event" arrays using pm.test()
- Use environment variables ({{baseUrl}}, {{authToken}})
- Add pre-request scripts for authentication if needed
${options.includeAuth ? '- Include authentication setup in pre-request scripts' : ''}
${options.includeErrorScenarios ? '- Include error scenario tests (pm.test for 400, 401, 403, 404, 500)' : ''}
${options.includePerformanceTests ? '- Include response time tests (pm.test("Response time", () => pm.expect(pm.response.responseTime).to.be.below(1000)))' : ''}
${options.includeSecurityTests ? '- Include header validation tests (pm.test for CORS, security headers)' : ''}
${options.generateMockData ? '- Use mock data in request bodies' : ''}

⚠️  OUTPUT FORMAT: ONLY valid JSON - NO JavaScript test framework code!
⚠️  VERIFY: Output must be importable into Postman application`;
    }

    if (framework === 'restassured') {
      return `${systemPrompt}

${frameworkInstructions}

GENERATE REST ASSURED JAVA TESTS FOR THESE API ENDPOINTS:

${JSON.stringify(endpointGroups, null, 2)}

🚨 CRITICAL REQUIREMENTS FOR REST ASSURED:
- Generate COMPLETE Java test class using REST Assured
- Create separate @Test method for EACH endpoint
- Use given().when().then() BDD-style syntax
- Include proper imports (static io.restassured.RestAssured.*, static org.hamcrest.Matchers.*)
- Add comprehensive assertions using Hamcrest matchers
- Use RequestSpecification for common configurations
- Include proper TestNG or JUnit annotations
${options.includeAuth ? '- Include authentication setup with RequestSpecification' : ''}
${options.includeErrorScenarios ? '- Include error scenario tests (statusCode(400), statusCode(401), etc.)' : ''}
${options.includePerformanceTests ? '- Include response time assertions (time(lessThan(1000L)))' : ''}
${options.includeSecurityTests ? '- Include header validation tests (header("header-name", equalTo("value")))' : ''}
${options.generateMockData ? '- Use mock JSON data in request bodies' : ''}

⚠️  OUTPUT FORMAT: Complete Java class with REST Assured tests
⚠️  VERIFY: Code must be compilable and executable with TestNG/JUnit`;
    }

    return `${systemPrompt}

${frameworkInstructions}

GENERATE TESTS FOR THESE API ENDPOINTS:

${JSON.stringify(endpointGroups, null, 2)}

REQUIREMENTS:
- Generate a COMPLETE test file
- Include ALL necessary imports
- Create separate test suites for EACH endpoint
- Add multiple test cases per endpoint (success, error, edge cases)
- Use descriptive test names
- Add comments explaining complex logic
- Ensure all tests are runnable
${options.includeAuth ? '- Include authentication tests' : ''}
${options.includeErrorScenarios ? '- Include error scenario tests (400, 401, 403, 404, 500)' : ''}
${options.includePerformanceTests ? '- Include performance tests (response time < 1000ms)' : ''}
${options.includeSecurityTests ? '- Include security tests (headers, CORS)' : ''}
${options.generateMockData ? '- Generate mock data instead of using real data' : ''}

OUTPUT FORMAT:
Generate a complete, runnable test file with proper structure and all test cases.`;
  }

  private static groupByEndpoint(entries: HAREntry[]): Record<string, any> {
    const groups: Record<string, any> = {};

    entries.forEach(entry => {
      const url = new URL(entry.request.url);
      const endpoint = `${entry.request.method} ${url.pathname}`;

      if (!groups[endpoint]) {
        groups[endpoint] = {
          method: entry.request.method,
          path: url.pathname,
          baseUrl: `${url.protocol}//${url.host}`,
          examples: []
        };
      }

      groups[endpoint].examples.push({
        headers: entry.request.headers,
        queryParams: url.searchParams.toString(),
        requestBody: entry.request.postData?.text,
        responseStatus: entry.response.status,
        responseBody: entry.response.content.text,
        responseTime: entry.time
      });
    });

    return groups;
  }

  static extractTestQuality(generatedCode: string, framework?: string): number {
    let score = 100;
    
    // Framework-aware quality checks
    const checks = this.getFrameworkQualityChecks(framework);

    checks.forEach(check => {
      const matches = generatedCode.match(check.pattern);
      if (check.required && !matches) {
        score -= check.weight * 2;
      } else if (matches && matches.length > 0) {
        // Bonus for having the pattern
      } else if (!check.required) {
        score -= check.weight / 2;
      }
    });

    // Framework-aware test count
    const testCount = this.countTestCases(generatedCode, framework);
    if (testCount < 3) score -= 20;
    if (testCount > 10) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  private static getFrameworkQualityChecks(framework?: string) {
    switch (framework) {
      case 'restassured':
        return [
          { pattern: /@Test/g, weight: 10, required: true },
          { pattern: /public\s+void\s+test/g, weight: 10, required: true },
          { pattern: /statusCode|equalTo|assertThat/g, weight: 10, required: true },
          { pattern: /given\(\)|when\(\)|then\(\)/g, weight: 5, required: true },
          { pattern: /@BeforeClass|@AfterClass/g, weight: 5, required: false },
          { pattern: /try[\s\S]*?catch/g, weight: 10, required: false },
          { pattern: /Response\s+response/g, weight: 5, required: false },
        ];
      case 'postman':
        return [
          { pattern: /"info"/g, weight: 10, required: true },
          { pattern: /"item"/g, weight: 10, required: true },
          { pattern: /pm\.test|pm\.expect/g, weight: 10, required: true },
          { pattern: /"test"/g, weight: 5, required: true },
          { pattern: /"variable"/g, weight: 5, required: false },
          { pattern: /pm\.response\.responseTime/g, weight: 5, required: false },
        ];
      case 'playwright':
        return [
          { pattern: /test\.describe\(/g, weight: 10, required: true },
          { pattern: /test\(/g, weight: 10, required: true },
          { pattern: /expect\(/g, weight: 10, required: true },
          { pattern: /async|await/g, weight: 5, required: true },
          { pattern: /test\.beforeAll|test\.beforeEach/g, weight: 5, required: false },
          { pattern: /request\./g, weight: 5, required: true },
        ];
      default:
        return [
          { pattern: /describe\(/g, weight: 10, required: true },
          { pattern: /it\(|test\(/g, weight: 10, required: true },
          { pattern: /expect\(|assert/g, weight: 10, required: true },
          { pattern: /async|await/g, weight: 5, required: false },
          { pattern: /beforeEach|beforeAll|before/g, weight: 5, required: false },
          { pattern: /try[\s\S]*?catch/g, weight: 10, required: false },
          { pattern: /\.status|statusCode/g, weight: 5, required: false },
          { pattern: /timeout|performance/gi, weight: 5, required: false },
        ];
    }
  }

  private static countTestCases(code: string, framework?: string): number {
    switch (framework) {
      case 'restassured':
        return (code.match(/@Test\s+public\s+void/g) || []).length;
      case 'postman':
        return (code.match(/"test"/g) || []).length;
      case 'playwright':
        return (code.match(/test\(/g) || []).length;
      default:
        return (code.match(/it\(|test\(/g) || []).length;
    }
  }
}