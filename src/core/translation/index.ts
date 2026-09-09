/**
 * Translation pipeline public seam.
 * Provides multi-provider batch translation of Transcript/Segment objects
 * supporting Google Gemini and OpenAI-compatible proxy endpoints.
 *
 * ADR-0001: 100% client-side BYOK (direct REST calls, no central server)
 * ADR-0003: Upfront full-transcript batch translation
 */

export type { TranslationClient, TranslateOptions, FetchFn } from './types';
export { GeminiTranslationClient } from './gemini-client';
export type { GeminiTranslationClientOptions } from './gemini-client';
export { OpenAiCompatibleTranslationClient, normalizeEndpoint } from './openai-client';
export type { OpenAiCompatibleClientOptions } from './openai-client';
export { createTranslationClient } from './factory';
export { TranslationError, TranslationErrorCode } from './errors';
