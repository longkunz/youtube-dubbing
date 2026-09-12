import type { Segment, Transcript } from '../../types/domain';

/**
 * Minimal fetch function signature compatible with global fetch and test mocks.
 */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<any>;

/**
 * Common translation options.
 */
export interface TranslateOptions {
  /** Target translation language code (BCP-47). Defaults to "vi". */
  targetLanguage?: string;
}

/**
 * Pluggable Translation Client interface for multi-provider translation pipeline.
 */
export interface TranslationClient {
  translateTranscript(transcript: Transcript, options?: TranslateOptions): Promise<Transcript>;
  translateSegments(segments: Segment[], options?: TranslateOptions): Promise<Segment[]>;
}
