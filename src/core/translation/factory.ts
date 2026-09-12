import type { UserSettings } from '../../storage/settings';
import type { TranslationClient, FetchFn } from './types';
import { BackendTranslationClient } from './backend-client';
import { GeminiTranslationClient } from './gemini-client';
import { OpenAiCompatibleTranslationClient } from './openai-client';

/**
 * Factory that instantiates the appropriate TranslationClient
 * based on user settings (self-hosted vs. Gemini vs. OpenAI-compatible proxy).
 */
export function createTranslationClient(
  settings?: Partial<UserSettings>,
  overrides?: { fetchFn?: FetchFn },
): TranslationClient {
  const provider = settings?.translationProvider;

  if (provider === 'self-hosted') {
    return new BackendTranslationClient({
      baseUrl: settings?.backendUrl ?? 'http://127.0.0.1:8787',
      apiKey: settings?.backendApiKey ?? '',
      fetchFn: overrides?.fetchFn,
    });
  }

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
