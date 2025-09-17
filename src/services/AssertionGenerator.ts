import { HAREntry } from '@/types';
import { TestFramework } from '@/types';

export interface ResponseSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  items?: any;
  [key: string]: any;
}

export interface BusinessRule {
  description: string;
  assertion: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export class AssertionGenerator {
  private static instance: AssertionGenerator;

  static getInstance(): AssertionGenerator {
    if (!AssertionGenerator.instance) {
      AssertionGenerator.instance = new AssertionGenerator();
    }
    return AssertionGenerator.instance;
  }

  generateComprehensiveAssertions(
    endpoint: HAREntry, 
    framework: TestFramework
  ): string {
    const assertions = [
      this.generateStatusAssertions(endpoint, framework),
      this.generateHeaderAssertions(endpoint, framework),
      this.generateSchemaAssertions(endpoint, framework),
      this.generatePerformanceAssertions(endpoint, framework),
      this.generateSecurityAssertions(endpoint, framework),
      this.generateBusinessLogicAssertions(endpoint, framework)
    ].filter(Boolean);
    
    return assertions.join('\n\n');
  }

  private generateStatusAssertions(endpoint: HAREntry, framework: TestFramework): string {
    const status = endpoint.response.status;
    const method = endpoint.request.method;
    
    const statusExpectation = this.getFrameworkStatusAssertion(framework, status);
    
    return `    // Status code validation
    ${statusExpectation}
    
    // Status code range validation
    if (response.status >= 200 && response.status < 300) {
      // Success status codes (2xx)
      ${this.getFrameworkAssertion(framework, 'response.status >= 200 && response.status < 300', true)}
    } else if (response.status >= 400 && response.status < 500) {
      // Client error status codes (4xx)
      ${this.getFrameworkAssertion(framework, 'response.status >= 400 && response.status < 500', true)}
    } else if (response.status >= 500) {
      // Server error status codes (5xx)
      ${this.getFrameworkAssertion(framework, 'response.status >= 500', true)}
    }`;
  }

  private generateHeaderAssertions(endpoint: HAREntry, framework: TestFramework): string {
    const responseHeaders = endpoint.response.headers;
    const assertions: string[] = [];

    // Content-Type validation
    const contentType = responseHeaders.find(h => h.name.toLowerCase() === 'content-type');
    if (contentType) {
      assertions.push(`    // Content-Type validation
    ${this.getFrameworkAssertion(framework, `responseHeaders['content-type'] || responseHeaders['Content-Type']`, 'toBeDefined')}
    ${this.getFrameworkAssertion(framework, `(responseHeaders['content-type'] || responseHeaders['Content-Type']).includes('${contentType.value.split(';')[0]}')`, true)}`);
    }

    // Security headers validation
    const securityHeaders = [
      'x-frame-options',
      'x-content-type-options',
      'x-xss-protection',
      'strict-transport-security',
      'content-security-policy'
    ];

    const foundSecurityHeaders = responseHeaders.filter(h => 
      securityHeaders.includes(h.name.toLowerCase())
    );

    if (foundSecurityHeaders.length > 0) {
      assertions.push(`    // Security headers validation`);
      foundSecurityHeaders.forEach(header => {
        assertions.push(`    ${this.getFrameworkAssertion(framework, `responseHeaders['${header.name.toLowerCase()}']`, 'toBeDefined')}`);
      });
    }

    // CORS headers (if present)
    const corsHeaders = responseHeaders.filter(h => 
      h.name.toLowerCase().startsWith('access-control-')
    );

    if (corsHeaders.length > 0) {
      assertions.push(`    // CORS headers validation`);
      corsHeaders.forEach(header => {
        assertions.push(`    ${this.getFrameworkAssertion(framework, `responseHeaders['${header.name.toLowerCase()}']`, 'toBeDefined')}`);
      });
    }

    return assertions.join('\n');
  }

  private generateSchemaAssertions(endpoint: HAREntry, framework: TestFramework): string {
    const responseBody = endpoint.response.content.text;
    
    if (!responseBody) {
      return `    // Response body validation
    ${this.getFrameworkAssertion(framework, 'responseBody', 'toBeDefined')}`;
    }

    try {
      const parsedBody = JSON.parse(responseBody);
      const schema = this.inferResponseSchema(parsedBody);
      
      return `    // Response schema validation
    const responseSchema = ${JSON.stringify(schema, null, 6)};
    
    ${framework === 'cypress' ? `
    cy.then(() => {
      const ajv = require('ajv');
      const validate = ajv.compile(responseSchema);
      const isValid = validate(responseBody);
      
      if (!isValid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(isValid).to.be.true;
    });` : `
    const ajv = new Ajv();
    const validate = ajv.compile(responseSchema);
    const isValid = validate(responseBody);
    
    if (!isValid) {
      console.error('Schema validation errors:', validate.errors);
    }
    ${this.getFrameworkAssertion(framework, 'isValid', true)}`}
    
    // Type-specific validations
    ${this.generateTypeSpecificAssertions(parsedBody, framework)}`;
    } catch (error) {
      return `    // Response body validation (non-JSON)
    ${this.getFrameworkAssertion(framework, 'responseBody', 'toBeDefined')}
    ${this.getFrameworkAssertion(framework, 'typeof responseBody', 'string')}`;
    }
  }

  private inferResponseSchema(data: any): ResponseSchema {
    if (Array.isArray(data)) {
      return {
        type: 'array',
        items: data.length > 0 ? this.inferResponseSchema(data[0]) : { type: 'object' },
        minItems: 0
      };
    }

    if (data === null) {
      return { type: 'null' };
    }

    if (typeof data === 'object') {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(data)) {
        properties[key] = this.inferResponseSchema(value);
        if (value !== null && value !== undefined) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
        additionalProperties: false
      };
    }

    if (typeof data === 'string') {
      // Try to detect specific string formats
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(data)) {
        return { type: 'string', format: 'date-time' };
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data)) {
        return { type: 'string', format: 'email' };
      }
      if (/^https?:\/\//.test(data)) {
        return { type: 'string', format: 'uri' };
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
        return { type: 'string', format: 'uuid' };
      }
      return { type: 'string' };
    }

    if (typeof data === 'number') {
      return Number.isInteger(data) ? { type: 'integer' } : { type: 'number' };
    }

    if (typeof data === 'boolean') {
      return { type: 'boolean' };
    }

    return { type: 'string' }; // fallback
  }

  private generateTypeSpecificAssertions(data: any, framework: TestFramework): string {
    const assertions: string[] = [];

    if (Array.isArray(data)) {
      assertions.push(`    // Array-specific validations
    ${this.getFrameworkAssertion(framework, 'Array.isArray(responseBody)', true)}
    ${this.getFrameworkAssertion(framework, 'responseBody.length >= 0', true)}`);

      if (data.length > 0) {
        assertions.push(`    ${this.getFrameworkAssertion(framework, 'responseBody.length', data.length)}`);
      }
    } else if (typeof data === 'object' && data !== null) {
      const keys = Object.keys(data);
      assertions.push(`    // Object-specific validations
    ${this.getFrameworkAssertion(framework, 'typeof responseBody', 'object')}
    ${this.getFrameworkAssertion(framework, 'responseBody !== null', true)}`);

      // Validate required properties
      keys.forEach(key => {
        if (data[key] !== null && data[key] !== undefined) {
          assertions.push(`    ${this.getFrameworkAssertion(framework, `responseBody.hasOwnProperty('${key}')`, true)}`);
        }
      });
    }

    return assertions.join('\n');
  }

  private generatePerformanceAssertions(endpoint: HAREntry, framework: TestFramework): string {
    const time = endpoint.time || 1000; // Default 1 second if not available
    const reasonableTime = Math.max(time * 1.5, 5000); // 150% of actual time or 5 seconds, whichever is higher

    return `    // Performance assertions
    const responseTime = ${this.getResponseTimeCode(framework)};
    ${this.getFrameworkAssertion(framework, `responseTime < ${reasonableTime}`, true)} // Response time should be reasonable
    
    // Response size validation
    const responseSize = ${this.getResponseSizeCode(framework)};
    ${this.getFrameworkAssertion(framework, 'responseSize > 0', true)} // Response should have content
    ${this.getFrameworkAssertion(framework, 'responseSize < 10 * 1024 * 1024', true)} // Response should be < 10MB`;
  }

  private generateSecurityAssertions(endpoint: HAREntry, framework: TestFramework): string {
    const assertions: string[] = [];

    assertions.push(`    // Security validations
    // Ensure no sensitive data is exposed in response
    const responseText = JSON.stringify(responseBody || '');
    ${this.getFrameworkAssertion(framework, '!responseText.includes("password")', true)}
    ${this.getFrameworkAssertion(framework, '!responseText.includes("secret")', true)}
    ${this.getFrameworkAssertion(framework, '!responseText.includes("private_key")', true)}`);

    // Check for SQL injection indicators
    assertions.push(`    
    // SQL injection protection
    ${this.getFrameworkAssertion(framework, '!responseText.includes("SQL syntax")', true)}
    ${this.getFrameworkAssertion(framework, '!responseText.includes("mysql_")', true)}
    ${this.getFrameworkAssertion(framework, '!responseText.includes("ORA-")', true)}`);

    // XSS protection
    assertions.push(`    
    // XSS protection
    ${this.getFrameworkAssertion(framework, '!responseText.includes("<script>")', true)}
    ${this.getFrameworkAssertion(framework, '!responseText.includes("javascript:")', true)}`);

    return assertions.join('\n');
  }

  private generateBusinessLogicAssertions(endpoint: HAREntry, framework: TestFramework): string {
    const businessRules = this.inferBusinessRules(endpoint);
    
    if (businessRules.length === 0) {
      return `    // Business logic validations
    // Add specific business rules based on your application requirements
    ${this.getFrameworkAssertion(framework, 'responseBody', 'toBeDefined')}`;
    }

    const assertions = businessRules.map(rule => `
    // Business logic: ${rule.description}
    ${rule.assertion}`).join('\n');

    return `    // Business logic validations${assertions}`;
  }

  private inferBusinessRules(endpoint: HAREntry): BusinessRule[] {
    const rules: BusinessRule[] = [];
    const method = endpoint.request.method;
    const url = endpoint.request.url;
    const responseBody = endpoint.response.content.text;

    try {
      const parsedBody = JSON.parse(responseBody);

      // Common business rules based on HTTP method
      switch (method) {
        case 'POST':
          if (url.includes('login') || url.includes('auth')) {
            rules.push({
              description: 'Login should return authentication token',
              assertion: 'expect(responseBody).toHaveProperty("token");',
              severity: 'critical'
            });
          }
          if (url.includes('create') || url.includes('add')) {
            rules.push({
              description: 'Create operation should return created resource ID',
              assertion: 'expect(responseBody).toHaveProperty("id");',
              severity: 'high'
            });
          }
          break;

        case 'GET':
          if (url.includes('list') || url.includes('search')) {
            rules.push({
              description: 'List endpoint should return array or paginated results',
              assertion: 'expect(Array.isArray(responseBody) || responseBody.hasOwnProperty("items")).toBe(true);',
              severity: 'high'
            });
          }
          break;

        case 'PUT':
        case 'PATCH':
          rules.push({
            description: 'Update operation should return updated resource',
            assertion: 'expect(responseBody).toHaveProperty("id");',
            severity: 'medium'
          });
          break;

        case 'DELETE':
          rules.push({
            description: 'Delete operation should confirm deletion',
            assertion: 'expect([200, 204, 404]).toContain(response.status);',
            severity: 'medium'
          });
          break;
      }

      // Infer rules from response structure
      if (typeof parsedBody === 'object' && parsedBody !== null) {
        // Check for common response patterns
        if (parsedBody.hasOwnProperty('error') && parsedBody.hasOwnProperty('message')) {
          rules.push({
            description: 'Error response should have error and message fields',
            assertion: 'if (response.status >= 400) { expect(responseBody).toHaveProperty("error"); expect(responseBody).toHaveProperty("message"); }',
            severity: 'high'
          });
        }

        if (parsedBody.hasOwnProperty('total') && parsedBody.hasOwnProperty('items')) {
          rules.push({
            description: 'Paginated response should have consistent total and items count',
            assertion: 'if (responseBody.hasOwnProperty("total")) { expect(responseBody.items.length).toBeLessThanOrEqual(responseBody.total); }',
            severity: 'medium'
          });
        }

        if (parsedBody.hasOwnProperty('timestamp') || parsedBody.hasOwnProperty('createdAt')) {
          rules.push({
            description: 'Timestamp fields should be valid dates',
            assertion: 'if (responseBody.timestamp) { expect(new Date(responseBody.timestamp).getTime()).toBeGreaterThan(0); }',
            severity: 'low'
          });
        }
      }

    } catch (error) {
      // Non-JSON response, add basic rules
      rules.push({
        description: 'Response should not be empty',
        assertion: 'expect(responseBody.length).toBeGreaterThan(0);',
        severity: 'medium'
      });
    }

    return rules;
  }

  private getFrameworkStatusAssertion(framework: TestFramework, status: number): string {
    switch (framework) {
      case 'playwright':
        return `expect(response.status()).toBe(${status});`;
      case 'cypress':
        return `expect(response.status).to.equal(${status});`;
      case 'jest':
      case 'supertest':
        return `expect(response.status).toBe(${status});`;
      default:
        return `expect(response.status).toBe(${status});`;
    }
  }

  private getFrameworkAssertion(framework: TestFramework, expression: string, expected: any): string {
    const expectation = typeof expected === 'boolean' ? (expected ? 'toBeTruthy' : 'toBeFalsy') : 
                      typeof expected === 'string' ? `toBe('${expected}')` : 
                      expected === 'toBeDefined' ? 'toBeDefined()' :
                      `toBe(${expected})`;

    switch (framework) {
      case 'playwright':
        return `expect(${expression}).${expectation};`;
      case 'cypress':
        const cypressExpectation = expectation.replace('toBe', 'to.equal')
                                              .replace('toBeTruthy', 'to.be.true')
                                              .replace('toBeFalsy', 'to.be.false')
                                              .replace('toBeDefined()', 'to.exist');
        return `expect(${expression}).${cypressExpectation};`;
      default:
        return `expect(${expression}).${expectation};`;
    }
  }

  private getResponseTimeCode(framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        return 'Date.now() - startTime'; // Assume startTime is captured before request
      case 'cypress':
        return 'response.duration';
      default:
        return 'Date.now() - startTime';
    }
  }

  private getResponseSizeCode(framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        return 'JSON.stringify(responseBody).length';
      case 'cypress':
        return 'JSON.stringify(response.body).length';
      default:
        return 'JSON.stringify(responseBody).length';
    }
  }
}
