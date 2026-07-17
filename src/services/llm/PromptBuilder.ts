export class PromptBuilder {
  private static instance: PromptBuilder;

  private constructor() {}

  static getInstance(): PromptBuilder {
    if (!PromptBuilder.instance) {
      PromptBuilder.instance = new PromptBuilder();
    }
    return PromptBuilder.instance;
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
        return `📌 RULE 2 — POSTMAN REQUEST ITEM FORMAT (MUST follow EXACTLY):
- Output ONLY request item object(s) — NOT a full collection wrapper
- Do NOT include "info", "variable", or top-level "item" array — we add those automatically
- Output MUST be valid JSON: a single request item object with { name, request, event }
- Use pm.test() and pm.expect() inside "event" arrays
- NEVER output describe(), it(), or expect() — those are JavaScript framework syntax
- NEVER output comments (// ...) — JSON does not allow comments`;

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
📐 CODE STRUCTURE — Output a SINGLE JSON request item object:
1. "name" — descriptive name like "GET /todos/1 - Tests"
2. "request" — method, headers, url, body (if applicable)
3. "event" — array with test script containing pm.test() assertions
Do NOT wrap in a collection. Do NOT include "info" or "variable" keys.
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
  /**
   * Strip markdown code fences (and any surrounding prose) from an LLM
   * response. Models frequently wrap output in ```lang ... ``` despite being
   * told not to; left in place the fences produce a syntactically broken test
   * file. Handles: a single fenced block, multiple fenced blocks (some models
   * split imports and tests), and an unterminated leading fence.
   */
  stripCodeFences(code: string): string {
    const out = code.trim();

    const fenceRegex = /```[a-zA-Z0-9_+-]*[ \t]*\r?\n([\s\S]*?)```/g;
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(out)) !== null) {
      blocks.push(match[1].replace(/\s+$/, ''));
    }

    if (blocks.length > 0) {
      // Prefer the fenced content; join multiple blocks in order.
      return blocks.join('\n\n').trim();
    }

    // No complete fence pair — drop a leading ```lang line and a trailing ```.
    return out
      .replace(/^```[a-zA-Z0-9_+-]*[ \t]*\r?\n?/, '')
      .replace(/\r?\n?```[ \t]*$/, '')
      .trim();
  }

  sanitizeGeneratedCode(code: string, framework: string): string {
    // Always strip fences first, for every framework — JSON/Postman output
    // gets wrapped too, and a stray fence breaks the parser downstream.
    let sanitized = this.stripCodeFences(code);

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