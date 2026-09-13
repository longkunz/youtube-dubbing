import type { UserSettings } from '../../storage/settings';
import type { TranslationClient, FetchFn } from './types';
import { BackendTranslationClient } from './backend-client';

/**
 * Factory that strictly instantiates BackendTranslationClient (ADR-0013).
 */
export function createTranslationClient(
  settings?: Partial<UserSettings>,
  overrides?: { fetchFn?: FetchFn },
): TranslationClient {
  return new BackendTranslationClient({
    baseUrl: settings?.backendUrl ?? 'http://127.0.0.1:8787',
    apiKey: settings?.backendApiKey ?? '',
    fetchFn: overrides?.fetchFn,
  });
}
