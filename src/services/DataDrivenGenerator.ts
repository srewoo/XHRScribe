import { HAREntry, TestFramework, NetworkRequest } from '@/types';

export interface TestDataSet {
  name: string;
  description: string;
  type: 'valid' | 'invalid' | 'boundary' | 'edge' | 'negative';
  data: Record<string, any>;
  expectedOutcome: 'success' | 'error' | 'validation_error';
  expectedStatus?: number;
}

export interface ParameterizedTest {
  endpoint: string;
  method: string;
  baseRequest: NetworkRequest;
  dataSets: TestDataSet[];
  parameterDescriptions: Record<string, string>;
}

export interface DataDrivenConfig {
  generateBoundaryTests: boolean;
  generateNegativeTests: boolean;
  generateEdgeCases: boolean;
  maxVariationsPerField: number;
}

export class DataDrivenGenerator {
  private static instance: DataDrivenGenerator;

  private constructor() {}

  static getInstance(): DataDrivenGenerator {
    if (!DataDrivenGenerator.instance) {
      DataDrivenGenerator.instance = new DataDrivenGenerator();
    }
    return DataDrivenGenerator.instance;
  }

  generateDataSets(request: NetworkRequest, config: DataDrivenConfig): ParameterizedTest {
    const dataSets: TestDataSet[] = [];
    const parameterDescriptions: Record<string, string> = {};

    // Original valid case
    dataSets.push({
      name: 'Original Request',
      description: 'The original captured request data',
      type: 'valid',
      data: request.requestBody || {},
      expectedOutcome: 'success',
      expectedStatus: request.status || 200
    });

    if (request.requestBody) {
      // Analyze request body and generate variations
      const fields = this.analyzeFields(request.requestBody);

      fields.forEach(field => {
        parameterDescriptions[field.path] = field.description;

        // Generate valid variations
        const validVariations = this.generateValidVariations(field, config);
        validVariations.forEach(variation => {
          dataSets.push({
            name: `${field.name} - ${variation.name}`,
            description: variation.description,
            type: 'valid',
            data: this.applyVariation(request.requestBody, field.path, variation.value),
            expectedOutcome: 'success',
            expectedStatus: 200
          });
        });

        // Generate boundary tests
        if (config.generateBoundaryTests) {
          const boundaryTests = this.generateBoundaryTests(field);
          dataSets.push(...boundaryTests);
        }

        // Generate negative tests
        if (config.generateNegativeTests) {
          const negativeTests = this.generateNegativeTests(field);
          dataSets.push(...negativeTests);
        }

        // Generate edge cases
        if (config.generateEdgeCases) {
          const edgeCases = this.generateEdgeCases(field);
          dataSets.push(...edgeCases);
        }
      });
    }

    return {
      endpoint: request.url,
      method: request.method,
      baseRequest: request,
      dataSets: dataSets.slice(0, config.maxVariationsPerField * 10),
      parameterDescriptions
    };
  }

  private analyzeFields(data: any, path: string = '', results: FieldInfo[] = []): FieldInfo[] {
    if (data === null || data === undefined) {
      return results;
    }

    if (typeof data === 'object' && !Array.isArray(data)) {
      Object.entries(data).forEach(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;

        if (typeof value !== 'object' || value === null) {
          results.push(this.analyzeField(key, value, currentPath));
        } else if (!Array.isArray(value)) {
          // Recurse into nested objects
          this.analyzeFields(value, currentPath, results);
        } else {
          // Array field
          results.push({
            name: key,
            path: currentPath,
            type: 'array',
            value: value,
            description: `Array field containing ${value.length} items`,
            constraints: { minLength: 0, maxLength: 100 }
          });
        }
      });
    }

    return results;
  }

  private analyzeField(name: string, value: any, path: string): FieldInfo {
    const lowerName = name.toLowerCase();

    // Detect field type and constraints
    if (typeof value === 'string') {
      return this.analyzeStringField(name, value, path, lowerName);
    }

    if (typeof value === 'number') {
      return this.analyzeNumberField(name, value, path, lowerName);
    }

    if (typeof value === 'boolean') {
      return {
        name,
        path,
        type: 'boolean',
        value,
        description: `Boolean flag for ${name}`,
        constraints: {}
      };
    }

    return {
      name,
      path,
      type: 'unknown',
      value,
      description: `Field ${name}`,
      constraints: {}
    };
  }

  private analyzeStringField(name: string, value: string, path: string, lowerName: string): FieldInfo {
    // Email
    if (lowerName.includes('email') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return {
        name,
        path,
        type: 'email',
        value,
        description: 'Email address field',
        constraints: { format: 'email', minLength: 5, maxLength: 254 }
      };
    }

    // Password
    if (lowerName.includes('password')) {
      return {
        name,
        path,
        type: 'password',
        value,
        description: 'Password field (sensitive)',
        constraints: { minLength: 8, maxLength: 128 }
      };
    }

    // Username
    if (lowerName.includes('username') || lowerName.includes('user_name')) {
      return {
        name,
        path,
        type: 'username',
        value,
        description: 'Username field',
        constraints: { minLength: 3, maxLength: 30, pattern: /^[a-zA-Z0-9_]+$/ }
      };
    }

    // Phone
    if (lowerName.includes('phone') || lowerName.includes('mobile')) {
      return {
        name,
        path,
        type: 'phone',
        value,
        description: 'Phone number field',
        constraints: { format: 'phone', minLength: 10, maxLength: 15 }
      };
    }

    // URL
    if (lowerName.includes('url') || lowerName.includes('link') || /^https?:\/\//.test(value)) {
      return {
        name,
        path,
        type: 'url',
        value,
        description: 'URL field',
        constraints: { format: 'uri' }
      };
    }

    // Date
    if (lowerName.includes('date') || /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return {
        name,
        path,
        type: 'date',
        value,
        description: 'Date field',
        constraints: { format: 'date' }
      };
    }

    // UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return {
        name,
        path,
        type: 'uuid',
        value,
        description: 'UUID field',
        constraints: { format: 'uuid' }
      };
    }

    // Generic string
    return {
      name,
      path,
      type: 'string',
      value,
      description: `Text field for ${name}`,
      constraints: { minLength: 0, maxLength: 500 }
    };
  }

  private analyzeNumberField(name: string, value: number, path: string, lowerName: string): FieldInfo {
    // Age
    if (lowerName.includes('age')) {
      return {
        name,
        path,
        type: 'age',
        value,
        description: 'Age field',
        constraints: { min: 0, max: 150 }
      };
    }

    // Price/amount
    if (lowerName.includes('price') || lowerName.includes('amount') || lowerName.includes('cost')) {
      return {
        name,
        path,
        type: 'currency',
        value,
        description: 'Currency/price field',
        constraints: { min: 0, max: 1000000, decimal: true }
      };
    }

    // Quantity/count
    if (lowerName.includes('quantity') || lowerName.includes('count') || lowerName.includes('num')) {
      return {
        name,
        path,
        type: 'count',
        value,
        description: 'Quantity/count field',
        constraints: { min: 0, max: 10000 }
      };
    }

    // Percentage
    if (lowerName.includes('percent') || lowerName.includes('rate')) {
      return {
        name,
        path,
        type: 'percentage',
        value,
        description: 'Percentage field',
        constraints: { min: 0, max: 100 }
      };
    }

    // Generic number
    return {
      name,
      path,
      type: 'number',
      value,
      description: `Numeric field for ${name}`,
      constraints: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }
    };
  }

  private generateValidVariations(field: FieldInfo, config: DataDrivenConfig): Variation[] {
    const variations: Variation[] = [];
    const max = config.maxVariationsPerField;

    switch (field.type) {
      case 'email':
        variations.push(
          { name: 'Different domain', description: 'Email with different domain', value: 'test@example.org' },
          { name: 'With subdomain', description: 'Email with subdomain', value: 'test@mail.example.com' }
        );
        break;

      case 'string':
        variations.push(
          { name: 'Short value', description: 'Minimum length string', value: 'a' },
          { name: 'With spaces', description: 'String with spaces', value: 'test value with spaces' }
        );
        break;

      case 'number':
      case 'count':
        const numVal = field.value as number;
        variations.push(
          { name: 'Double', description: 'Doubled value', value: numVal * 2 },
          { name: 'Half', description: 'Halved value', value: Math.floor(numVal / 2) }
        );
        break;

      case 'boolean':
        variations.push(
          { name: 'Toggled', description: 'Opposite boolean value', value: !field.value }
        );
        break;
    }

    return variations.slice(0, max);
  }

  private generateBoundaryTests(field: FieldInfo): TestDataSet[] {
    const tests: TestDataSet[] = [];
    const constraints = field.constraints;

    if (constraints.minLength !== undefined) {
      // Empty string
      tests.push({
        name: `${field.name} - Empty`,
        description: 'Empty value boundary test',
        type: 'boundary',
        data: { [field.path]: '' },
        expectedOutcome: constraints.minLength > 0 ? 'validation_error' : 'success',
        expectedStatus: constraints.minLength > 0 ? 400 : 200
      });

      // Minimum length
      tests.push({
        name: `${field.name} - Min Length`,
        description: `Exactly ${constraints.minLength} characters`,
        type: 'boundary',
        data: { [field.path]: 'a'.repeat(constraints.minLength) },
        expectedOutcome: 'success',
        expectedStatus: 200
      });

      // Below minimum
      if (constraints.minLength > 0) {
        tests.push({
          name: `${field.name} - Below Min`,
          description: `${constraints.minLength - 1} characters (below minimum)`,
          type: 'boundary',
          data: { [field.path]: 'a'.repeat(constraints.minLength - 1) },
          expectedOutcome: 'validation_error',
          expectedStatus: 400
        });
      }
    }

    if (constraints.maxLength !== undefined) {
      // Maximum length
      tests.push({
        name: `${field.name} - Max Length`,
        description: `Exactly ${constraints.maxLength} characters`,
        type: 'boundary',
        data: { [field.path]: 'a'.repeat(constraints.maxLength) },
        expectedOutcome: 'success',
        expectedStatus: 200
      });

      // Above maximum
      tests.push({
        name: `${field.name} - Above Max`,
        description: `${constraints.maxLength + 1} characters (above maximum)`,
        type: 'boundary',
        data: { [field.path]: 'a'.repeat(constraints.maxLength + 1) },
        expectedOutcome: 'validation_error',
        expectedStatus: 400
      });
    }

    if (constraints.min !== undefined) {
      tests.push({
        name: `${field.name} - Min Value`,
        description: `Minimum allowed value: ${constraints.min}`,
        type: 'boundary',
        data: { [field.path]: constraints.min },
        expectedOutcome: 'success',
        expectedStatus: 200
      });

      tests.push({
        name: `${field.name} - Below Min`,
        description: `Below minimum: ${constraints.min - 1}`,
        type: 'boundary',
        data: { [field.path]: constraints.min - 1 },
        expectedOutcome: 'validation_error',
        expectedStatus: 400
      });
    }

    if (constraints.max !== undefined) {
      tests.push({
        name: `${field.name} - Max Value`,
        description: `Maximum allowed value: ${constraints.max}`,
        type: 'boundary',
        data: { [field.path]: constraints.max },
        expectedOutcome: 'success',
        expectedStatus: 200
      });

      tests.push({
        name: `${field.name} - Above Max`,
        description: `Above maximum: ${constraints.max + 1}`,
        type: 'boundary',
        data: { [field.path]: constraints.max + 1 },
        expectedOutcome: 'validation_error',
        expectedStatus: 400
      });
    }

    return tests;
  }

  private generateNegativeTests(field: FieldInfo): TestDataSet[] {
    const tests: TestDataSet[] = [];

    // Null value
    tests.push({
      name: `${field.name} - Null`,
      description: 'Null value test',
      type: 'negative',
      data: { [field.path]: null },
      expectedOutcome: 'validation_error',
      expectedStatus: 400
    });

    // Wrong type
    switch (field.type) {
      case 'string':
      case 'email':
      case 'username':
        tests.push({
          name: `${field.name} - Number instead of string`,
          description: 'Wrong type: number instead of string',
          type: 'negative',
          data: { [field.path]: 12345 },
          expectedOutcome: 'validation_error',
          expectedStatus: 400
        });
        break;

      case 'number':
      case 'count':
      case 'age':
        tests.push({
          name: `${field.name} - String instead of number`,
          description: 'Wrong type: string instead of number',
          type: 'negative',
          data: { [field.path]: 'not a number' },
          expectedOutcome: 'validation_error',
          expectedStatus: 400
        });
        break;
    }

    // Invalid format
    if (field.type === 'email') {
      tests.push(
        {
          name: `${field.name} - No @`,
          description: 'Invalid email: missing @',
          type: 'negative',
          data: { [field.path]: 'invalidemail.com' },
          expectedOutcome: 'validation_error',
          expectedStatus: 400
        },
        {
          name: `${field.name} - No domain`,
          description: 'Invalid email: missing domain',
          type: 'negative',
          data: { [field.path]: 'test@' },
          expectedOutcome: 'validation_error',
          expectedStatus: 400
        }
      );
    }

    if (field.type === 'url') {
      tests.push({
        name: `${field.name} - Invalid URL`,
        description: 'Malformed URL',
        type: 'negative',
        data: { [field.path]: 'not-a-valid-url' },
        expectedOutcome: 'validation_error',
        expectedStatus: 400
      });
    }

    return tests;
  }

  private generateEdgeCases(field: FieldInfo): TestDataSet[] {
    const tests: TestDataSet[] = [];

    if (field.type === 'string' || field.type === 'email' || field.type === 'username') {
      // Unicode characters
      tests.push({
        name: `${field.name} - Unicode`,
        description: 'String with unicode characters',
        type: 'edge',
        data: { [field.path]: 'Test 日本語 🎉 émoji' },
        expectedOutcome: 'success',
        expectedStatus: 200
      });

      // Special characters
      tests.push({
        name: `${field.name} - Special chars`,
        description: 'String with special characters',
        type: 'edge',
        data: { [field.path]: "Test <script>alert('xss')</script>" },
        expectedOutcome: 'success', // Should be sanitized
        expectedStatus: 200
      });

      // Very long string
      tests.push({
        name: `${field.name} - Very long`,
        description: 'Extremely long string',
        type: 'edge',
        data: { [field.path]: 'a'.repeat(10000) },
        expectedOutcome: 'validation_error',
        expectedStatus: 400
      });

      // SQL injection attempt
      tests.push({
        name: `${field.name} - SQL injection`,
        description: 'SQL injection attempt',
        type: 'edge',
        data: { [field.path]: "'; DROP TABLE users; --" },
        expectedOutcome: 'success', // Should be handled safely
        expectedStatus: 200
      });
    }

    if (field.type === 'number' || field.type === 'count') {
      // Zero
      tests.push({
        name: `${field.name} - Zero`,
        description: 'Zero value',
        type: 'edge',
        data: { [field.path]: 0 },
        expectedOutcome: 'success',
        expectedStatus: 200
      });

      // Negative
      tests.push({
        name: `${field.name} - Negative`,
        description: 'Negative number',
        type: 'edge',
        data: { [field.path]: -1 },
        expectedOutcome: field.constraints.min !== undefined && field.constraints.min >= 0 ? 'validation_error' : 'success',
        expectedStatus: field.constraints.min !== undefined && field.constraints.min >= 0 ? 400 : 200
      });

      // Decimal
      tests.push({
        name: `${field.name} - Decimal`,
        description: 'Decimal number',
        type: 'edge',
        data: { [field.path]: 3.14159 },
        expectedOutcome: 'success',
        expectedStatus: 200
      });
    }

    return tests;
  }

  private applyVariation(originalData: any, path: string, newValue: any): Record<string, any> {
    const result = JSON.parse(JSON.stringify(originalData));
    const parts = path.split('.');
    let current = result;

    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]];
    }

    current[parts[parts.length - 1]] = newValue;
    return result;
  }

  generateParameterizedTestCode(test: ParameterizedTest, framework: TestFramework): string {
    const lines: string[] = [];

    lines.push(`// Data-Driven Tests for ${test.method} ${test.endpoint}`);
    lines.push(`// Generated ${test.dataSets.length} test variations`);
    lines.push('');

    // Generate test data as JSON
    lines.push('const testData = [');
    test.dataSets.forEach((ds, index) => {
      lines.push(`  {`);
      lines.push(`    name: '${ds.name}',`);
      lines.push(`    type: '${ds.type}',`);
      lines.push(`    data: ${JSON.stringify(ds.data, null, 4).split('\n').join('\n    ')},`);
      lines.push(`    expectedOutcome: '${ds.expectedOutcome}',`);
      lines.push(`    expectedStatus: ${ds.expectedStatus || 200}`);
      lines.push(`  }${index < test.dataSets.length - 1 ? ',' : ''}`);
    });
    lines.push('];');
    lines.push('');

    // Generate test code
    switch (framework) {
      case 'jest':
      case 'vitest':
        lines.push(`describe('${test.method} ${test.endpoint} - Data Driven Tests', () => {`);
        lines.push(`  test.each(testData)('$name', async ({ data, expectedOutcome, expectedStatus }) => {`);
        lines.push(`    try {`);
        lines.push(`      const response = await axios.${test.method.toLowerCase()}('${test.endpoint}', data);`);
        lines.push(`      `);
        lines.push(`      if (expectedOutcome === 'success') {`);
        lines.push(`        expect(response.status).toBe(expectedStatus);`);
        lines.push(`      } else {`);
        lines.push(`        fail('Expected validation error but got success');`);
        lines.push(`      }`);
        lines.push(`    } catch (error) {`);
        lines.push(`      if (expectedOutcome !== 'success') {`);
        lines.push(`        expect(error.response.status).toBe(expectedStatus);`);
        lines.push(`      } else {`);
        lines.push(`        throw error;`);
        lines.push(`      }`);
        lines.push(`    }`);
        lines.push(`  });`);
        lines.push(`});`);
        break;

      case 'playwright':
        lines.push(`test.describe('${test.method} ${test.endpoint} - Data Driven Tests', () => {`);
        lines.push(`  for (const testCase of testData) {`);
        lines.push(`    test(testCase.name, async ({ request }) => {`);
        lines.push(`      const response = await request.${test.method.toLowerCase()}('${test.endpoint}', {`);
        lines.push(`        data: testCase.data`);
        lines.push(`      });`);
        lines.push(`      `);
        lines.push(`      if (testCase.expectedOutcome === 'success') {`);
        lines.push(`        expect(response.status()).toBe(testCase.expectedStatus);`);
        lines.push(`      } else {`);
        lines.push(`        expect(response.status()).toBe(testCase.expectedStatus);`);
        lines.push(`      }`);
        lines.push(`    });`);
        lines.push(`  }`);
        lines.push(`});`);
        break;

      case 'cypress':
        lines.push(`describe('${test.method} ${test.endpoint} - Data Driven Tests', () => {`);
        lines.push(`  testData.forEach((testCase) => {`);
        lines.push(`    it(testCase.name, () => {`);
        lines.push(`      cy.request({`);
        lines.push(`        method: '${test.method}',`);
        lines.push(`        url: '${test.endpoint}',`);
        lines.push(`        body: testCase.data,`);
        lines.push(`        failOnStatusCode: false`);
        lines.push(`      }).then((response) => {`);
        lines.push(`        expect(response.status).to.equal(testCase.expectedStatus);`);
        lines.push(`      });`);
        lines.push(`    });`);
        lines.push(`  });`);
        lines.push(`});`);
        break;
    }

    return lines.join('\n');
  }

  exportAsCSV(test: ParameterizedTest): string {
    const lines: string[] = [];

    // Header
    const headers = ['name', 'type', 'expectedOutcome', 'expectedStatus', ...Object.keys(test.dataSets[0]?.data || {})];
    lines.push(headers.join(','));

    // Data rows
    test.dataSets.forEach(ds => {
      const row = [
        `"${ds.name}"`,
        ds.type,
        ds.expectedOutcome,
        String(ds.expectedStatus || 200),
        ...Object.values(ds.data).map(v => `"${JSON.stringify(v)}"`)
      ];
      lines.push(row.join(','));
    });

    return lines.join('\n');
  }

  exportAsJSON(test: ParameterizedTest): string {
    return JSON.stringify({
      endpoint: test.endpoint,
      method: test.method,
      dataSets: test.dataSets,
      parameterDescriptions: test.parameterDescriptions
    }, null, 2);
  }
}

interface FieldInfo {
  name: string;
  path: string;
  type: string;
  value: any;
  description: string;
  constraints: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    format?: string;
    pattern?: RegExp;
    decimal?: boolean;
  };
}

interface Variation {
  name: string;
  description: string;
  value: any;
}
