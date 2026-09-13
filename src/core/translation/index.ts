/**
 * Translation pipeline public seam.
 * Strictly uses Self-hosted Backend (MarianMT EN→VI) per ADR-0013.
 */

export type { TranslationClient, TranslateOptions, FetchFn } from './types';
export { BackendTranslationClient } from './backend-client';
export type { BackendTranslationClientOptions } from './backend-client';
export { createTranslationClient } from './factory';
export { TranslationError, TranslationErrorCode } from './errors';
