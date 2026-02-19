import { RecordingSession, NetworkRequest, TestFramework } from '@/types';

export interface SecurityTest {
  id: string;
  name: string;
  category: SecurityCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  payload: any;
  expectedBehavior: string;
  owaspReference?: string;
}

export type SecurityCategory =
  | 'injection'
  | 'broken_auth'
  | 'sensitive_data'
  | 'xxe'
  | 'broken_access'
  | 'security_misconfig'
  | 'xss'
  | 'insecure_deserialization'
  | 'components'
  | 'logging';

export interface SecurityTestSuite {
  endpoint: string;
  method: string;
  tests: SecurityTest[];
  riskScore: number;
  recommendations: string[];
}

export class SecurityTestGenerator {
  private static instance: SecurityTestGenerator;

  private constructor() {}

  static getInstance(): SecurityTestGenerator {
    if (!SecurityTestGenerator.instance) {
      SecurityTestGenerator.instance = new SecurityTestGenerator();
    }
    return SecurityTestGenerator.instance;
  }

  generateSecurityTests(session: RecordingSession): SecurityTestSuite[] {
    const suites: SecurityTestSuite[] = [];

    session.requests.forEach(request => {
      const tests: SecurityTest[] = [];

      // SQL Injection tests
      tests.push(...this.generateSQLInjectionTests(request));

      // XSS tests
      tests.push(...this.generateXSSTests(request));

      // Authentication tests
      tests.push(...this.generateAuthTests(request));

      // Authorization tests
      tests.push(...this.generateAuthorizationTests(request));

      // Sensitive data exposure tests
      tests.push(...this.generateSensitiveDataTests(request));

      // Rate limiting tests
      tests.push(...this.generateRateLimitTests(request));

      // CORS tests
      tests.push(...this.generateCORSTests(request));

      // Input validation tests
      tests.push(...this.generateInputValidationTests(request));

      if (tests.length > 0) {
        const riskScore = this.calculateRiskScore(tests);
        const recommendations = this.generateRecommendations(tests, request);

        suites.push({
          endpoint: request.url,
          method: request.method,
          tests,
          riskScore,
          recommendations
        });
      }
    });

    return suites;
  }

  private generateSQLInjectionTests(request: NetworkRequest): SecurityTest[] {
    const tests: SecurityTest[] = [];

    if (!request.requestBody && request.method === 'GET') {
      // Check URL parameters for injection points
      try {
        const url = new URL(request.url);
        if (url.searchParams.toString()) {
          tests.push(...this.createSQLInjectionTests('query', url.searchParams));
        }
      } catch {
        // Invalid URL
      }
    }

    if (request.requestBody) {
      const payloads = [
        { name: 'Basic SQL Injection', value: "' OR '1'='1" },
        { name: 'Union-based injection', value: "' UNION SELECT * FROM users--" },
        { name: 'Time-based blind', value: "'; WAITFOR DELAY '0:0:5'--" },
        { name: 'Error-based', value: "' AND 1=CONVERT(int, @@version)--" },
        { name: 'Boolean-based blind', value: "' AND 1=1--" },
        { name: 'Stacked queries', value: "'; DROP TABLE users;--" }
      ];

      payloads.forEach((payload, index) => {
        tests.push({
          id: `sql-injection-${index}`,
          name: `SQL Injection - ${payload.name}`,
          category: 'injection',
          severity: 'critical',
          description: `Test for ${payload.name} SQL injection vulnerability`,
          payload: this.injectPayload(request.requestBody, payload.value),
          expectedBehavior: 'Should return 400 Bad Request or sanitize input',
          owaspReference: 'A03:2021 - Injection'
        });
      });
    }

    return tests;
  }

  private createSQLInjectionTests(location: string, params: URLSearchParams): SecurityTest[] {
    const tests: SecurityTest[] = [];
    const payloads = ["' OR '1'='1", "1; DROP TABLE users--", "' UNION SELECT null--"];

    params.forEach((value, key) => {
      payloads.forEach((payload, index) => {
        tests.push({
          id: `sql-injection-${location}-${key}-${index}`,
          name: `SQL Injection in ${key} parameter`,
          category: 'injection',
          severity: 'critical',
          description: `Test SQL injection via ${location} parameter: ${key}`,
          payload: { [key]: payload },
          expectedBehavior: 'Should sanitize or reject malicious input',
          owaspReference: 'A03:2021 - Injection'
        });
      });
    });

    return tests;
  }

  private generateXSSTests(request: NetworkRequest): SecurityTest[] {
    const tests: SecurityTest[] = [];

    const payloads = [
      { name: 'Script tag', value: '<script>alert("XSS")</script>' },
      { name: 'Event handler', value: '<img src=x onerror=alert("XSS")>' },
      { name: 'SVG injection', value: '<svg onload=alert("XSS")>' },
      { name: 'JavaScript URL', value: 'javascript:alert("XSS")' },
      { name: 'Encoded script', value: '%3Cscript%3Ealert(%22XSS%22)%3C/script%3E' },
      { name: 'DOM-based', value: '"><script>alert(document.domain)</script>' }
    ];

    if (request.requestBody) {
      payloads.forEach((payload, index) => {
        tests.push({
          id: `xss-${index}`,
          name: `XSS - ${payload.name}`,
          category: 'xss',
          severity: 'high',
          description: `Test for ${payload.name} XSS vulnerability`,
          payload: this.injectPayload(request.requestBody, payload.value),
          expectedBehavior: 'Should encode or reject HTML/JavaScript content',
          owaspReference: 'A03:2021 - Injection'
        });
      });
    }

    return tests;
  }

  private generateAuthTests(request: NetworkRequest): SecurityTest[] {
    const tests: SecurityTest[] = [];
    const url = request.url.toLowerCase();
    const isAuthEndpoint = url.includes('login') || url.includes('auth') || url.includes('signin');

    if (isAuthEndpoint && request.method === 'POST') {
      tests.push(
        {
          id: 'auth-brute-force',
          name: 'Brute Force Protection',
          category: 'broken_auth',
          severity: 'high',
          description: 'Test if endpoint has brute force protection',
          payload: { username: 'test', password: 'wrong_password' },
          expectedBehavior: 'Should implement rate limiting after multiple failures',
          owaspReference: 'A07:2021 - Identification and Authentication Failures'
        },
        {
          id: 'auth-weak-password',
          name: 'Weak Password Acceptance',
          category: 'broken_auth',
          severity: 'medium',
          description: 'Test if weak passwords are accepted',
          payload: { username: 'test', password: '123' },
          expectedBehavior: 'Should enforce password complexity requirements',
          owaspReference: 'A07:2021 - Identification and Authentication Failures'
        },
        {
          id: 'auth-credential-stuffing',
          name: 'Credential Stuffing Protection',
          category: 'broken_auth',
          severity: 'high',
          description: 'Test protection against credential stuffing attacks',
          payload: { username: 'admin@test.com', password: 'password123' },
          expectedBehavior: 'Should detect and block repeated failed attempts',
          owaspReference: 'A07:2021 - Identification and Authentication Failures'
        }
      );
    }

    // JWT-related tests
    if (request.requestHeaders?.authorization?.includes('Bearer')) {
      tests.push(
        {
          id: 'auth-expired-token',
          name: 'Expired Token Handling',
          category: 'broken_auth',
          severity: 'high',
          description: 'Test handling of expired JWT tokens',
          payload: { authorization: 'Bearer expired_token_here' },
          expectedBehavior: 'Should return 401 Unauthorized',
          owaspReference: 'A07:2021 - Identification and Authentication Failures'
        },
        {
          id: 'auth-modified-token',
          name: 'Modified Token Detection',
          category: 'broken_auth',
          severity: 'critical',
          description: 'Test if modified JWT tokens are detected',
          payload: { authorization: 'Bearer modified_payload_token' },
          expectedBehavior: 'Should reject tampered tokens',
          owaspReference: 'A07:2021 - Identification and Authentication Failures'
        },
        {
          id: 'auth-no-token',
          name: 'Missing Token Handling',
          category: 'broken_auth',
          severity: 'high',
          description: 'Test endpoint behavior without authentication',
          payload: { authorization: '' },
          expectedBehavior: 'Should return 401 Unauthorized',
          owaspReference: 'A07:2021 - Identification and Authentication Failures'
        }
      );
    }

    return tests;
  }

  private generateAuthorizationTests(request: NetworkRequest): SecurityTest[] {
    const tests: SecurityTest[] = [];

    // Check for resource IDs in URL
    const hasResourceId = /\/\d+|\/[0-9a-f]{8}-[0-9a-f]{4}|\/[0-9a-f]{24}/i.test(request.url);

    if (hasResourceId) {
      tests.push(
        {
          id: 'authz-idor',
          name: 'IDOR (Insecure Direct Object Reference)',
          category: 'broken_access',
          severity: 'critical',
          description: 'Test if user can access other users\' resources',
          payload: { resourceId: 'another_users_resource_id' },
          expectedBehavior: 'Should return 403 Forbidden for unauthorized resources',
          owaspReference: 'A01:2021 - Broken Access Control'
        },
        {
          id: 'authz-privilege-escalation',
          name: 'Privilege Escalation',
          category: 'broken_access',
          severity: 'critical',
          description: 'Test if regular user can access admin resources',
          payload: { role: 'admin', isAdmin: true },
          expectedBehavior: 'Should verify user role server-side',
          owaspReference: 'A01:2021 - Broken Access Control'
        }
      );
    }

    // HTTP method override tests
    if (request.method === 'GET') {
      tests.push({
        id: 'authz-method-override',
        name: 'HTTP Method Override',
        category: 'broken_access',
        severity: 'medium',
        description: 'Test if HTTP method can be overridden via headers',
        payload: { 'X-HTTP-Method-Override': 'DELETE' },
        expectedBehavior: 'Should not allow method override without proper authorization',
        owaspReference: 'A01:2021 - Broken Access Control'
      });
    }

    return tests;
  }

  private generateSensitiveDataTests(request: NetworkRequest): SecurityTest[] {
    const tests: SecurityTest[] = [];

    tests.push(
      {
        id: 'sensitive-in-url',
        name: 'Sensitive Data in URL',
        category: 'sensitive_data',
        severity: 'high',
        description: 'Check if sensitive data is passed in URL parameters',
        payload: null,
        expectedBehavior: 'Passwords, tokens should never be in URL',
        owaspReference: 'A02:2021 - Cryptographic Failures'
      },
      {
        id: 'sensitive-in-logs',
        name: 'Sensitive Data Exposure in Errors',
        category: 'sensitive_data',
        severity: 'medium',
        description: 'Check if error messages expose sensitive information',
        payload: { trigger: 'error' },
        expectedBehavior: 'Error responses should not expose stack traces or sensitive data',
        owaspReference: 'A02:2021 - Cryptographic Failures'
      }
    );

    // Check response for sensitive data patterns
    if (request.responseBody) {
      const responseText = JSON.stringify(request.responseBody).toLowerCase();
      if (responseText.includes('password') || responseText.includes('secret') || responseText.includes('private')) {
        tests.push({
          id: 'sensitive-in-response',
          name: 'Sensitive Data in Response',
          category: 'sensitive_data',
          severity: 'critical',
          description: 'Response contains potentially sensitive data',
          payload: null,
          expectedBehavior: 'Sensitive fields should be masked or omitted',
          owaspReference: 'A02:2021 - Cryptographic Failures'
        });
      }
    }

    return tests;
  }

  private generateRateLimitTests(request: NetworkRequest): SecurityTest[] {
    return [
      {
        id: 'rate-limit-standard',
        name: 'Rate Limiting',
        category: 'security_misconfig',
        severity: 'medium',
        description: 'Test if endpoint has rate limiting protection',
        payload: { repeatCount: 100 },
        expectedBehavior: 'Should return 429 Too Many Requests after threshold',
        owaspReference: 'A05:2021 - Security Misconfiguration'
      },
      {
        id: 'rate-limit-bypass',
        name: 'Rate Limit Bypass',
        category: 'security_misconfig',
        severity: 'medium',
        description: 'Test if rate limiting can be bypassed via headers',
        payload: { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '10.0.0.1' },
        expectedBehavior: 'Rate limiting should not be bypassable via headers',
        owaspReference: 'A05:2021 - Security Misconfiguration'
      }
    ];
  }

  private generateCORSTests(request: NetworkRequest): SecurityTest[] {
    return [
      {
        id: 'cors-wildcard',
        name: 'CORS Wildcard Check',
        category: 'security_misconfig',
        severity: 'high',
        description: 'Check if CORS allows any origin',
        payload: { Origin: 'https://evil.com' },
        expectedBehavior: 'Should not reflect arbitrary origins in Access-Control-Allow-Origin',
        owaspReference: 'A05:2021 - Security Misconfiguration'
      },
      {
        id: 'cors-credentials',
        name: 'CORS with Credentials',
        category: 'security_misconfig',
        severity: 'high',
        description: 'Check if CORS allows credentials with wildcard',
        payload: { Origin: 'https://evil.com', credentials: 'include' },
        expectedBehavior: 'Should not allow credentials with wildcard origin',
        owaspReference: 'A05:2021 - Security Misconfiguration'
      }
    ];
  }

  private generateInputValidationTests(request: NetworkRequest): SecurityTest[] {
    const tests: SecurityTest[] = [];

    if (request.requestBody) {
      tests.push(
        {
          id: 'input-large-payload',
          name: 'Large Payload Handling',
          category: 'security_misconfig',
          severity: 'medium',
          description: 'Test handling of excessively large payloads',
          payload: { data: 'A'.repeat(1000000) },
          expectedBehavior: 'Should reject payloads exceeding size limit',
          owaspReference: 'A05:2021 - Security Misconfiguration'
        },
        {
          id: 'input-special-chars',
          name: 'Special Character Handling',
          category: 'injection',
          severity: 'medium',
          description: 'Test handling of special characters',
          payload: this.injectPayload(request.requestBody, '\x00\x1f\x7f'),
          expectedBehavior: 'Should sanitize or reject control characters',
          owaspReference: 'A03:2021 - Injection'
        },
        {
          id: 'input-unicode',
          name: 'Unicode Handling',
          category: 'injection',
          severity: 'low',
          description: 'Test handling of unicode characters',
          payload: this.injectPayload(request.requestBody, '𝕳𝖊𝖑𝖑𝖔'),
          expectedBehavior: 'Should handle unicode consistently',
          owaspReference: 'A03:2021 - Injection'
        }
      );
    }

    return tests;
  }

  private injectPayload(originalBody: any, payload: string): any {
    if (!originalBody) return { injected: payload };

    // If the body is a string, try to parse it as JSON first
    if (typeof originalBody === 'string') {
      try {
        const parsed = JSON.parse(originalBody);
        if (typeof parsed === 'object' && parsed !== null) {
          const result = JSON.parse(JSON.stringify(parsed));
          this.injectIntoObject(result, payload);
          return result;
        }
      } catch {
        // Not valid JSON string — return payload directly
      }
      return { injected: payload };
    }

    const result = JSON.parse(JSON.stringify(originalBody));

    if (typeof result !== 'object' || result === null) {
      return { injected: payload };
    }

    this.injectIntoObject(result, payload);
    return result;
  }

  private injectIntoObject(obj: any, payload: string): boolean {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'string') {
        obj[key] = payload;
        return true;
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (this.injectIntoObject(obj[key], payload)) return true;
      }
    }
    return false;
  }

  private calculateRiskScore(tests: SecurityTest[]): number {
    const severityWeights = {
      critical: 10,
      high: 7,
      medium: 4,
      low: 1
    };

    const totalWeight = tests.reduce((sum, test) => sum + severityWeights[test.severity], 0);
    const maxPossible = tests.length * 10;

    return Math.round((totalWeight / maxPossible) * 100);
  }

  private generateRecommendations(tests: SecurityTest[], request: NetworkRequest): string[] {
    const recommendations: string[] = [];
    const categories = new Set(tests.map(t => t.category));

    if (categories.has('injection')) {
      recommendations.push('Implement parameterized queries and input validation');
      recommendations.push('Use ORM/ODM to prevent SQL injection');
    }

    if (categories.has('xss')) {
      recommendations.push('Implement Content Security Policy (CSP) headers');
      recommendations.push('Encode all user-supplied data before rendering');
    }

    if (categories.has('broken_auth')) {
      recommendations.push('Implement account lockout after failed attempts');
      recommendations.push('Use secure password hashing (bcrypt, argon2)');
      recommendations.push('Implement MFA for sensitive operations');
    }

    if (categories.has('broken_access')) {
      recommendations.push('Implement proper authorization checks on all endpoints');
      recommendations.push('Use UUID instead of sequential IDs for resources');
    }

    if (categories.has('sensitive_data')) {
      recommendations.push('Encrypt sensitive data at rest and in transit');
      recommendations.push('Implement proper data masking in responses');
    }

    return recommendations;
  }

  generateSecurityTestCode(suite: SecurityTestSuite, framework: TestFramework): string {
    const lines: string[] = [];

    lines.push(`// Security Tests for ${suite.method} ${suite.endpoint}`);
    lines.push(`// Risk Score: ${suite.riskScore}/100`);
    lines.push(`// Tests: ${suite.tests.length}`);
    lines.push('');

    // Imports
    switch (framework) {
      case 'playwright':
        lines.push(`import { test, expect } from '@playwright/test';`);
        break;
      case 'jest':
        lines.push(`const axios = require('axios');`);
        break;
    }
    lines.push('');

    lines.push(`describe('Security Tests - ${suite.endpoint}', () => {`);

    // Group tests by category
    const byCategory = new Map<string, SecurityTest[]>();
    suite.tests.forEach(test => {
      if (!byCategory.has(test.category)) {
        byCategory.set(test.category, []);
      }
      byCategory.get(test.category)!.push(test);
    });

    byCategory.forEach((tests, category) => {
      lines.push(`  describe('${this.formatCategory(category)}', () => {`);

      tests.forEach(secTest => {
        lines.push(this.generateTestCase(secTest, suite, framework));
      });

      lines.push(`  });`);
      lines.push('');
    });

    lines.push(`});`);
    lines.push('');

    // Add recommendations as comments
    lines.push('/*');
    lines.push(' * Security Recommendations:');
    suite.recommendations.forEach(rec => {
      lines.push(` * - ${rec}`);
    });
    lines.push(' */');

    return lines.join('\n');
  }

  private formatCategory(category: string): string {
    return category
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private generateTestCase(secTest: SecurityTest, suite: SecurityTestSuite, framework: TestFramework): string {
    const lines: string[] = [];

    switch (framework) {
      case 'playwright':
        lines.push(`    test('${secTest.name}', async ({ request }) => {`);
        lines.push(`      // ${secTest.description}`);
        lines.push(`      // OWASP: ${secTest.owaspReference || 'N/A'}`);
        lines.push(`      // Severity: ${secTest.severity.toUpperCase()}`);
        lines.push(`      `);
        lines.push(`      const response = await request.${suite.method.toLowerCase()}('${suite.endpoint}', {`);
        if (secTest.payload) {
          lines.push(`        data: ${JSON.stringify(secTest.payload, null, 8).split('\n').join('\n        ')}`);
        }
        lines.push(`      });`);
        lines.push(`      `);
        lines.push(`      // Expected: ${secTest.expectedBehavior}`);
        lines.push(`      // Add assertions based on expected behavior`);
        lines.push(`      expect(response.status()).not.toBe(500); // Should not cause server error`);
        lines.push(`    });`);
        break;

      case 'jest':
      default:
        lines.push(`    test('${secTest.name}', async () => {`);
        lines.push(`      // ${secTest.description}`);
        lines.push(`      // OWASP: ${secTest.owaspReference || 'N/A'}`);
        lines.push(`      // Severity: ${secTest.severity.toUpperCase()}`);
        lines.push(`      `);
        lines.push(`      try {`);
        lines.push(`        const response = await axios({`);
        lines.push(`          method: '${suite.method}',`);
        lines.push(`          url: '${suite.endpoint}',`);
        if (secTest.payload) {
          lines.push(`          data: ${JSON.stringify(secTest.payload, null, 10).split('\n').join('\n          ')}`);
        }
        lines.push(`        });`);
        lines.push(`        `);
        lines.push(`        // Expected: ${secTest.expectedBehavior}`);
        lines.push(`        expect(response.status).not.toBe(500);`);
        lines.push(`      } catch (error) {`);
        lines.push(`        // Verify appropriate error handling`);
        lines.push(`        expect(error.response?.status).toBeDefined();`);
        lines.push(`      }`);
        lines.push(`    });`);
    }

    return lines.join('\n');
  }
}
