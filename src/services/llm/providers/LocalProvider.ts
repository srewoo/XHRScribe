import axios from 'axios';
import { HARData, GenerationOptions, GeneratedTest } from '@/types';
import { LLMProvider } from '../LLMService';
import { AuthFlow } from '../../AuthFlowAnalyzer';
import { Logger } from '@/services/logging/Logger';

// Map UI model names to Ollama model names
const OLLAMA_MODEL_MAP: Record<string, string> = {
  'llama-3.2': 'llama3.2',
  'deepseek-coder': 'deepseek-coder',
};

export class LocalProvider implements LLMProvider {
  private baseUrl = 'http://localhost:11434'; // Ollama default

  private async isOllamaAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 3000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private buildOllamaPrompt(harData: HARData, options: GenerationOptions, authFlow?: AuthFlow): string {
    const endpointSummary = harData.entries.map(e => {
      const url = new URL(e.request.url);
      return `${e.request.method} ${url.pathname} → ${e.response.status}`;
    }).join('\n');

    return `You are an expert ${options.framework} test engineer. Generate comprehensive API test code.

FRAMEWORK: ${options.framework}
ENDPOINTS:
${endpointSummary}

${authFlow ? `AUTH: ${authFlow.authPattern} detected` : ''}

REQUIREMENTS:
- Generate complete, runnable ${options.framework} tests for ALL endpoints above
- Use environment variables for base URL (API_BASE_URL)
- Include proper imports, setup, and teardown
- Add meaningful assertions for status codes and response structure
${options.includeErrorScenarios ? '- Include error scenario tests (invalid inputs, 4xx responses)' : ''}
${options.includeAuth ? '- Include authentication tests' : ''}
${options.includePerformanceTests ? '- Include response time assertions' : ''}
${options.includeSecurityTests ? '- Include basic security checks (injection, auth bypass)' : ''}

HAR DATA:
${JSON.stringify(harData.entries.slice(0, 10), null, 2).substring(0, 4000)}

Return ONLY the test code, no explanations:`;
  }

  async generateTests(
    harData: HARData,
    options: GenerationOptions,
    authFlow?: AuthFlow,
    customAuthGuide?: string,
    signal?: AbortSignal
  ): Promise<GeneratedTest> {
    try {
      // Try Ollama first
      if (await this.isOllamaAvailable()) {
        return await this.generateWithOllama(harData, options, authFlow, signal);
      }

      // Fall back to template generation
      Logger.getInstance().info('Ollama not available, using template generation', null, 'LocalProvider');
      const code = this.generateBasicTemplate(harData, options);

      return {
        id: `test_${Date.now()}`,
        framework: options.framework,
        code,
        qualityScore: 6,
        estimatedTokens: 0,
        estimatedCost: 0,
        warnings: ['Ollama not running - generated using local template. Start Ollama for AI-powered results.'],
        suggestions: ['Install Ollama: https://ollama.ai', `Run: ollama pull ${OLLAMA_MODEL_MAP[options.model] || 'llama3.2'}`],
      };
    } catch (error) {
      Logger.getInstance().error('Local generation error', error, 'LocalProvider');
      throw new Error('Failed to generate tests locally');
    }
  }

  private async generateWithOllama(harData: HARData, options: GenerationOptions, authFlow?: AuthFlow, signal?: AbortSignal): Promise<GeneratedTest> {
    const ollamaModel = OLLAMA_MODEL_MAP[options.model] || 'llama3.2';
    const prompt = this.buildOllamaPrompt(harData, options, authFlow);

    Logger.getInstance().info(`Generating with Ollama model: ${ollamaModel}`, null, 'LocalProvider');

    const response = await axios.post(
      `${this.baseUrl}/api/generate`,
      { model: ollamaModel, prompt, stream: false },
      { timeout: 120000, signal }
    );

    const generatedCode = response.data.response || '';
    // Strip markdown code fences if present
    const code = generatedCode.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    const tokens = this.countTokens(prompt + code);

    return {
      id: `test_${Date.now()}`,
      framework: options.framework,
      code,
      qualityScore: 7,
      estimatedTokens: tokens,
      estimatedCost: 0,
      warnings: [`Generated locally with Ollama (${ollamaModel})`],
      suggestions: [],
    };
  }

  estimateCost(tokenCount: number): number {
    return 0; // Local models are free
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private generateBasicTemplate(harData: HARData, options: GenerationOptions): string {
    const framework = options.framework;
    const entries = harData.entries; // Process ALL entries even for local template

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