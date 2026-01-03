import { HAREntry, TestFramework } from '@/types';

export interface SmartAssertion {
  field: string;
  type: 'status' | 'header' | 'body' | 'schema' | 'performance' | 'security' | 'business';
  assertion: string;
  description: string;
  confidence: number; // 0-100
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
}

export interface AssertionSuggestion {
  endpoint: string;
  method: string;
  assertions: SmartAssertion[];
  summary: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    averageConfidence: number;
  };
}

export interface PatternAnalysis {
  pattern: string;
  description: string;
  suggestedAssertions: SmartAssertion[];
}

export class SmartAssertionBuilder {
  private static instance: SmartAssertionBuilder;

  private constructor() {}

  static getInstance(): SmartAssertionBuilder {
    if (!SmartAssertionBuilder.instance) {
      SmartAssertionBuilder.instance = new SmartAssertionBuilder();
    }
    return SmartAssertionBuilder.instance;
  }

  analyzeAndSuggest(entry: HAREntry, framework: TestFramework): AssertionSuggestion {
    const assertions: SmartAssertion[] = [];

    // Analyze different aspects
    assertions.push(...this.analyzeStatusCode(entry, framework));
    assertions.push(...this.analyzeHeaders(entry, framework));
    assertions.push(...this.analyzeResponseBody(entry, framework));
    assertions.push(...this.analyzePatterns(entry, framework));
    assertions.push(...this.analyzeBusinessLogic(entry, framework));
    assertions.push(...this.analyzeDataIntegrity(entry, framework));

    // Calculate summary
    const summary = this.calculateSummary(assertions);

    return {
      endpoint: entry.request.url,
      method: entry.request.method,
      assertions: assertions.sort((a, b) => b.confidence - a.confidence),
      summary
    };
  }

  private analyzeStatusCode(entry: HAREntry, framework: TestFramework): SmartAssertion[] {
    const assertions: SmartAssertion[] = [];
    const status = entry.response.status;

    // Exact status code assertion
    assertions.push({
      field: 'response.status',
      type: 'status',
      assertion: this.formatAssertion(framework, 'response.status', 'toBe', status),
      description: `Response should return status ${status}`,
      confidence: 95,
      severity: 'critical',
      category: 'HTTP Status'
    });

    // Status category assertion
    if (status >= 200 && status < 300) {
      assertions.push({
        field: 'response.status',
        type: 'status',
        assertion: this.formatAssertion(framework, 'response.ok', 'toBeTruthy'),
        description: 'Response should be successful (2xx)',
        confidence: 90,
        severity: 'high',
        category: 'HTTP Status'
      });
    }

    return assertions;
  }

  private analyzeHeaders(entry: HAREntry, framework: TestFramework): SmartAssertion[] {
    const assertions: SmartAssertion[] = [];
    const headers = entry.response.headers;

    // Content-Type
    const contentType = headers.find(h => h.name.toLowerCase() === 'content-type');
    if (contentType) {
      assertions.push({
        field: 'headers.content-type',
        type: 'header',
        assertion: this.formatAssertion(framework, `headers['content-type']`, 'toContain', contentType.value.split(';')[0]),
        description: `Content-Type should be ${contentType.value.split(';')[0]}`,
        confidence: 90,
        severity: 'high',
        category: 'Response Headers'
      });
    }

    // Security headers
    const securityHeaders = [
      { name: 'x-content-type-options', expected: 'nosniff', desc: 'Prevent MIME sniffing' },
      { name: 'x-frame-options', expected: null, desc: 'Prevent clickjacking' },
      { name: 'x-xss-protection', expected: null, desc: 'XSS protection enabled' },
      { name: 'strict-transport-security', expected: null, desc: 'HSTS enabled' },
      { name: 'content-security-policy', expected: null, desc: 'CSP configured' }
    ];

    securityHeaders.forEach(sh => {
      const header = headers.find(h => h.name.toLowerCase() === sh.name);
      if (header) {
        assertions.push({
          field: `headers.${sh.name}`,
          type: 'security',
          assertion: this.formatAssertion(framework, `headers['${sh.name}']`, 'toBeDefined'),
          description: sh.desc,
          confidence: 85,
          severity: 'medium',
          category: 'Security Headers'
        });
      }
    });

    // Cache headers
    const cacheControl = headers.find(h => h.name.toLowerCase() === 'cache-control');
    if (cacheControl) {
      assertions.push({
        field: 'headers.cache-control',
        type: 'header',
        assertion: this.formatAssertion(framework, `headers['cache-control']`, 'toBeDefined'),
        description: 'Cache-Control header should be set',
        confidence: 70,
        severity: 'low',
        category: 'Caching'
      });
    }

    return assertions;
  }

  private analyzeResponseBody(entry: HAREntry, framework: TestFramework): SmartAssertion[] {
    const assertions: SmartAssertion[] = [];
    const responseText = entry.response.content.text;

    if (!responseText) {
      assertions.push({
        field: 'response.body',
        type: 'body',
        assertion: this.formatAssertion(framework, 'responseBody', 'toBeDefined'),
        description: 'Response body should exist',
        confidence: 80,
        severity: 'medium',
        category: 'Response Body'
      });
      return assertions;
    }

    try {
      const body = JSON.parse(responseText);
      assertions.push(...this.analyzeJsonStructure(body, framework, ''));
    } catch {
      // Non-JSON response
      assertions.push({
        field: 'response.body',
        type: 'body',
        assertion: this.formatAssertion(framework, 'typeof responseBody', 'toBe', 'string'),
        description: 'Response should be a string',
        confidence: 75,
        severity: 'medium',
        category: 'Response Body'
      });
    }

    return assertions;
  }

  private analyzeJsonStructure(obj: any, framework: TestFramework, path: string, depth: number = 0): SmartAssertion[] {
    const assertions: SmartAssertion[] = [];
    if (depth > 3) return assertions; // Limit recursion depth

    if (Array.isArray(obj)) {
      const fieldPath = path || 'responseBody';
      assertions.push({
        field: fieldPath,
        type: 'schema',
        assertion: this.formatAssertion(framework, `Array.isArray(${fieldPath})`, 'toBeTruthy'),
        description: `${fieldPath} should be an array`,
        confidence: 90,
        severity: 'high',
        category: 'Data Structure'
      });

      if (obj.length > 0) {
        assertions.push({
          field: `${fieldPath}.length`,
          type: 'schema',
          assertion: this.formatAssertion(framework, `${fieldPath}.length`, 'toBeGreaterThanOrEqual', 0),
          description: `${fieldPath} should have valid length`,
          confidence: 85,
          severity: 'medium',
          category: 'Data Structure'
        });
      }

      // Analyze first element if array of objects
      if (obj.length > 0 && typeof obj[0] === 'object') {
        assertions.push(...this.analyzeJsonStructure(obj[0], framework, `${fieldPath}[0]`, depth + 1));
      }
    } else if (typeof obj === 'object' && obj !== null) {
      Object.entries(obj).forEach(([key, value]) => {
        const fieldPath = path ? `${path}.${key}` : `responseBody.${key}`;

        // Property existence
        assertions.push({
          field: fieldPath,
          type: 'schema',
          assertion: this.formatAssertion(framework, `${path || 'responseBody'}`, 'toHaveProperty', key),
          description: `Should have property '${key}'`,
          confidence: 85,
          severity: 'medium',
          category: 'Data Structure'
        });

        // Type-specific assertions
        assertions.push(...this.generateTypeAssertions(key, value, fieldPath, framework));

        // Recurse for nested objects
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          assertions.push(...this.analyzeJsonStructure(value, framework, fieldPath, depth + 1));
        }
      });
    }

    return assertions;
  }

  private generateTypeAssertions(key: string, value: any, fieldPath: string, framework: TestFramework): SmartAssertion[] {
    const assertions: SmartAssertion[] = [];
    const lowerKey = key.toLowerCase();

    // ID fields
    if (lowerKey === 'id' || lowerKey.endsWith('_id') || lowerKey.endsWith('Id')) {
      assertions.push({
        field: fieldPath,
        type: 'schema',
        assertion: this.formatAssertion(framework, fieldPath, 'toBeTruthy'),
        description: `${key} should be a valid ID`,
        confidence: 90,
        severity: 'high',
        category: 'Identifiers'
      });
    }

    // Email fields
    if (lowerKey.includes('email')) {
      if (typeof value === 'string') {
        assertions.push({
          field: fieldPath,
          type: 'body',
          assertion: this.formatAssertion(framework, `${fieldPath}.includes('@')`, 'toBeTruthy'),
          description: `${key} should be a valid email format`,
          confidence: 85,
          severity: 'medium',
          category: 'Data Validation'
        });
      }
    }

    // Date/time fields
    if (lowerKey.includes('date') || lowerKey.includes('time') || lowerKey.includes('created') || lowerKey.includes('updated')) {
      assertions.push({
        field: fieldPath,
        type: 'body',
        assertion: this.formatAssertion(framework, `new Date(${fieldPath}).getTime()`, 'toBeGreaterThan', 0),
        description: `${key} should be a valid date`,
        confidence: 80,
        severity: 'medium',
        category: 'Data Validation'
      });
    }

    // Boolean fields
    if (typeof value === 'boolean') {
      assertions.push({
        field: fieldPath,
        type: 'schema',
        assertion: this.formatAssertion(framework, `typeof ${fieldPath}`, 'toBe', 'boolean'),
        description: `${key} should be a boolean`,
        confidence: 90,
        severity: 'medium',
        category: 'Data Types'
      });
    }

    // Number fields
    if (typeof value === 'number') {
      assertions.push({
        field: fieldPath,
        type: 'schema',
        assertion: this.formatAssertion(framework, `typeof ${fieldPath}`, 'toBe', 'number'),
        description: `${key} should be a number`,
        confidence: 90,
        severity: 'medium',
        category: 'Data Types'
      });

      // Non-negative for counts, prices, etc.
      if (lowerKey.includes('count') || lowerKey.includes('price') || lowerKey.includes('total') || lowerKey.includes('amount')) {
        assertions.push({
          field: fieldPath,
          type: 'business',
          assertion: this.formatAssertion(framework, fieldPath, 'toBeGreaterThanOrEqual', 0),
          description: `${key} should be non-negative`,
          confidence: 85,
          severity: 'high',
          category: 'Business Logic'
        });
      }
    }

    // String length validation
    if (typeof value === 'string' && value.length > 0) {
      if (lowerKey.includes('name') || lowerKey.includes('title')) {
        assertions.push({
          field: fieldPath,
          type: 'body',
          assertion: this.formatAssertion(framework, `${fieldPath}.length`, 'toBeGreaterThan', 0),
          description: `${key} should not be empty`,
          confidence: 80,
          severity: 'medium',
          category: 'Data Validation'
        });
      }
    }

    return assertions;
  }

  private analyzePatterns(entry: HAREntry, framework: TestFramework): SmartAssertion[] {
    const assertions: SmartAssertion[] = [];
    const url = entry.request.url;
    const method = entry.request.method;

    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.toLowerCase();

      // Auth endpoints
      if (path.includes('login') || path.includes('auth') || path.includes('signin')) {
        if (method === 'POST') {
          assertions.push({
            field: 'responseBody.token',
            type: 'business',
            assertion: this.formatAssertion(framework, 'responseBody.token || responseBody.access_token', 'toBeTruthy'),
            description: 'Login should return an authentication token',
            confidence: 90,
            severity: 'critical',
            category: 'Authentication'
          });
        }
      }

      // List/collection endpoints
      if (path.includes('list') || path.endsWith('s') || path.includes('all')) {
        if (method === 'GET') {
          assertions.push({
            field: 'responseBody',
            type: 'business',
            assertion: this.formatAssertion(framework, 'Array.isArray(responseBody) || Array.isArray(responseBody.data) || Array.isArray(responseBody.items)', 'toBeTruthy'),
            description: 'List endpoint should return an array',
            confidence: 85,
            severity: 'high',
            category: 'API Pattern'
          });
        }
      }

      // Pagination patterns
      if (urlObj.searchParams.has('page') || urlObj.searchParams.has('limit') || urlObj.searchParams.has('offset')) {
        assertions.push({
          field: 'responseBody.pagination',
          type: 'business',
          assertion: this.formatAssertion(framework, 'responseBody.total !== undefined || responseBody.totalCount !== undefined || responseBody.count !== undefined', 'toBeTruthy'),
          description: 'Paginated endpoint should include total count',
          confidence: 75,
          severity: 'medium',
          category: 'Pagination'
        });
      }

      // CRUD patterns
      if (method === 'POST' && !path.includes('login') && !path.includes('auth')) {
        assertions.push({
          field: 'responseBody.id',
          type: 'business',
          assertion: this.formatAssertion(framework, 'responseBody.id', 'toBeTruthy'),
          description: 'Create operation should return resource ID',
          confidence: 80,
          severity: 'high',
          category: 'CRUD'
        });
      }

      if (method === 'DELETE') {
        assertions.push({
          field: 'response.status',
          type: 'status',
          assertion: this.formatAssertion(framework, '[200, 204, 202].includes(response.status)', 'toBeTruthy'),
          description: 'Delete should return success status',
          confidence: 85,
          severity: 'high',
          category: 'CRUD'
        });
      }

    } catch {
      // Invalid URL
    }

    return assertions;
  }

  private analyzeBusinessLogic(entry: HAREntry, framework: TestFramework): SmartAssertion[] {
    const assertions: SmartAssertion[] = [];
    const responseText = entry.response.content.text;

    if (!responseText) return assertions;

    try {
      const body = JSON.parse(responseText);

      // Error response pattern
      if (entry.response.status >= 400) {
        assertions.push({
          field: 'responseBody.error',
          type: 'business',
          assertion: this.formatAssertion(framework, 'responseBody.error || responseBody.message || responseBody.errors', 'toBeTruthy'),
          description: 'Error response should include error message',
          confidence: 85,
          severity: 'high',
          category: 'Error Handling'
        });
      }

      // Pagination response
      if (body.total !== undefined && body.items !== undefined) {
        assertions.push({
          field: 'responseBody.items.length',
          type: 'business',
          assertion: this.formatAssertion(framework, 'responseBody.items.length <= responseBody.total', 'toBeTruthy'),
          description: 'Items count should not exceed total',
          confidence: 90,
          severity: 'high',
          category: 'Pagination'
        });
      }

      // Timestamps consistency
      if (body.createdAt && body.updatedAt) {
        assertions.push({
          field: 'timestamps',
          type: 'business',
          assertion: this.formatAssertion(framework, 'new Date(responseBody.updatedAt) >= new Date(responseBody.createdAt)', 'toBeTruthy'),
          description: 'Updated timestamp should be >= created timestamp',
          confidence: 85,
          severity: 'medium',
          category: 'Data Integrity'
        });
      }

    } catch {
      // Non-JSON response
    }

    return assertions;
  }

  private analyzeDataIntegrity(entry: HAREntry, framework: TestFramework): SmartAssertion[] {
    const assertions: SmartAssertion[] = [];
    const responseText = entry.response.content.text;

    if (!responseText) return assertions;

    // Check for sensitive data exposure
    const sensitivePatterns = [
      { pattern: /password/i, field: 'password', desc: 'Password should not be exposed' },
      { pattern: /secret/i, field: 'secret', desc: 'Secrets should not be exposed' },
      { pattern: /private_key/i, field: 'private_key', desc: 'Private keys should not be exposed' },
      { pattern: /credit_card|creditcard/i, field: 'credit_card', desc: 'Credit card data should be masked' }
    ];

    sensitivePatterns.forEach(sp => {
      assertions.push({
        field: sp.field,
        type: 'security',
        assertion: this.formatAssertion(framework, `!JSON.stringify(responseBody).toLowerCase().includes('${sp.field}')`, 'toBeTruthy'),
        description: sp.desc,
        confidence: 70,
        severity: 'critical',
        category: 'Data Security'
      });
    });

    return assertions;
  }

  private formatAssertion(framework: TestFramework, expression: string, matcher: string, value?: any): string {
    const valueStr = value !== undefined
      ? (typeof value === 'string' ? `'${value}'` : value)
      : '';

    switch (framework) {
      case 'playwright':
        if (matcher === 'toBeDefined') return `expect(${expression}).toBeDefined();`;
        if (matcher === 'toBeTruthy') return `expect(${expression}).toBeTruthy();`;
        if (matcher === 'toBe') return `expect(${expression}).toBe(${valueStr});`;
        if (matcher === 'toContain') return `expect(${expression}).toContain(${valueStr});`;
        if (matcher === 'toHaveProperty') return `expect(${expression}).toHaveProperty('${value}');`;
        if (matcher === 'toBeGreaterThan') return `expect(${expression}).toBeGreaterThan(${valueStr});`;
        if (matcher === 'toBeGreaterThanOrEqual') return `expect(${expression}).toBeGreaterThanOrEqual(${valueStr});`;
        return `expect(${expression}).${matcher}(${valueStr});`;

      case 'cypress':
        if (matcher === 'toBeDefined') return `expect(${expression}).to.exist;`;
        if (matcher === 'toBeTruthy') return `expect(${expression}).to.be.ok;`;
        if (matcher === 'toBe') return `expect(${expression}).to.equal(${valueStr});`;
        if (matcher === 'toContain') return `expect(${expression}).to.include(${valueStr});`;
        if (matcher === 'toHaveProperty') return `expect(${expression}).to.have.property('${value}');`;
        if (matcher === 'toBeGreaterThan') return `expect(${expression}).to.be.greaterThan(${valueStr});`;
        if (matcher === 'toBeGreaterThanOrEqual') return `expect(${expression}).to.be.at.least(${valueStr});`;
        return `expect(${expression}).to.${matcher}(${valueStr});`;

      case 'jest':
      case 'vitest':
      default:
        if (matcher === 'toBeDefined') return `expect(${expression}).toBeDefined();`;
        if (matcher === 'toBeTruthy') return `expect(${expression}).toBeTruthy();`;
        if (matcher === 'toBe') return `expect(${expression}).toBe(${valueStr});`;
        if (matcher === 'toContain') return `expect(${expression}).toContain(${valueStr});`;
        if (matcher === 'toHaveProperty') return `expect(${expression}).toHaveProperty('${value}');`;
        if (matcher === 'toBeGreaterThan') return `expect(${expression}).toBeGreaterThan(${valueStr});`;
        if (matcher === 'toBeGreaterThanOrEqual') return `expect(${expression}).toBeGreaterThanOrEqual(${valueStr});`;
        return `expect(${expression}).${matcher}(${valueStr});`;
    }
  }

  private calculateSummary(assertions: SmartAssertion[]): AssertionSuggestion['summary'] {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let totalConfidence = 0;

    assertions.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
      totalConfidence += a.confidence;
    });

    return {
      total: assertions.length,
      byType,
      bySeverity,
      averageConfidence: assertions.length > 0 ? Math.round(totalConfidence / assertions.length) : 0
    };
  }

  generateAssertionCode(suggestion: AssertionSuggestion, framework: TestFramework): string {
    const lines: string[] = [
      `// Smart Assertions for ${suggestion.method} ${suggestion.endpoint}`,
      `// Generated ${suggestion.summary.total} assertions (avg confidence: ${suggestion.summary.averageConfidence}%)`,
      ''
    ];

    // Group by category
    const byCategory: Record<string, SmartAssertion[]> = {};
    suggestion.assertions.forEach(a => {
      if (!byCategory[a.category]) {
        byCategory[a.category] = [];
      }
      byCategory[a.category].push(a);
    });

    Object.entries(byCategory).forEach(([category, assertions]) => {
      lines.push(`// ${category}`);
      assertions.forEach(a => {
        lines.push(`${a.assertion} // ${a.description} (${a.confidence}% confidence)`);
      });
      lines.push('');
    });

    return lines.join('\n');
  }
}
