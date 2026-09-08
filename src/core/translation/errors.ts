/**
 * Translation pipeline error codes.
 */
export enum TranslationErrorCode {
  API_KEY_MISSING = 'API_KEY_MISSING',
  RATE_LIMITED = 'RATE_LIMITED',
  AUTH_ERROR = 'AUTH_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
}

/**
 * Typed error thrown by the translation pipeline.
 */
export class TranslationError extends Error {
  readonly code: TranslationErrorCode;

  constructor(code: TranslationErrorCode, message: string) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
  }
}
