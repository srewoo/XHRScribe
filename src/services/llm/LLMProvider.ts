import { HARData, GenerationOptions, GeneratedTest } from '@/types';
import { AuthFlow } from '../AuthFlowAnalyzer';

/**
 * Common contract implemented by every LLM provider (OpenAI, Claude, Gemini,
 * Local). AIService instantiates the concrete provider for the user's selected
 * backend and calls these methods.
 */
export interface LLMProvider {
  generateTests(
    harData: HARData,
    options: GenerationOptions,
    authFlow?: AuthFlow,
    customAuthGuide?: string,
    signal?: AbortSignal
  ): Promise<GeneratedTest>;
  estimateCost(tokenCount: number, model?: string): number;
  countTokens(text: string): number;
}
