import type { Segment, Transcript } from '../../types/domain';
import { defaultFetch } from '../default-fetch';
import { TranslationError, TranslationErrorCode } from './errors';
import type { FetchFn, TranslateOptions, TranslationClient } from './types';

export interface BackendTranslationClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: FetchFn;
  sourceLanguage?: string;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export class BackendTranslationClient implements TranslationClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchFn;
  private readonly sourceLanguage: string;

  constructor(options: BackendTranslationClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || 'http://127.0.0.1:8787');
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? defaultFetch;
    this.sourceLanguage = options.sourceLanguage || 'en';
  }

  async translateTranscript(transcript: Transcript, options?: TranslateOptions): Promise<Transcript> {
    const segments = await this.translateSegments(transcript.segments, options);
    return { ...transcript, targetLanguage: options?.targetLanguage ?? 'vi', segments };
  }

  async translateSegments(segments: Segment[], options?: TranslateOptions): Promise<Segment[]> {
    const target = options?.targetLanguage ?? 'vi';
    const response = await this.fetchFn(`${this.baseUrl}/v1/translate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: this.sourceLanguage,
        target,
        cues: segments.map((s) => ({ id: s.id, text: s.sourceText || '' })),
      }),
    });
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? TranslationErrorCode.AUTH_ERROR
          : TranslationErrorCode.NETWORK_ERROR;
      throw new TranslationError(code, `Self-hosted translate failed: HTTP ${response.status}`, response.status);
    }
    const payload = await response.json();
    const byId = new Map<string, string>(
      (payload.items || []).map((item: { id: string; text: string }) => [item.id, item.text]),
    );
    return segments.map((segment) => {
      const translatedText = byId.get(segment.id);
      if (translatedText === undefined) return { ...segment };
      return { ...segment, translatedText };
    });
  }
}
