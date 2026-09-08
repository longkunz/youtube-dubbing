/**
 * Translation pipeline public seam.
 * Provides batch translation of Transcript/Segment objects via Gemini Flash.
 *
 * ADR-0001: 100% client-side BYOK (direct Gemini REST, no server)
 * ADR-0003: Upfront full-transcript batch translation
 */

export { GeminiTranslationClient } from './gemini-client';
export type { GeminiTranslationClientOptions, TranslateOptions, FetchFn } from './gemini-client';
export { TranslationError, TranslationErrorCode } from './errors';
