import { AIModel } from '@/types';

export interface ModelOption {
  value: AIModel;
  label: string;
}

/**
 * Canonical list of selectable AI models, grouped by provider. Single source of
 * truth for the popup and options UIs — keep model IDs in sync with the type
 * union in `@/types` and each provider's pricing/limits tables.
 */
export const MODEL_OPTIONS: ModelOption[] = [
  // OpenAI Models
  { value: 'gpt-4o', label: 'GPT-4o (Most Capable)' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
  { value: 'gpt-4.1', label: 'GPT-4.1 (1M context)' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Cheapest)' },

  // Anthropic Claude Models
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 (Most Capable)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Balanced)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast & Cheap)' },

  // Google Gemini Models
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Latest)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Cheapest)' },

  // Local Models
  { value: 'llama-3.2', label: 'Llama 3.2' },
  { value: 'deepseek-coder', label: 'DeepSeek Coder' },
];
