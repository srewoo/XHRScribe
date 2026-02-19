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
  const baseURL = process.env.BASE_URL || 'https://api.example.com';
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer token' };

  beforeEach(() => {
    // Setup code
  });

  it('should successfully GET product details from /api/products/123', async () => {
    const response = await axios.get(\`\${baseURL}/api/products/123\`, { headers });
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('id', 123);
    expect(response.data).toHaveProperty('name');
  });

  it('should successfully POST new product to /api/products', async () => {
    const response = await axios({
      method: 'POST',
      url: \`\${baseURL}/api/products\`,
      headers,
      data: { name: 'Widget', price: 9.99 }
    });
    expect(response.status).toBe(201);
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

  /**
   * Quality Gate: Self-check checklist the LLM must verify before outputting.
   * Borrowed from syspro prompt pattern.
   */
  getQualityGateSection(): string {
    return `
📋 QUALITY GATE — SELF-CHECK BEFORE OUTPUT:
Before finalizing your response, verify every item:

- [ ] All required request fields tested for omission (expect 400)
- [ ] All string fields tested for empty, null, whitespace, special characters, max length
- [ ] All numeric fields tested for zero, negative, boundary min/max
- [ ] Auth: no token, invalid token, expired token, wrong role all covered
- [ ] Schema validation on BOTH success and error responses
- [ ] Response time assertion present (< 2000ms default)
- [ ] No hardcoded credentials — environment variables used for all config
- [ ] Teardown cleans up all created resources
- [ ] All tests are independently runnable (no shared mutable state)
- [ ] Code is syntactically correct and immediately runnable
- [ ] ZERO duplicate import statements — each module imported exactly once
- [ ] ZERO semicolons inside object literals — only commas between properties
- [ ] Framework syntax matches EXACTLY — no mixing (e.g., no describe() in Playwright)
- [ ] Every test has a unique, descriptive name
- [ ] No empty test blocks, no TODO comments, no placeholder code

If any checkbox fails, FIX before outputting.
`;
  }

  /**
   * Syntax Enforcement Section: Prevents the 9 most common LLM code generation errors.
   * Covers: duplicate imports, framework mixing, object literal semicolons, invalid {;,
   * axios config errors, header semicolons, duplicate test names, wrong describe/test syntax,
   * and incorrect lifecycle hooks.
   */
  getSyntaxEnforcementSection(framework: string): string {
    const frameworkTable = this.getFrameworkSyntaxTable(framework);

    // Object literal rules only apply to JS/TS frameworks
    const isJavaScript = !['restassured', 'postman', 'karate'].includes(framework);

    let section = `
🚨🚨🚨 SYNTAX ENFORCEMENT — ZERO TOLERANCE FOR THESE ERRORS 🚨🚨🚨

📌 RULE 1 — NO DUPLICATE IMPORTS:
- ONE import block at the very top of the file
- Each module imported EXACTLY ONCE
- WRONG: Two \`import { test }\` or two \`require('axios')\` lines
- RIGHT: Single combined import per module

${frameworkTable}
`;

    if (isJavaScript) {
      section += `
📌 RULE 3 — OBJECT LITERAL SYNTAX (COMMAS, NOT SEMICOLONS):
Inside { }, properties are separated by COMMAS (,) — NEVER semicolons (;).

❌ WRONG (syntax error — will crash):
  const headers = { 'Content-Type': 'application/json'; 'Authorization': 'Bearer token'; }
  const config = {; method: 'POST' }
  const data = { name: 'test'; age: 25; }

✅ RIGHT:
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer token' }
  const config = { method: 'POST' }
  const data = { name: 'test', age: 25 }

REMEMBER: Semicolons END statements. Commas SEPARATE properties inside objects.
NEVER write {; — that is ALWAYS invalid.

📌 RULE 4 — HTTP CLIENT CONFIG OBJECTS:

❌ WRONG axios (semicolons inside config):
  axios({ method: 'POST'; url: '/api'; headers: { auth: 'token'; } })

✅ RIGHT axios:
  axios({
    method: 'POST',
    url: \`\${BASE_URL}/api/endpoint\`,
    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },
    data: { key: 'value' }
  })

✅ RIGHT fetch:
  fetch(\`\${BASE_URL}/api/endpoint\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },
    body: JSON.stringify({ key: 'value' })
  })
`;
    }

    section += `
📌 RULE 5 — UNIQUE TEST NAMES (NO DUPLICATES):
Each test MUST have a UNIQUE name including: [HTTP method] + [endpoint] + [scenario]

❌ WRONG (duplicate names — runner will skip/fail):
  test('should return 200', ...)
  test('should return 200', ...)

✅ RIGHT (unique, descriptive):
  test('should return 200 when GET /api/users with valid token', ...)
  test('should return 200 when GET /api/products with pagination', ...)

VERIFY: Scan ALL test names before output — every single one must be different.
`;

    return section;
  }

  private getFrameworkSyntaxTable(framework: string): string {
    switch (framework) {
      case 'playwright':
        return `📌 RULE 2 — PLAYWRIGHT SYNTAX TABLE (MUST follow EXACTLY):
| Concept      | ✅ CORRECT (Playwright)                              | ❌ WRONG (will break)           |
|-------------|------------------------------------------------------|--------------------------------|
| Test suite  | test.describe('...', () => {})                       | describe('...', () => {})      |
| Test case   | test('...', async ({ request }) => {})                | it('...', async () => {})      |
| Before all  | test.beforeAll(async () => {})                       | beforeAll(async () => {})      |
| Before each | test.beforeEach(async ({ request }) => {})            | beforeEach(async () => {})     |
| After each  | test.afterEach(async () => {})                       | afterEach(async () => {})      |
| After all   | test.afterAll(async () => {})                        | afterAll(async () => {})       |
| Import      | import { test, expect } from '@playwright/test'      | require('jest') or describe()  |

EVERY test function, EVERY hook, EVERY suite MUST use the ✅ column. ZERO exceptions.`;

      case 'jest':
        return `📌 RULE 2 — JEST SYNTAX TABLE (MUST follow EXACTLY):
| Concept      | ✅ CORRECT (Jest)                           | ❌ WRONG (will break)              |
|-------------|---------------------------------------------|------------------------------------|
| Test suite  | describe('...', () => {})                   | test.describe('...', () => {})     |
| Test case   | it('...', async () => {}) or test('...')    | test.describe() for test cases     |
| Before all  | beforeAll(async () => {})                   | test.beforeAll(...)                |
| Before each | beforeEach(async () => {})                  | test.beforeEach(...)               |
| After each  | afterEach(async () => {})                   | test.afterEach(...)                |
| After all   | afterAll(async () => {})                    | test.afterAll(...)                 |
| Import      | const axios = require('axios')              | import from '@playwright/test'     |

EVERY test function, EVERY hook, EVERY suite MUST use the ✅ column. ZERO exceptions.`;

      case 'cypress':
        return `📌 RULE 2 — CYPRESS SYNTAX TABLE (MUST follow EXACTLY):
| Concept      | ✅ CORRECT (Cypress)                        | ❌ WRONG (will break)              |
|-------------|---------------------------------------------|------------------------------------|
| Test suite  | describe('...', () => {})                   | test.describe(...)                 |
| Test case   | it('...', () => {})                         | test(...)                          |
| Before all  | before(() => {})                            | beforeAll(...)                     |
| Before each | beforeEach(() => {})                        | test.beforeEach(...)               |
| After each  | afterEach(() => {})                         | test.afterEach(...)                |
| After all   | after(() => {})                             | afterAll(...)                      |
| API call    | cy.request({ method, url, body })           | axios(...) or fetch(...)           |

Use cy.request() for ALL HTTP calls. NEVER use axios or fetch in Cypress tests.`;

      case 'vitest':
        return `📌 RULE 2 — VITEST SYNTAX TABLE (MUST follow EXACTLY):
| Concept      | ✅ CORRECT (Vitest)                                  | ❌ WRONG (will break)              |
|-------------|------------------------------------------------------|------------------------------------|
| Test suite  | describe('...', () => {})                            | test.describe(...)                 |
| Test case   | it('...', async () => {}) or test('...')             | test.describe() for test cases     |
| Before all  | beforeAll(async () => {})                            | test.beforeAll(...)                |
| Before each | beforeEach(async () => {})                           | test.beforeEach(...)               |
| Import      | import { describe, it, expect, beforeEach } from 'vitest' | require('jest')              |
| Mock        | vi.mock(...)                                         | jest.mock(...)                     |

EVERY import, test function, hook MUST use the ✅ column.`;

      case 'mocha-chai':
      case 'mocha':
        return `📌 RULE 2 — MOCHA SYNTAX TABLE (MUST follow EXACTLY):
| Concept      | ✅ CORRECT (Mocha)                          | ❌ WRONG (will break)              |
|-------------|---------------------------------------------|------------------------------------|
| Test suite  | describe('...', function() {})              | test.describe(...)                 |
| Test case   | it('...', async function() {})              | test(...)                          |
| Before all  | before(async function() {})                 | beforeAll(...)                     |
| Before each | beforeEach(async function() {})             | test.beforeEach(...)               |
| After each  | afterEach(async function() {})              | test.afterEach(...)                |
| After all   | after(async function() {})                  | afterAll(...)                      |

Use function() (not arrow =>) for proper 'this' context in Mocha.`;

      case 'supertest':
        return `📌 RULE 2 — SUPERTEST SYNTAX TABLE (MUST follow EXACTLY):
| Concept      | ✅ CORRECT (Supertest)                      | ❌ WRONG (will break)              |
|-------------|---------------------------------------------|------------------------------------|
| Test suite  | describe('...', () => {})                   | test.describe(...)                 |
| Test case   | it('...', async () => {})                   | test.describe() for test cases     |
| API call    | request(app).get('/path').expect(200)       | axios(...) or fetch(...)           |
| Before all  | beforeAll(async () => {})                   | test.beforeAll(...)                |

Use request(app) chaining for all HTTP operations.`;

      case 'restassured':
        return `📌 RULE 2 — REST ASSURED SYNTAX TABLE (MUST follow EXACTLY):
| Concept      | ✅ CORRECT (Java/REST Assured)              | ❌ WRONG (will break)              |
|-------------|---------------------------------------------|------------------------------------|
| Test class  | public class APITests { }                   | describe('...', () => {})          |
| Test method | @Test public void testName() { }            | it('...', () => {})                |
| API call    | given().when().get("/path").then()           | axios(...) or fetch(...)           |
| Setup       | @BeforeClass public static void setup()     | beforeAll(...)                     |
| Cleanup     | @AfterClass public static void cleanup()    | afterAll(...)                      |
| Assertion   | .statusCode(200).body("key", equalTo("v"))  | expect(...).toBe(...)              |

Generate PURE JAVA code. ZERO JavaScript syntax allowed.`;

      case 'postman':
        return `📌 RULE 2 — POSTMAN COLLECTION FORMAT (MUST follow EXACTLY):
- Output MUST be valid JSON (Postman Collection v2.1.0)
- Use pm.test() and pm.expect() inside "event" arrays
- NEVER output describe(), it(), or expect() — those are JavaScript framework syntax
- Collection structure: { info, item[], variable[] }`;

      default:
        return `📌 RULE 2 — Use ONLY ${framework.toUpperCase()} syntax. Do NOT mix with other frameworks.`;
    }
  }

  /**
   * Structured Code Template: Enforces imports → config → constants → helpers → tests → teardown.
   * Adapted from syspro Phase 4 code structure.
   */
  getCodeStructureTemplate(framework: string): string {
    if (framework === 'postman') {
      return `
📐 CODE STRUCTURE — Follow this order:
1. Collection info and variables
2. Pre-request scripts for auth/setup
3. Request items grouped by endpoint
4. Test scripts per request with assertions
5. Collection-level cleanup scripts
`;
    }

    if (framework === 'restassured') {
      return `
📐 CODE STRUCTURE — Follow this exact order:
1. [IMPORT BLOCK] — All Java imports (RestAssured, Hamcrest, TestNG/JUnit)
2. [CONFIG BLOCK] — Static fields: BASE_URL from System.getenv(), AUTH_TOKEN, expected schemas
3. [CONSTANTS BLOCK] — HTTP status codes, response time thresholds, field name constants
4. [HELPER METHODS] — makeRequest(), assertSchema(), getAuthHeaders()
5. [@BeforeClass SETUP] — Authenticate, seed test data
6. [@Test METHODS] — Grouped by endpoint, each method self-contained
7. [@AfterClass TEARDOWN] — Delete created resources, revoke tokens
`;
    }

    return `
📐 CODE STRUCTURE — Follow this exact order in your output:

1. [IMPORT BLOCK]
   - All framework imports at the top
   - HTTP client imports (axios, fetch, etc.)

2. [ENVIRONMENT / CONFIG BLOCK]
   - const BASE_URL = process.env.BASE_URL || 'https://captured-url';
   - const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
   - Expected response schema definitions

3. [CONSTANTS BLOCK]
   - HTTP status codes as named constants
   - Response time thresholds (e.g., const MAX_RESPONSE_TIME = 2000)
   - Reusable field names and test values

4. [HELPER / UTILITY FUNCTIONS]
   - getAuthHeaders() — returns auth headers object
   - assertResponseSchema(response, schema) — validates response shape
   - createTestData() — generates test payloads

5. [TEST SUITE]
   - ${framework === 'playwright' ? 'test.beforeAll' : 'beforeAll'} — authenticate, seed data
   - Group 1: Authentication & Authorization Tests
   - Group 2: Positive / Happy Path Tests
   - Group 3: Input Validation & Negative Tests
   - Group 4: Edge Case & Boundary Tests
   - Group 5: Security Tests
   - Group 6: Response Contract & Schema Tests

6. [TEARDOWN]
   - ${framework === 'playwright' ? 'test.afterAll' : 'afterAll'} — delete created resources, revoke tokens
`;
  }

  /**
   * Per-Field Input Validation Matrix: Enumerates specific test patterns per field type.
   * Adapted from syspro Phase 3.3.
   */
  getInputValidationMatrix(): string {
    return `
🧪 PER-FIELD INPUT VALIDATION MATRIX:
For EACH request body field and query parameter, generate tests for these patterns:

| Pattern               | What to send                            | Expected |
|-----------------------|-----------------------------------------|----------|
| Missing required      | Omit the field entirely                 | 400      |
| Wrong type            | String where number expected, etc.      | 400      |
| Empty string          | ""                                      | 400/200  |
| Null value            | null                                    | 400      |
| Whitespace only       | "   "                                   | 400      |
| Zero value            | 0 for numeric fields                    | Varies   |
| Negative number       | -1 for numeric fields                   | 400      |
| Boundary min          | Minimum valid value                     | 200      |
| Boundary max          | Maximum valid value                     | 200      |
| Boundary min-1        | One below minimum                       | 400      |
| Boundary max+1        | One above maximum                       | 400      |
| Max length string     | String at exactly max length            | 200      |
| Over max length       | String one char over max                | 400      |
| Special characters    | !@#$%^&*()_+-=[]{}|;':",./<>?          | 400      |
| Unicode               | Chinese chars, emoji, RTL Arabic        | Varies   |
| HTML injection        | <script>alert(1)</script>               | 400      |
| SQL injection         | ' OR '1'='1                             | 400      |
| Very long string      | 10000+ character string                 | 400      |
| Array where object    | [] where {} expected                    | 400      |
| Extra unknown fields  | Fields not in the schema                | Ignored  |

Apply these patterns to each field based on its type (string, number, boolean, array, object).
`;
  }

  /**
   * Schema Validation Requirement: Instructs LLM to use proper schema validation libraries.
   * Adapted from syspro Code Quality Requirement #4.
   */
  getSchemaValidationRequirement(framework: string): string {
    if (framework === 'restassured') {
      return `
🔍 RESPONSE SCHEMA VALIDATION — MANDATORY:
- Use JsonPath and Hamcrest matchers for schema validation
- Validate ALL required fields are present in the response
- Validate field types match expected types (String, Integer, Boolean, etc.)
- Validate nested object structures recursively
- Validate array contents have correct item shapes
- Check that error responses also match error schema (errorCode, message, details)
- NEVER just check status code — always validate the full response body structure
`;
    }

    if (framework === 'postman') {
      return `
🔍 RESPONSE SCHEMA VALIDATION — MANDATORY:
- Use tv4 or Ajv in Postman test scripts for JSON schema validation
- Define response schemas as JSON Schema objects
- Validate success AND error response schemas
- Check all required fields, field types, and nested structures
- NEVER just check status code — always validate the full response body structure
`;
    }

    const libraryMap: Record<string, string> = {
      jest: 'Use a schema check helper (e.g., define expected shape and validate with expect().toMatchObject() or a Joi/Zod schema)',
      playwright: 'Use expect().toMatchObject() for schema shape validation, or define a Zod schema and validate',
      'mocha-chai': 'Use chai-json-schema or define expected shapes with deep.include',
      cypress: 'Use cy.wrap(response.body).should() with deep checks or JSON schema validation',
      vitest: 'Use expect().toMatchObject() or a Zod schema for validation',
      supertest: 'Use expect().toMatchObject() or a validation library like Joi/Zod',
      puppeteer: 'Use expect().toMatchObject() or define schemas for validation',
    };

    const library = libraryMap[framework] || libraryMap.jest;

    return `
🔍 RESPONSE SCHEMA VALIDATION — MANDATORY:
- ${library}
- Validate ALL required fields are present in EVERY response
- Validate field types match expected types (string, number, boolean, array, object)
- Validate nested object structures recursively
- Check that NO extra undocumented fields leak into the response (contract check)
- Validate error responses match error schema (error code, message, details)
- Date/time fields must be in correct ISO 8601 format
- Arrays must be arrays, never null
- NEVER just check status code — ALWAYS validate the full response body structure
`;
  }

  /**
   * Test Naming Convention + Anti-Pattern List.
   * Combines syspro's given_when_then naming with NEVER DO list.
   */
  getNamingAndAntiPatterns(framework: string): string {
    const namingExample = framework === 'restassured'
      ? `   testGivenValidToken_WhenGetUsers_ThenReturns200WithUserList()
   testGivenNoAuth_WhenGetUsers_ThenReturns401()`
      : `   "given valid token, when GET /users, then returns 200 with user list"
   "given no auth, when GET /users, then returns 401"`;

    return `
📝 TEST NAMING CONVENTION — Use given_when_then pattern:
Format: given_[precondition]_when_[action]_then_[expected_result]

Examples:
${namingExample}

This makes test output self-documenting and failures immediately understandable.

🚫 NEVER DO — Anti-patterns that MUST be avoided:
1. Never generate empty test blocks (no body or just a comment)
2. Never output "// TODO: add assertions here" or similar placeholders
3. Never use Math.random() or dynamic IDs without a seeding strategy
4. Never skip teardown — always clean up created resources
5. Never use console.log in test files
6. Never use var — only const and let (JS/TS)
7. Never mix test frameworks in one file
8. Never hardcode localhost, actual credentials, or API keys
9. Never assume a 200 status code means the test passed without asserting the response body
10. Never generate duplicate test names
`;
  }

  /**
   * Auto-fix common LLM code generation errors before displaying to user.
   * Fixes: {; patterns, semicolons in objects, framework syntax mixing, duplicate imports.
   */
  sanitizeGeneratedCode(code: string, framework: string): string {
    let sanitized = code;

    // Skip sanitization for non-JS frameworks
    const isJavaScript = !['restassured', 'postman', 'karate'].includes(framework);

    if (isJavaScript) {
      // Fix 1: Remove {; patterns (always invalid JS)
      sanitized = sanitized.replace(/\{\s*;/g, '{');

      // Fix 2: Fix semicolons between object properties on the same line
      // Pattern: { key: 'value'; key2: 'value2' } → { key: 'value', key2: 'value2' }
      // Matches: string_value; followed by a property key
      sanitized = sanitized.replace(
        /(['"][^'"]*['"])\s*;\s*(?=['"]?\w+['"]?\s*:)/g,
        '$1, '
      );
      // Matches: numeric/boolean/null value; followed by a property key
      sanitized = sanitized.replace(
        /(\b(?:\d+(?:\.\d+)?|true|false|null)\b)\s*;\s*(?=['"]?\w+['"]?\s*:)/g,
        '$1, '
      );
      // Matches: variable_name; followed by a property key (e.g., headers: token; data: {})
      sanitized = sanitized.replace(
        /(\b\w+)\s*;\s*(?=['"]?\w+['"]?\s*:)/g,
        '$1, '
      );
    }

    // Fix 3: Framework-specific syntax corrections
    if (framework === 'playwright') {
      // Replace bare describe( with test.describe(
      sanitized = sanitized.replace(/(?<!test\.)(?<!\w)describe\s*\(/g, 'test.describe(');
      // Replace bare it( with test(
      sanitized = sanitized.replace(/(?<!\w)it\s*\(\s*(['"`])/g, 'test($1');
      // Replace bare lifecycle hooks with test.* variants
      sanitized = sanitized.replace(/(?<!test\.)(?<!\w)beforeAll\s*\(/g, 'test.beforeAll(');
      sanitized = sanitized.replace(/(?<!test\.)(?<!\w)beforeEach\s*\(/g, 'test.beforeEach(');
      sanitized = sanitized.replace(/(?<!test\.)(?<!\w)afterEach\s*\(/g, 'test.afterEach(');
      sanitized = sanitized.replace(/(?<!test\.)(?<!\w)afterAll\s*\(/g, 'test.afterAll(');
    }

    if (framework === 'jest' || framework === 'vitest') {
      // Replace Playwright-style test.describe with describe
      sanitized = sanitized.replace(/test\.describe\s*\(/g, 'describe(');
      sanitized = sanitized.replace(/test\.beforeAll\s*\(/g, 'beforeAll(');
      sanitized = sanitized.replace(/test\.beforeEach\s*\(/g, 'beforeEach(');
      sanitized = sanitized.replace(/test\.afterEach\s*\(/g, 'afterEach(');
      sanitized = sanitized.replace(/test\.afterAll\s*\(/g, 'afterAll(');
    }

    // Fix 4: Remove duplicate imports (keep first occurrence)
    const lines = sanitized.split('\n');
    const seenModules = new Set<string>();
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      const isImport = /^import\s+/.test(trimmed) || /^const\s+.+=\s*require\(/.test(trimmed);
      if (isImport) {
        const fromMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
        const requireMatch = trimmed.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
        const mod = fromMatch?.[1] || requireMatch?.[1];
        if (mod) {
          if (seenModules.has(mod)) {
            return false; // Skip duplicate
          }
          seenModules.add(mod);
        }
      }
      return true;
    });
    sanitized = filteredLines.join('\n');

    return sanitized;
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

    // Check for duplicate imports
    const importLines = code.match(/^(?:import\s+.+|const\s+.+=\s*require\(.+\))/gm) || [];
    const importModules = new Set<string>();
    importLines.forEach(line => {
      const fromMatch = line.match(/from\s+['"]([^'"]+)['"]/);
      const requireMatch = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
      const mod = fromMatch?.[1] || requireMatch?.[1];
      if (mod) {
        if (importModules.has(mod)) {
          warnings.push(`Duplicate import of "${mod}" — each module should be imported exactly once`);
        }
        importModules.add(mod);
      }
    });

    // Check for semicolons inside object literals (common LLM error)
    if (code.match(/\{\s*;/) ) {
      warnings.push('Found "{;" pattern — invalid object initialization');
    }
    // Check for property: value; inside objects (not after closing brace)
    if (code.match(/['"][^'"]+['"]\s*:\s*['"][^'"]*['"]\s*;(?!\s*$)/m)) {
      warnings.push('Possible semicolons inside object literal — use commas between properties, not semicolons');
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