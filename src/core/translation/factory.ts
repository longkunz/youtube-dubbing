import type { UserSettings } from '../../storage/settings';
import type { TranslationClient, FetchFn } from './types';
import { GeminiTranslationClient } from './gemini-client';
import { OpenAiCompatibleTranslationClient } from './openai-client';

/**
 * Factory that instantiates the appropriate TranslationClient
 * based on user settings (Gemini vs. OpenAI-compatible proxy).
 */
export function createTranslationClient(
  settings?: Partial<UserSettings>,
  overrides?: { fetchFn?: FetchFn },
): TranslationClient {
  const provider = settings?.translationProvider;

  if (provider === 'openai-compatible') {
    return new OpenAiCompatibleTranslationClient({
      endpoint: settings?.openaiEndpoint,
      model: settings?.openaiModel,
      apiKey: settings?.openaiApiKey,
      fetchFn: overrides?.fetchFn,
    });
  }

  return new GeminiTranslationClient({
    apiKey: settings?.geminiApiKey,
    model: settings?.geminiModel,
    fetchFn: overrides?.fetchFn,
  });
}
