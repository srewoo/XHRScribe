import axios from 'axios';
import { HARData, GenerationOptions, GeneratedTest } from '@/types';
import { LLMProvider } from '../LLMService';

export class AnthropicProvider implements LLMProvider {
  private apiKey: string = '';
  private baseUrl = 'https://api.anthropic.com/v1';

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async generateTests(
    harData: HARData,
    options: GenerationOptions
  ): Promise<GeneratedTest> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const prompt = this.buildPrompt(harData, options);
    const tokens = this.countTokens(prompt);

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
          max_tokens: 4000,
          temperature: 0.7,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
        }
      );

      const generatedCode = response.data.content[0].text;

      return {
        id: `test_${Date.now()}`,
        framework: options.framework,
        code: generatedCode,
        qualityScore: this.calculateQualityScore(generatedCode),
        estimatedTokens: tokens,
        estimatedCost: this.estimateCost(tokens),
        warnings: [],
        suggestions: [],
      };
    } catch (error) {
      console.error('Anthropic API error:', error);
      throw new Error('Failed to generate tests with Claude');
    }
  }

  estimateCost(tokenCount: number): number {
    const costPer1kTokens = 0.003; // Claude pricing
    return (tokenCount / 1000) * costPer1kTokens;
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private buildPrompt(harData: HARData, options: GenerationOptions): string {
    return `Generate ${options.framework} test code for API testing based on the following HAR data.
Include comprehensive test coverage with proper assertions.

HAR Entries: ${JSON.stringify(harData.entries.slice(0, 10), null, 2)}

Requirements:
- Framework: ${options.framework}
- Include authentication tests: ${options.includeAuth}
- Include error scenarios: ${options.includeErrorScenarios}
- Include performance tests: ${options.includePerformanceTests}
- Generate mock data: ${options.generateMockData}

Generate complete, production-ready test code.`;
  }

  private calculateQualityScore(code: string): number {
    let score = 7;
    if (code.includes('describe')) score += 1;
    if (code.includes('expect') || code.includes('assert')) score += 1;
    if (code.includes('async')) score += 1;
    return Math.min(10, score);
  }
}