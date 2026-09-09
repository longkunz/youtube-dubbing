import type { Segment, Transcript } from '../../types/domain';
import { getSettings, normalizeEndpoint } from '../../storage/settings';
import { defaultFetch } from '../default-fetch';
import { TranslationError, TranslationErrorCode } from './errors';
import type { TranslationClient, TranslateOptions, FetchFn } from './types';

export { normalizeEndpoint };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OpenAiCompatibleClientOptions {
  /** Base URL for the OpenAI-compatible proxy (e.g. "https://api.openai.com/v1"). */
  endpoint?: string;
  /** Model identifier to query (e.g. "gpt-4o-mini"). */
  model?: string;
  /** Optional API key for proxy authorization. */
  apiKey?: string;
  /** Custom fetch implementation for unit testing and network interception. */
  fetchFn?: FetchFn;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TranslationItem {
  id: string;
  translatedText: string;
  speakerGender?: 'female' | 'male' | string;
}

interface TranslationPayload {
  translations: TranslationItem[];
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      role?: string;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TARGET_LANGUAGE = 'vi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

/**
 * Parses Server-Sent Events (SSE / text/event-stream) payload and reconstructs
 * the accumulated content string across all streamed chunks.
 */
export function parseSseStream(sseText: string): string {
  const lines = sseText.split(/\r?\n/);
  let accumulated = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        const choice = parsed.choices?.[0];
        const chunk =
          choice?.delta?.content ??
          choice?.text ??
          choice?.message?.content ??
          parsed.delta?.content ??
          '';
        if (typeof chunk === 'string') {
          accumulated += chunk;
        }
      } catch {
        // Not a JSON chunk, ignore
      }
    }
  }
  return accumulated;
}

function buildPrompts(segments: Segment[], targetLanguage: string): { systemPrompt: string; userPrompt: string } {
  const segmentList = segments
    .map((s) => `{ "id": ${JSON.stringify(s.id)}, "sourceText": ${JSON.stringify(s.sourceText)} }`)
    .join(',\n  ');

  const systemPrompt = `You are a professional translator and dialogue analyst. Translate the following dialogue segments into ${targetLanguage} and perform speaker diarization.

Rules:
- Translate naturally and conversationally.
- Preserve technical terminology, proper nouns, and brand names.
- Keep consistent pronouns throughout.
- Infer speaker gender ('female' or 'male') for each segment from conversational context, tone, and pronouns. Tag each segment with "speakerGender": "female" | "male".
- Preserve the segment "id" field exactly as given.
- Return ONLY a valid JSON object with this exact shape:
  { "translations": [ { "id": "<id>", "translatedText": "<translation>", "speakerGender": "female" | "male" }, ... ] }
- Do NOT include markdown fences, explanations, or any extra text.`;

  const userPrompt = `Segments to translate:
[
  ${segmentList}
]`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// OpenAiCompatibleTranslationClient
// ---------------------------------------------------------------------------

export class OpenAiCompatibleTranslationClient implements TranslationClient {
  private readonly endpoint?: string;
  private readonly model?: string;
  private readonly apiKey?: string;
  private readonly fetchFn: FetchFn;

  constructor(options: OpenAiCompatibleClientOptions = {}) {
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? defaultFetch;
  }

  async translateTranscript(
    transcript: Transcript,
    options?: TranslateOptions,
  ): Promise<Transcript> {
    const targetLanguage = options?.targetLanguage ?? DEFAULT_TARGET_LANGUAGE;
    const translatedSegments = await this.translateSegments(transcript.segments, { targetLanguage });

    return {
      ...transcript,
      targetLanguage,
      segments: translatedSegments,
    };
  }

  async translateSegments(segments: Segment[], options?: TranslateOptions): Promise<Segment[]> {
    if (segments.length === 0) {
      return [];
    }

    const targetLanguage = options?.targetLanguage ?? DEFAULT_TARGET_LANGUAGE;
    const config = await this.resolveConfig();
    const rawText = await this.callOpenAiApi(config, segments, targetLanguage);
    const payload = this.parseResponse(rawText);

    const resultMap = new Map<string, TranslationItem>(
      payload.translations.map((t) => [t.id, t]),
    );

    return segments.map((seg) => {
      const item = resultMap.get(seg.id);
      if (!item) return { ...seg };

      let speakerGender = seg.speakerGender;
      if (item.speakerGender) {
        const normalized = item.speakerGender.toLowerCase().trim();
        if (normalized === 'female' || normalized === 'male') {
          speakerGender = normalized as 'female' | 'male';
        }
      }

      return {
        ...seg,
        translatedText: item.translatedText,
        speakerGender,
      };
    });
  }

  private async resolveConfig(): Promise<{ endpoint: string; model: string; apiKey?: string }> {
    let endpoint = this.endpoint;
    let model = this.model;
    let apiKey = this.apiKey;

    if (!endpoint || !model || apiKey === undefined) {
      try {
        const settings = await getSettings();
        if (!endpoint) endpoint = settings.openaiEndpoint || DEFAULT_ENDPOINT;
        if (!model) model = settings.openaiModel || DEFAULT_MODEL;
        if (apiKey === undefined) apiKey = settings.openaiApiKey || '';
      } catch {
        if (!endpoint) endpoint = DEFAULT_ENDPOINT;
        if (!model) model = DEFAULT_MODEL;
        if (apiKey === undefined) apiKey = '';
      }
    }

    return {
      endpoint: endpoint || DEFAULT_ENDPOINT,
      model: model || DEFAULT_MODEL,
      apiKey,
    };
  }

  private async callOpenAiApi(
    config: { endpoint: string; model: string; apiKey?: string },
    segments: Segment[],
    targetLanguage: string,
  ): Promise<string> {
    const url = normalizeEndpoint(config.endpoint);
    const { systemPrompt, userPrompt } = buildPrompts(segments, targetLanguage);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey && config.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    const requestBody: Record<string, any> = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      stream: false,
      response_format: { type: 'json_object' },
    };

    let response: any;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      throw new TranslationError(
        TranslationErrorCode.NETWORK_ERROR,
        `Network error while calling OpenAI proxy: ${(err as Error).message}`,
      );
    }

    // Graceful fallback for proxies that don't support response_format
    if (!response.ok && response.status === 400) {
      let errorText = '';
      try {
        if (typeof response.clone === 'function') {
          errorText = await response.clone().text();
        } else if (typeof response.text === 'function') {
          errorText = await response.text();
        }
      } catch {
        // Safe catch
      }

      if (errorText.toLowerCase().includes('response_format')) {
        const fallbackBody = { ...requestBody };
        delete fallbackBody.response_format;

        try {
          response = await this.fetchFn(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(fallbackBody),
          });
        } catch (err) {
          throw new TranslationError(
            TranslationErrorCode.NETWORK_ERROR,
            `Network error during fallback retry to OpenAI proxy: ${(err as Error).message}`,
          );
        }
      }
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new TranslationError(
          TranslationErrorCode.RATE_LIMITED,
          'OpenAI proxy rate limit exceeded (HTTP 429). Please try again later.',
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new TranslationError(
          TranslationErrorCode.AUTH_ERROR,
          `OpenAI proxy authentication error (HTTP ${response.status}). Check your API key.`,
        );
      }
      throw new TranslationError(
        TranslationErrorCode.NETWORK_ERROR,
        `OpenAI proxy returned unexpected status ${response.status}.`,
      );
    }

    const contentType = (() => {
      try {
        return response.headers?.get?.('content-type') ?? '';
      } catch {
        return '';
      }
    })();

    let rawText = '';
    let body: OpenAiChatCompletionResponse | null = null;

    // Read body text first if available, avoiding premature stream lock
    if (typeof response.text === 'function') {
      try {
        rawText = await response.text();
      } catch {
        rawText = '';
      }
    } else if (typeof response.clone === 'function') {
      try {
        const cloned = response.clone();
        if (typeof cloned.text === 'function') {
          rawText = await cloned.text();
        }
      } catch {
        rawText = '';
      }
    }

    if (rawText) {
      try {
        body = JSON.parse(rawText) as OpenAiChatCompletionResponse;
      } catch {
        // Not standard JSON — might be SSE or plain text
      }
    } else if (typeof response.json === 'function') {
      // Mock / fallback support where response only provides .json()
      try {
        body = (await response.json()) as OpenAiChatCompletionResponse;
      } catch {
        body = null;
      }
    }

    let content = body?.choices?.[0]?.message?.content;

    // If no content from standard envelope, check for SSE (text/event-stream or data: lines)
    if (!content && (contentType.toLowerCase().includes('text/event-stream') || rawText.includes('data:'))) {
      const sseAccumulated = parseSseStream(rawText);
      if (sseAccumulated) {
        content = sseAccumulated;
      }
    }

    if (!content && rawText) {
      // Fallback: proxy returned the translations payload without envelope.
      try {
        this.parseResponse(rawText);
        return rawText;
      } catch {
        // Not a direct payload either — fall through to the diagnostic error.
      }
    }
    if (!content) {
      const snippet = rawText.trim() ? rawText.trim().slice(0, 300) : '<empty body>';
      throw new TranslationError(
        TranslationErrorCode.INVALID_RESPONSE,
        `OpenAI proxy returned non-JSON body (HTTP ${response.status}, content-type: ${contentType || 'unknown'}): ${snippet}`,
      );
    }

    return content;
  }

  private parseResponse(rawText: string): TranslationPayload {
    const stripped = stripMarkdownFences(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      throw new TranslationError(
        TranslationErrorCode.INVALID_RESPONSE,
        `OpenAI proxy response is not valid JSON. Raw: ${stripped.slice(0, 200)}`,
      );
    }

    const payload = parsed as TranslationPayload;
    if (!Array.isArray(payload?.translations)) {
      throw new TranslationError(
        TranslationErrorCode.INVALID_RESPONSE,
        'OpenAI proxy response JSON does not contain a "translations" array.',
      );
    }

    return payload;
  }
}
