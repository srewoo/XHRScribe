import { OpenAIProvider } from '../llm/providers/OpenAIProvider';
import { ClaudeProvider } from '../llm/providers/ClaudeProvider';
import { GeminiProvider } from '../llm/providers/GeminiProvider';
import { LocalProvider } from '../llm/providers/LocalProvider';
import { AIProvider } from '@/types';

export class AIProviderFactory {
  static createProvider(provider: AIProvider, apiKey?: string) {
    switch (provider) {
      case 'openai':
        if (!apiKey) throw new Error('OpenAI API key is required');
        const openAIProvider = new OpenAIProvider();
        openAIProvider.setApiKey(apiKey);
        return openAIProvider;

      case 'anthropic':
        if (!apiKey) throw new Error('Anthropic API key is required');
        const claudeProvider = new ClaudeProvider();
        claudeProvider.setApiKey(apiKey);
        return claudeProvider;

      case 'gemini':
        if (!apiKey) throw new Error('Gemini API key is required');
        const geminiProvider = new GeminiProvider();
        geminiProvider.setApiKey(apiKey);
        return geminiProvider;

      case 'local':
        return new LocalProvider();

      default:
        throw new Error(`Unknown AI provider: ${provider}`);
    }
  }
}