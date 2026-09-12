/**
 * Edge TTS error codes.
 */
export enum EdgeTtsErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_CLOSED = 'CONNECTION_CLOSED',
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
  SYNTHESIS_FAILED = 'SYNTHESIS_FAILED',
}

/**
 * Typed error thrown by EdgeTtsClient.
 */
export class EdgeTtsError extends Error {
  readonly code: EdgeTtsErrorCode;

  constructor(code: EdgeTtsErrorCode, message: string) {
    super(message);
    this.name = 'EdgeTtsError';
    this.code = code;
  }
}
