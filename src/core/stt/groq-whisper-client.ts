import { defaultFetch } from '../default-fetch';
import type { FetchFn } from '../translation/types';
import type { Segment } from '../../types/domain';
import { whisperSegmentsToDomain, type WhisperVerboseSegment } from './audio-stream';

const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_WHISPER_MODEL = 'whisper-large-v3';

export interface GroqWhisperClientOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: FetchFn;
}

/**
 * Groq OpenAI-compatible Whisper client.
 * Public seam: transcribeBlob(audio) → Segment[].
 */
export class GroqWhisperClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: FetchFn;

  constructor(options: GroqWhisperClientOptions = {}) {
    this.apiKey = options.apiKey ?? '';
    this.model = options.model?.trim() || DEFAULT_WHISPER_MODEL;
    this.fetchFn = options.fetchFn ?? defaultFetch;
  }

  async transcribeBlob(audio: Blob, options?: { language?: string }): Promise<Segment[]> {
    const apiKey = this.apiKey.trim();
    if (!apiKey) {
      throw new Error('Groq API key is missing. Set it in the Command Center to use Whisper STT fallback.');
    }

    const form = new FormData();
    form.append('file', audio, 'audio.webm');
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    if (options?.language) {
      form.append('language', options.language);
    }

    let response: Response;
    try {
      response = await this.fetchFn(GROQ_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });
    } catch (err) {
      throw new Error(`Network error while calling Groq Whisper: ${(err as Error).message}`);
    }

    if (!response.ok) {
      let apiMessage = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { error?: { message?: string } };
        if (body?.error?.message) apiMessage = body.error.message;
      } catch {
        // keep status text
      }
      throw new Error(`Groq Whisper failed: ${apiMessage}`);
    }

    const payload = (await response.json()) as {
      text?: string;
      segments?: WhisperVerboseSegment[];
    };

    if (Array.isArray(payload.segments) && payload.segments.length > 0) {
      return whisperSegmentsToDomain(payload.segments);
    }

    const text = (payload.text ?? '').trim();
    if (!text) {
      throw new Error('Groq Whisper returned an empty transcript.');
    }
    return whisperSegmentsToDomain([{ start: 0, end: 0, text }]);
  }
}
