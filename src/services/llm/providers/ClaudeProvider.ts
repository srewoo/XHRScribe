import axios, { AxiosError } from 'axios';
import { encode } from 'gpt-tokenizer';
import { HARData, GenerationOptions, GeneratedTest } from '@/types';
import { LLMProvider } from '../LLMService';

interface ClaudeErrorResponse {
  error?: {
    message: string;
    type: string;
  };
}

export class ClaudeProvider implements LLMProvider {
  private apiKey: string = '';
  private baseUrl = 'https://api.anthropic.com/v1';
  private maxRetries = 3;
  private retryDelay = 1000;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async generateTests(
    harData: HARData,
    options: GenerationOptions
  ): Promise<GeneratedTest> {
    if (!this.apiKey) {
      throw new Error('Claude API key not configured');
    }

    const prompt = this.buildPrompt(harData, options);
    const promptTokens = this.countTokens(prompt);
    const systemPromptTokens = this.countTokens('You are an expert API test engineer. Generate clean, production-ready test code.');
    const totalInputTokens = promptTokens + systemPromptTokens;

    // Check token limits before making API call
    const modelLimit = this.getMaxTokens(options.model);
    if (totalInputTokens > modelLimit * 0.8) {
      throw new Error(`Prompt too large for ${options.model}. Consider reducing the number of requests or using a model with higher token limits.`);
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/messages`,
          {
            model: options.model,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            system: 'You are an expert API test engineer. Generate clean, production-ready test code.',
            max_tokens: Math.min(4096, modelLimit - totalInputTokens),
            temperature: 0.7,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': this.apiKey,
              'anthropic-version': '2023-06-01',
            },
            timeout: 60000,
          }
        );

        const generatedCode = response.data.content[0].text;
        const completionTokens = this.countTokens(generatedCode);
        const totalTokens = totalInputTokens + completionTokens;
        const qualityScore = this.calculateQualityScore(generatedCode, harData);

        return {
          id: `test_${Date.now()}`,
          framework: options.framework,
          code: generatedCode,
          qualityScore,
          estimatedTokens: totalTokens,
          estimatedCost: this.estimateCost(totalTokens, options.model),
          warnings: this.analyzeCode(generatedCode),
          suggestions: this.generateSuggestions(generatedCode, options),
        };
      } catch (error) {
        lastError = error as Error;
        
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError<ClaudeErrorResponse>;
          
          // Handle specific Claude error codes
          if (axiosError.response?.status === 401) {
            throw new Error('Invalid Claude API key. Please check your settings.');
          }
          
          if (axiosError.response?.status === 429) {
            // Rate limit - wait and retry
            if (attempt < this.maxRetries - 1) {
              await this.delay(this.retryDelay * (attempt + 1));
              continue;
            }
            throw new Error('Claude rate limit exceeded. Please try again later.');
          }
          
          if (axiosError.response?.status === 400) {
            const errorMessage = axiosError.response.data?.error?.message || 'Invalid request';
            throw new Error(`Claude API error: ${errorMessage}`);
          }
          
          if (axiosError.response?.status === 503 || axiosError.response?.status === 529) {
            // Service unavailable or overloaded - wait and retry
            if (attempt < this.maxRetries - 1) {
              await this.delay(this.retryDelay * (attempt + 1));
              continue;
            }
            throw new Error('Claude service temporarily unavailable. Please try again.');
          }
        }
        
        // For other errors, retry with exponential backoff
        if (attempt < this.maxRetries - 1) {
          await this.delay(this.retryDelay * Math.pow(2, attempt));
          continue;
        }
      }
    }

    // If all retries failed
    console.error('Claude API error after retries:', lastError);
    throw new Error(`Failed to generate tests with Claude: ${lastError?.message || 'Unknown error'}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  estimateCost(tokenCount: number, model: string): number {
    // Claude pricing as of 2024
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-opus-20240229': { input: 0.015, output: 0.075 }, // per 1k tokens
      'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
      'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
      'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
    };
    
    const modelPricing = pricing[model] || pricing['claude-3-haiku-20240307'];
    // Rough estimate: 60% input, 40% output
    const inputTokens = tokenCount * 0.6;
    const outputTokens = tokenCount * 0.4;
    
    return (inputTokens / 1000) * modelPricing.input + (outputTokens / 1000) * modelPricing.output;
  }

  countTokens(text: string): number {
    try {
      // Use gpt-tokenizer as approximation for Claude
      const tokens = encode(text);
      return tokens.length;
    } catch (error) {
      // Fallback to rough estimation
      return Math.ceil(text.length / 4);
    }
  }

  private getMaxTokens(model: string): number {
    const limits: Record<string, number> = {
      'claude-3-opus-20240229': 200000,
      'claude-3-5-sonnet-20241022': 200000,
      'claude-3-sonnet-20240229': 200000,
      'claude-3-haiku-20240307': 200000,
    };
    return limits[model] || 100000;
  }

  private buildPrompt(harData: HARData, options: GenerationOptions): string {
    const framework = options.framework;
    const entries = harData.entries.slice(0, 30); // Claude can handle more context

    let prompt = `Generate comprehensive ${framework} test code for the following API requests.\n\n`;
    
    // Add framework-specific instructions
    prompt += this.getFrameworkInstructions(framework);
    prompt += '\n\n';
    
    // Add test requirements
    prompt += 'Requirements:\n';
    if (options.includeAuth) {
      prompt += '- Include authentication tests with proper token handling\n';
    }
    if (options.includeErrorScenarios) {
      prompt += '- Include comprehensive error scenario tests (400, 401, 403, 404, 500, 503)\n';
    }
    if (options.includePerformanceTests) {
      prompt += '- Include performance assertions and response time checks\n';
    }
    if (options.includeSecurityTests) {
      prompt += '- Include security tests (SQL injection, XSS, authentication bypass)\n';
    }
    if (options.generateMockData) {
      prompt += '- Generate realistic mock data using faker or similar libraries\n';
    }
    if (options.includeEdgeCases) {
      prompt += '- Include edge case tests (empty data, null values, boundary conditions)\n';
    }
    if (options.includeIntegrationTests) {
      prompt += '- Include integration tests that test multiple endpoints together\n';
    }

    prompt += '\nAPI Endpoints to Test:\n';
    
    // Group requests by endpoint
    const groupedRequests = this.groupRequestsByEndpoint(entries);
    
    for (const [endpoint, requests] of Object.entries(groupedRequests)) {
      prompt += `\n${endpoint}:\n`;
      requests.forEach(entry => {
        prompt += `  - ${entry.request.method}`;
        if (entry.request.postData) {
          const bodyPreview = entry.request.postData.text?.substring(0, 100);
          prompt += ` (Body: ${bodyPreview}...)`;
        }
        prompt += ` → ${entry.response.status}`;
        if (entry.response.content.text) {
          const responsePreview = entry.response.content.text.substring(0, 100);
          prompt += ` (Response: ${responsePreview}...)`;
        }
        prompt += '\n';
      });
    }

    prompt += '\n\nGenerate complete, production-ready test code with:\n';
    prompt += '1. Proper test organization and structure\n';
    prompt += '2. Clear test descriptions\n';
    prompt += '3. Comprehensive assertions\n';
    prompt += '4. Error handling\n';
    prompt += '5. Setup and teardown hooks where appropriate\n';
    prompt += '6. Comments explaining complex test logic\n';

    return prompt;
  }

  private groupRequestsByEndpoint(entries: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    entries.forEach(entry => {
      try {
        const url = new URL(entry.request.url);
        const endpoint = `${url.pathname}`;
        if (!grouped[endpoint]) {
          grouped[endpoint] = [];
        }
        grouped[endpoint].push(entry);
      } catch (error) {
        // If URL parsing fails, use the full URL
        const endpoint = entry.request.url;
        if (!grouped[endpoint]) {
          grouped[endpoint] = [];
        }
        grouped[endpoint].push(entry);
      }
    });
    
    return grouped;
  }

  private getFrameworkInstructions(framework: string): string {
    const instructions: Record<string, string> = {
      jest: `Use Jest testing framework with:
- describe() blocks for test suites
- it() or test() for individual tests
- beforeAll/beforeEach for setup
- afterAll/afterEach for cleanup
- expect() for assertions
- async/await for asynchronous tests`,
      
      playwright: `Use Playwright test framework with:
- test.describe() for test suites
- test() for individual tests
- test.beforeAll/beforeEach for setup
- expect() for assertions
- request context for API testing
- proper error handling`,
      
      'mocha-chai': `Use Mocha with Chai assertions:
- describe() for test suites
- it() for individual tests
- before/beforeEach hooks
- after/afterEach hooks
- chai.expect() for assertions
- chai-http for HTTP requests`,
      
      cypress: `Use Cypress for API testing:
- describe() and it() blocks
- cy.request() for API calls
- cy.intercept() for mocking
- proper assertions with should()
- custom commands where appropriate`,
      
      puppeteer: `Use Puppeteer with Jest:
- describe() and test() blocks
- page.evaluate() for API calls
- proper browser context management
- screenshots on failure
- network interception where needed`,
      
      vitest: `Use Vitest testing framework:
- describe() and it() blocks
- vi.mock() for mocking
- expect() for assertions
- beforeAll/afterAll hooks
- proper TypeScript types`,
      
      supertest: `Use Supertest for API testing:
- describe() and it() blocks
- supertest(app) for requests
- .expect() for status assertions
- .expect() with callback for body assertions
- proper async/await usage`,
      
      postman: `Generate Postman collection JSON with:
- Proper collection structure
- Pre-request scripts
- Test scripts in JavaScript
- Environment variables
- Collection variables
- Response examples`,
    };

    return instructions[framework] || instructions.jest;
  }

  private calculateQualityScore(code: string, harData: HARData): number {
    let score = 5; // Base score

    // Check for test coverage
    const coveredEndpoints = harData.entries.filter(entry => {
      const url = entry.request.url;
      const pathname = new URL(url).pathname;
      return code.includes(url) || code.includes(pathname);
    }).length;
    
    score += Math.min(3, (coveredEndpoints / Math.min(harData.entries.length, 20)) * 3);

    // Check for assertions
    if (code.includes('expect') || code.includes('assert') || code.includes('.should')) score += 0.5;

    // Check for error handling
    if (code.includes('catch') || code.includes('try') || code.includes('.catch')) score += 0.5;

    // Check for async handling
    if (code.includes('async') || code.includes('await') || code.includes('.then')) score += 0.5;

    // Check for test organization
    if (code.includes('describe') || code.includes('test.describe')) score += 0.5;

    return Math.min(10, score);
  }

  private analyzeCode(code: string): string[] {
    const warnings: string[] = [];

    if (!code.includes('expect') && !code.includes('assert') && !code.includes('should')) {
      warnings.push('No assertions found in generated tests');
    }

    if (code.includes('localhost') || code.includes('127.0.0.1')) {
      warnings.push('Tests contain hardcoded localhost URLs');
    }

    if (code.includes('Bearer') && !code.includes('process.env') && !code.includes('${')) {
      warnings.push('API keys or tokens may be hardcoded');
    }

    if (code.length < 200) {
      warnings.push('Generated tests seem incomplete');
    }

    if (!code.includes('describe') && !code.includes('suite')) {
      warnings.push('Tests lack proper organization structure');
    }

    return warnings;
  }

  private generateSuggestions(code: string, options: GenerationOptions): string[] {
    const suggestions: string[] = [];

    if (!code.includes('describe') && options.framework !== 'postman') {
      suggestions.push('Consider organizing tests in describe blocks for better structure');
    }

    if (!code.includes('timeout') && !code.includes('jest.setTimeout')) {
      suggestions.push('Consider adding timeout configurations for long-running tests');
    }

    if (!code.includes('beforeEach') && !code.includes('beforeAll') && !code.includes('setup')) {
      suggestions.push('Consider adding setup hooks for test initialization');
    }

    if (options.includePerformanceTests && !code.includes('performance.now') && !code.includes('Date.now')) {
      suggestions.push('Add explicit performance measurement using performance.now() or Date.now()');
    }

    if (!code.includes('afterEach') && !code.includes('afterAll') && !code.includes('cleanup')) {
      suggestions.push('Consider adding cleanup hooks to prevent test pollution');
    }

    if (!code.includes('mock') && !code.includes('stub') && !code.includes('spy')) {
      suggestions.push('Consider using mocks/stubs for external dependencies');
    }

    return suggestions;
  }
}