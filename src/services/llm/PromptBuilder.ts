import { HARData, GenerationOptions } from '@/types';
import { AuthFlow } from '../AuthFlowAnalyzer';

export class PromptBuilder {
  private static instance: PromptBuilder;

  private constructor() {}

  static getInstance(): PromptBuilder {
    if (!PromptBuilder.instance) {
      PromptBuilder.instance = new PromptBuilder();
    }
    return PromptBuilder.instance;
  }

  buildStandardizedPrompt(
    harData: HARData,
    options: GenerationOptions,
    authFlow?: AuthFlow,
    customAuthGuide?: string
  ): string {
    const framework = options.framework || 'jest';
    const testType = (options as any).testType || 'individual';

    // Framework-specific indicators
    const playwrightIndicator = framework === 'playwright' ? ' (YOU ARE GENERATING PLAYWRIGHT CODE)' : '';
    const cypressIndicator = framework === 'cypress' ? ' (YOU ARE GENERATING CYPRESS CODE)' : '';
    const jestIndicator = framework === 'jest' ? ' (YOU ARE GENERATING JEST CODE)' : '';
    const mochaIndicator = framework === 'mocha-chai' ? ' (YOU ARE GENERATING MOCHA/CHAI CODE)' : '';
    const vitestIndicator = framework === 'vitest' ? ' (YOU ARE GENERATING VITEST CODE)' : '';
    const supertestIndicator = framework === 'supertest' ? ' (YOU ARE GENERATING SUPERTEST CODE)' : '';
    const puppeteerIndicator = framework === 'puppeteer' ? ' (YOU ARE GENERATING PUPPETEER CODE)' : '';
    const postmanIndicator = framework === 'postman' ? ' (YOU ARE GENERATING POSTMAN TESTS)' : '';

    const authInstructions = this.buildAuthInstructions(authFlow, customAuthGuide);

    const frameworkTemplates = this.getFrameworkTemplates();
    const validationSection = this.getValidationSection(framework, playwrightIndicator, cypressIndicator);
    const frameworkExampleSection = this.getFrameworkExampleSection(framework, frameworkTemplates);

    return `You are an expert API test automation engineer. Generate production-ready ${framework.toUpperCase()} test code.

${validationSection}

⚠️ CRITICAL GENERATION MODE: ${testType === 'individual' ? 'INDIVIDUAL TESTS' : 'SUITE'}
${testType === 'individual'
  ? this.getIndividualModeInstructions(framework)
  : this.getSuiteModeInstructions(framework)}

${frameworkExampleSection}

MANDATORY REQUIREMENTS:
1. Generate COMPLETE, RUNNABLE test code with proper imports
2. Use EXACT ${framework.toUpperCase()} APIs - DO NOT MIX frameworks
3. All assertions must be comprehensive and test actual response structure
4. Include proper error handling and timeout configuration
5. Follow framework best practices and conventions
6. Use const for all variable declarations, NOT let or var
7. Include authentication setup if needed
8. CRITICAL: Each test MUST have a UNIQUE, DESCRIPTIVE name that includes:
   - The HTTP method (GET, POST, etc.)
   - The endpoint path or a meaningful part of it
   - The test scenario (success, error, validation, etc.)
   Examples:
   - "should successfully GET user profile from /api/users/123"
   - "should return 404 when POST to /api/users with invalid ID"
   - "should validate required fields for PUT /api/products/:id"
   NEVER use generic names like "Test 1", "API Test", or duplicate test names
9. Implement retry logic for flaky endpoints
10. Generate tests for ALL endpoints in the HAR data

${authInstructions}

HAR Data to process:
${JSON.stringify(harData, null, 2)}

Generation Options:
${JSON.stringify(options, null, 2)}

Remember:
- NEVER use placeholder values like "YOUR_API_KEY" or TODO comments
- Extract all actual values from the HAR data
- Generate exhaustive tests covering all status codes and response variations
- Include negative test cases and edge cases
- Follow the EXACT framework syntax for ${framework.toUpperCase()}`;
  }

  private buildAuthInstructions(authFlow?: AuthFlow, customAuthGuide?: string): string {
    if (customAuthGuide) {
      return `AUTHENTICATION INSTRUCTIONS (CUSTOM):
${customAuthGuide}

Apply these authentication requirements to all tests.`;
    }

    if (!authFlow) {
      return '';
    }

    let authInstructions = 'AUTHENTICATION CONFIGURATION:\n';

    // Handle auth pattern
    if (authFlow.authPattern) {
      authInstructions += `- Authentication pattern: ${authFlow.authPattern}\n`;
    }

    // Handle auth tokens
    if (authFlow.authTokens && authFlow.authTokens.length > 0) {
      authInstructions += '- Auth tokens detected:\n';
      authFlow.authTokens.forEach(token => {
        authInstructions += `  - Type: ${token.type}, Field: ${token.field}, Source: ${token.source}\n`;
      });
    }

    // Handle session cookies
    if (authFlow.sessionCookies && authFlow.sessionCookies.length > 0) {
      authInstructions += `- Session cookies: ${authFlow.sessionCookies.join(', ')}\n`;
    }

    // Handle login endpoint
    if (authFlow.loginEndpoint) {
      authInstructions += `- Login endpoint: ${authFlow.loginEndpoint.method} ${authFlow.loginEndpoint.url}\n`;
    }

    return authInstructions;
  }

  private getValidationSection(framework: string, playwrightIndicator: string, cypressIndicator: string): string {
    return `⚠️ FRAMEWORK API VALIDATION - DO NOT MIX:

FOR PLAYWRIGHT${playwrightIndicator}:
🚨🚨🚨 CRITICAL PLAYWRIGHT WARNING: ANY USE OF JEST SYNTAX WILL BE REJECTED 🚨🚨🚨
❌ WRONG: describe() ➡️ ✅ CORRECT: test.describe()
❌ WRONG: it() ➡️ ✅ CORRECT: test()
❌ WRONG: beforeAll() ➡️ ✅ CORRECT: test.beforeAll()
❌ WRONG: beforeEach() ➡️ ✅ CORRECT: test.beforeEach()
❌ WRONG: afterEach() ➡️ ✅ CORRECT: test.afterEach()
❌ WRONG: afterAll() ➡️ ✅ CORRECT: test.afterAll()
✅ MUST USE: import { test, expect } from '@playwright/test';
⚠️  VERIFY YOUR OUTPUT: Check that EVERY test uses test.describe() and test(), not describe() and it()

FOR REST ASSURED${framework === 'restassured' ? ' (SELECTED)' : ''}:
🚨🚨🚨 CRITICAL REST ASSURED WARNING: ABSOLUTELY NO JAVASCRIPT SYNTAX ALLOWED 🚨🚨🚨
❌ WRONG: describe() or it() blocks ➡️ ✅ CORRECT: @Test methods in Java class
❌ WRONG: expect() or assert() ➡️ ✅ CORRECT: statusCode(), body(), header() with Hamcrest matchers
❌ WRONG: async/await, const, let ➡️ ✅ CORRECT: Java syntax only
✅ MUST USE: public class ClassName { @Test public void testName() { given().when().then(); } }
⚠️  VERIFY YOUR OUTPUT: Check that it's PURE JAVA with no JavaScript syntax whatsoever

FOR CYPRESS${cypressIndicator}:
✅ CORRECT: describe() and it()
✅ MUST USE: cy.request() for API calls
✅ MUST USE: cy.wrap() for promises

FOR JEST/VITEST:
✅ CORRECT: describe() and it() or test()
✅ MUST USE: expect() from respective framework`;
  }

  private getIndividualModeInstructions(framework: string): string {
    switch (framework) {
      case 'restassured':
        return `For REST ASSURED individual mode:
     - Create ONE Java test class
     - Create SEPARATE @Test methods for EACH endpoint
     - Each test should be independently runnable
     - Use @BeforeClass/@AfterClass for shared setup/teardown`;
      case 'playwright':
        return `For PLAYWRIGHT individual mode:
     - Create ONE test.describe block
     - Create SEPARATE test() blocks for EACH endpoint
     - Each test should be independently runnable
     - Use test.beforeAll/test.afterAll for setup/teardown`;
      case 'postman':
        return `For POSTMAN individual mode:
     - Create ONE collection
     - Create SEPARATE request items for EACH endpoint
     - Each request should be independently runnable
     - Use pre-request scripts for shared setup`;
      default:
        return `For ${framework} individual mode:
     - Create ONE describe block
     - Create SEPARATE test/it blocks for EACH endpoint
     - Each test should be independently runnable
     - Use proper setup/teardown for test isolation`;
    }
  }

  private getSuiteModeInstructions(framework: string): string {
    switch (framework) {
      case 'restassured':
        return `For REST ASSURED suite mode:
     - Create test classes grouped by logical functionality
     - Share setup between related tests using @BeforeClass`;
      case 'playwright':
        return `For PLAYWRIGHT suite mode:
     - Create test.describe blocks grouped by logical functionality
     - Share setup between related tests using test.beforeAll`;
      case 'postman':
        return `For POSTMAN suite mode:
     - Create collection folders grouped by logical functionality
     - Share variables and pre-request scripts between related requests`;
      default:
        return `For ${framework} suite mode:
     - Create test suites grouped by logical functionality
     - Share setup between related tests`;
    }
  }

  private getFrameworkExampleSection(framework: string, templates: Record<string, string>): string {
    const template = templates[framework];
    if (!template) return '';

    return `EXACT ${framework.toUpperCase()} TEMPLATE TO FOLLOW:
\`\`\`javascript
${template}
\`\`\``;
  }

  private getFrameworkTemplates(): Record<string, string> {
    return {
      playwright: `import { test, expect } from '@playwright/test';

test.describe('API Tests', () => {
  const baseURL = 'https://api.example.com';

  test.beforeEach(async ({ request }) => {
    // Setup code
  });

  test('should successfully GET user list from /api/users', async ({ request }) => {
    const response = await request.get(\`\${baseURL}/api/users\`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('users');
  });

  test('should return 401 when GET /api/users without auth token', async ({ request }) => {
    const response = await request.get(\`\${baseURL}/api/users\`);
    expect(response.status()).toBe(401);
  });
});`,

      jest: `const axios = require('axios');

describe('API Tests', () => {
  const baseURL = 'https://api.example.com';

  beforeEach(() => {
    // Setup code
  });

  it('should successfully GET product details from /api/products/123', async () => {
    const response = await axios.get(\`\${baseURL}/api/products/123\`);
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('id', 123);
    expect(response.data).toHaveProperty('name');
  });

  it('should return 404 when GET non-existent product from /api/products/999', async () => {
    try {
      await axios.get(\`\${baseURL}/api/products/999\`);
    } catch (error) {
      expect(error.response.status).toBe(404);
    }
  });
});`,

      cypress: `describe('API Tests', () => {
  const baseURL = 'https://api.example.com';

  beforeEach(() => {
    // Setup code
  });

  it('should successfully POST new order to /api/orders', () => {
    cy.request({
      method: 'POST',
      url: \`\${baseURL}/api/orders\`,
      body: { productId: 123, quantity: 2 }
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body).to.have.property('orderId');
      expect(response.body).to.have.property('status', 'pending');
    });
  });

  it('should return 400 when POST invalid data to /api/orders', () => {
    cy.request({
      method: 'POST',
      url: \`\${baseURL}/api/orders\`,
      body: { quantity: -1 },
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(400);
      expect(response.body).to.have.property('error');
    });
  });
});`,

      'mocha-chai': `const chai = require('chai');
const chaiHttp = require('chai-http');
const expect = chai.expect;

chai.use(chaiHttp);

describe('API Tests', () => {
  const baseURL = 'https://api.example.com';

  beforeEach(function() {
    // Setup code
  });

  it('should fetch data successfully', async function() {
    const response = await chai.request(baseURL)
      .get('/endpoint');
    expect(response).to.have.status(200);
    expect(response.body).to.have.property('expected_field');
  });
});`,

      mocha: `const axios = require('axios');
const assert = require('assert');

describe('API Tests', function() {
  const baseURL = 'https://api.example.com';

  beforeEach(function() {
    // Setup code
  });

  it('should fetch data successfully', async function() {
    const response = await axios.get(\`\${baseURL}/endpoint\`);
    assert.strictEqual(response.status, 200);
    assert(response.data.hasOwnProperty('expected_field'));
  });

  it('should handle error responses', async function() {
    try {
      await axios.get(\`\${baseURL}/nonexistent\`);
      assert.fail('Expected request to fail');
    } catch (error) {
      assert.strictEqual(error.response.status, 404);
    }
  });
});`,

      vitest: `import { describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';

describe('API Tests', () => {
  const baseURL = 'https://api.example.com';

  beforeEach(() => {
    // Setup code
  });

  it('should fetch data successfully', async () => {
    const response = await axios.get(\`\${baseURL}/endpoint\`);
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('expected_field');
  });
});`,

      supertest: `const request = require('supertest');
const app = require('../app'); // Your Express app

describe('API Tests', () => {
  let server;

  beforeEach(() => {
    server = request(app);
  });

  it('should GET /api/users successfully', async () => {
    const response = await server
      .get('/api/users')
      .set('Authorization', 'Bearer your-token')
      .expect(200)
      .expect('Content-Type', /json/);
    
    expect(response.body).toHaveProperty('users');
    expect(Array.isArray(response.body.users)).toBe(true);
  });

  it('should POST /api/users with validation', async () => {
    const newUser = { name: 'John Doe', email: 'john@example.com' };
    
    const response = await server
      .post('/api/users')
      .send(newUser)
      .set('Content-Type', 'application/json')
      .expect(201);
    
    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe(newUser.name);
  });

  it('should return 400 for invalid POST data', async () => {
    await server
      .post('/api/users')
      .send({ invalid: 'data' })
      .expect(400);
  });
});`,

      puppeteer: `const puppeteer = require('puppeteer');

describe('API Tests', () => {
  let browser, page;
  const baseURL = 'https://api.example.com';

  beforeEach(async () => {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    
    // Enable request interception
    await page.setRequestInterception(true);
  });

  afterEach(async () => {
    await browser.close();
  });

  it('should intercept and validate API call', async () => {
    let apiResponse = null;
    
    page.on('response', response => {
      if (response.url().includes('/api/endpoint')) {
        apiResponse = response;
      }
    });
    
    // Navigate to page that makes API call
    await page.goto('https://example.com/app');
    
    // Wait for API call to complete
    await page.waitForFunction(() => apiResponse !== null);
    
    expect(apiResponse.status()).toBe(200);
    const data = await apiResponse.json();
    expect(data).toHaveProperty('expected_field');
  });
});`,

      postman: `{
  "info": {
    "name": "API Test Collection",
    "description": "Generated API test collection",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "GET Endpoint Test",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{authToken}}"
          }
        ],
        "url": {
          "raw": "{{baseUrl}}/api/endpoint",
          "host": ["{{baseUrl}}"],
          "path": ["api", "endpoint"]
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status code is 200', function () {",
              "    pm.response.to.have.status(200);",
              "});",
              "",
              "pm.test('Response has expected field', function () {",
              "    const jsonData = pm.response.json();",
              "    pm.expect(jsonData).to.have.property('expectedField');",
              "});",
              "",
              "pm.test('Response time is acceptable', function () {",
              "    pm.expect(pm.response.responseTime).to.be.below(1000);",
              "});"
            ]
          }
        }
      ]
    }
  ],
  "variable": [
    {
      "key": "baseUrl",
      "value": "https://api.example.com"
    },
    {
      "key": "authToken",
      "value": "your-auth-token-here"
    }
  ]
}`,

      restassured: `import io.restassured.RestAssured;
import io.restassured.specification.RequestSpecification;
import static io.restassured.RestAssured.*;
import static org.hamcrest.Matchers.*;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

public class APITests {
    
    private RequestSpecification requestSpec;
    
    @BeforeClass
    public void setup() {
        RestAssured.baseURI = "https://api.example.com";
        requestSpec = given()
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer your-token-here");
    }
    
    @Test
    public void testGetEndpoint() {
        given()
            .spec(requestSpec)
        .when()
            .get("/api/endpoint")
        .then()
            .statusCode(200)
            .body("status", equalTo("success"))
            .body("data", notNullValue())
            .time(lessThan(1000L));
    }
    
    @Test
    public void testPostEndpoint() {
        String requestBody = "{\\"key\\": \\"value\\"}";
        
        given()
            .spec(requestSpec)
            .body(requestBody)
        .when()
            .post("/api/endpoint")
        .then()
            .statusCode(201)
            .body("id", notNullValue())
            .body("created", equalTo(true));
    }
}`
    };
  }

  validateFrameworkSyntax(code: string, framework: string): string[] {
    const warnings: string[] = [];

    switch (framework) {
      case 'playwright':
        if (code.match(/(?<!test\.)describe\s*\(/g)) {
          warnings.push('Found "describe(" instead of "test.describe(" in Playwright code');
        }
        if (code.match(/(?<!test\.)beforeEach\s*\(/g)) {
          warnings.push('Found "beforeEach(" instead of "test.beforeEach(" in Playwright code');
        }
        if (code.match(/(?<!test\.)afterEach\s*\(/g)) {
          warnings.push('Found "afterEach(" instead of "test.afterEach(" in Playwright code');
        }
        if (code.includes('it(') && !code.includes('test(')) {
          warnings.push('Found "it(" instead of "test(" in Playwright code');
        }
        if (!code.includes("import { test, expect } from '@playwright/test'")) {
          warnings.push('Missing proper Playwright import statement');
        }
        break;

      case 'cypress':
        if (!code.includes('cy.request') && !code.includes('cy.')) {
          warnings.push('Missing Cypress cy.request() for API calls');
        }
        break;

      case 'restassured':
        if (code.includes('describe(') || code.includes('it(') || code.includes('test(')) {
          warnings.push('Found JavaScript test syntax in REST Assured Java code - should use @Test methods');
        }
        if (code.includes('expect(') && !code.includes('import')) {
          warnings.push('Found expect() in REST Assured code - should use Hamcrest matchers');
        }
        if (!code.includes('@Test') && code.length > 100) {
          warnings.push('Missing @Test annotations in REST Assured code');
        }
        if (!code.includes('given()') && !code.includes('when()') && !code.includes('then()')) {
          warnings.push('Missing given().when().then() pattern in REST Assured code');
        }
        break;

      case 'jest':
      case 'vitest':
        if (code.includes('test.describe')) {
          warnings.push(`Found "test.describe" in ${framework} code - should be "describe"`);
        }
        break;
    }

    // Check for const usage
    if (code.match(/\blet\s+\w+\s*=/g) || code.match(/\bvar\s+\w+\s*=/g)) {
      warnings.push('Found let or var declarations - should use const');
    }

    // Check for unique test names
    const testNamePattern = /(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    const testNames: string[] = [];
    let match;

    while ((match = testNamePattern.exec(code)) !== null) {
      const testName = match[1];
      if (testNames.includes(testName)) {
        warnings.push(`Duplicate test name found: "${testName}" - each test must have a unique name`);
      }
      testNames.push(testName);

      // Check if test name is too generic
      const genericNames = ['test', 'api test', 'test 1', 'test 2', 'should work', 'should pass', 'success'];
      if (genericNames.includes(testName.toLowerCase())) {
        warnings.push(`Generic test name found: "${testName}" - use descriptive names with endpoint info`);
      }

      // Check if test name includes HTTP method and endpoint info
      const hasHttpMethod = /\b(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/i.test(testName);
      const hasEndpoint = /\/\w+/.test(testName) || /endpoint|api|resource/.test(testName.toLowerCase());

      if (!hasHttpMethod && !hasEndpoint) {
        warnings.push(`Test name "${testName}" should include HTTP method and endpoint information`);
      }
    }

    return warnings;
  }
}