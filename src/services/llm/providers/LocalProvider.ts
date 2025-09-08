import { HARData, GenerationOptions, GeneratedTest } from '@/types';
import { LLMProvider } from '../LLMService';

export class LocalProvider implements LLMProvider {
  private baseUrl = 'http://localhost:11434'; // Ollama default

  async generateTests(
    harData: HARData,
    options: GenerationOptions
  ): Promise<GeneratedTest> {
    try {
      // For local models, we generate a basic template
      // In production, this would connect to Ollama or similar
      const code = this.generateBasicTemplate(harData, options);

      return {
        id: `test_${Date.now()}`,
        framework: options.framework,
        code,
        qualityScore: 6,
        estimatedTokens: 0,
        estimatedCost: 0,
        warnings: ['Generated using local template - consider using AI provider for better results'],
        suggestions: [],
      };
    } catch (error) {
      console.error('Local generation error:', error);
      throw new Error('Failed to generate tests locally');
    }
  }

  estimateCost(tokenCount: number): number {
    return 0; // Local models are free
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private generateBasicTemplate(harData: HARData, options: GenerationOptions): string {
    const framework = options.framework;
    const entries = harData.entries.slice(0, 10);

    if (framework === 'jest') {
      return this.generateJestTemplate(entries, options);
    } else if (framework === 'playwright') {
      return this.generatePlaywrightTemplate(entries, options);
    } else if (framework === 'mocha-chai') {
      return this.generateMochaTemplate(entries, options);
    } else {
      return this.generateGenericTemplate(entries, options);
    }
  }

  private generateJestTemplate(entries: any[], options: GenerationOptions): string {
    let code = `// Generated API Tests
const axios = require('axios');

describe('API Tests', () => {
  const baseURL = process.env.API_BASE_URL || 'http://localhost:3000';
  
  beforeAll(() => {
    // Setup code here
  });

  afterAll(() => {
    // Cleanup code here
  });
`;

    entries.forEach((entry, index) => {
      const url = new URL(entry.request.url);
      const path = url.pathname;
      const method = entry.request.method;

      code += `
  test('${method} ${path}', async () => {
    const response = await axios.${method.toLowerCase()}(\`\${baseURL}${path}\`${
        entry.request.postData ? `, ${entry.request.postData.text}` : ''
      });
    
    expect(response.status).toBe(${entry.response.status});
    expect(response.data).toBeDefined();
`;

      if (options.includeErrorScenarios) {
        code += `    
    // Error scenario test
    try {
      await axios.${method.toLowerCase()}(\`\${baseURL}${path}/invalid\`);
    } catch (error) {
      expect(error.response.status).toBeGreaterThanOrEqual(400);
    }
`;
      }

      if (options.includePerformanceTests) {
        code += `    
    // Performance assertion
    const startTime = Date.now();
    await axios.${method.toLowerCase()}(\`\${baseURL}${path}\`);
    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(1000); // Should complete within 1 second
`;
      }

      code += `  });
`;
    });

    code += `});`;

    return code;
  }

  private generatePlaywrightTemplate(entries: any[], options: GenerationOptions): string {
    let code = `// Playwright API Tests
import { test, expect } from '@playwright/test';

test.describe('API Tests', () => {
  const baseURL = process.env.API_BASE_URL || 'http://localhost:3000';

`;

    entries.forEach((entry) => {
      const url = new URL(entry.request.url);
      const path = url.pathname;
      const method = entry.request.method;

      code += `  test('${method} ${path}', async ({ request }) => {
    const response = await request.${method.toLowerCase()}(\`\${baseURL}${path}\`);
    expect(response.status()).toBe(${entry.response.status});
    const body = await response.json();
    expect(body).toBeDefined();
  });

`;
    });

    code += `});`;

    return code;
  }

  private generateMochaTemplate(entries: any[], options: GenerationOptions): string {
    let code = `// Mocha/Chai API Tests
const chai = require('chai');
const chaiHttp = require('chai-http');
const expect = chai.expect;

chai.use(chaiHttp);

describe('API Tests', () => {
  const baseURL = process.env.API_BASE_URL || 'http://localhost:3000';

`;

    entries.forEach((entry) => {
      const url = new URL(entry.request.url);
      const path = url.pathname;
      const method = entry.request.method;

      code += `  it('should ${method} ${path}', (done) => {
    chai.request(baseURL)
      .${method.toLowerCase()}('${path}')
      .end((err, res) => {
        expect(res).to.have.status(${entry.response.status});
        expect(res.body).to.be.an('object');
        done();
      });
  });

`;
    });

    code += `});`;

    return code;
  }

  private generateGenericTemplate(entries: any[], options: GenerationOptions): string {
    let code = `// API Test Template
// Framework: ${options.framework}

// Test Suite
`;

    entries.forEach((entry) => {
      code += `
// Test: ${entry.request.method} ${entry.request.url}
// Expected Status: ${entry.response.status}
// TODO: Implement test using ${options.framework}

`;
    });

    return code;
  }
}