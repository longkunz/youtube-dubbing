import type { Segment, Transcript } from '../../types/domain';
import { TranslationError, TranslationErrorCode } from './errors';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal fetch function signature compatible with both global fetch and vi.fn() mocks. */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<any>;

export interface GeminiTranslationClientOptions {
  /** Explicit Gemini API key. When omitted the client reads from chrome.storage.local. */
  apiKey?: string;
  /** Gemini model to use. Defaults to "gemini-2.0-flash". */
  model?: string;
  /**
   * Injectable fetch function. Defaults to the global `fetch`.
   * Pass a mock in tests to avoid real HTTP calls.
   */
  fetchFn?: FetchFn;
}

export interface TranslateOptions {
  /** Target translation language code (BCP-47). Defaults to "vi". */
  targetLanguage?: string;
}

// ---------------------------------------------------------------------------
// Internal types — shape returned by Gemini
// ---------------------------------------------------------------------------

interface GeminiTranslationItem {
  id: string;
  translatedText: string;
}

interface GeminiTranslationPayload {
  translations: GeminiTranslationItem[];
}

interface GeminiCandidate {
  content: {
    parts: Array<{ text: string }>;
  };
}

interface GeminiApiResponse {
  candidates?: GeminiCandidate[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_TARGET_LANGUAGE = 'vi';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip optional markdown code-block fences (```json ... ```) from text. */
function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

/** Build the system + user prompt for a batch translation request. */
function buildPrompt(segments: Segment[], targetLanguage: string): string {
  const segmentList = segments
    .map((s) => `{ "id": ${JSON.stringify(s.id)}, "sourceText": ${JSON.stringify(s.sourceText)} }`)
    .join(',\n  ');

  return `You are a professional translator. Translate the following dialogue segments into ${targetLanguage}.

Rules:
- Translate naturally and conversationally.
- Preserve technical terminology, proper nouns, and brand names.
- Keep consistent pronouns throughout.
- Preserve the segment "id" field exactly as given.
- Return ONLY a valid JSON object with this exact shape:
  { "translations": [ { "id": "<id>", "translatedText": "<translation>" }, ... ] }
- Do NOT include markdown fences, explanations, or any extra text.

Segments to translate:
[
  ${segmentList}
]`;
}

/** Read API key from chrome.storage.local (geminiApiKey, then apiKey fallback). */
async function readApiKeyFromStorage(): Promise<string | undefined> {
  try {
    const chromeStorage = (globalThis as any).chrome?.storage?.local;
    if (!chromeStorage) return undefined;
    const result = await chromeStorage.get(['geminiApiKey', 'apiKey']);
    return (result.geminiApiKey as string | undefined) || (result.apiKey as string | undefined);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// GeminiTranslationClient
// ---------------------------------------------------------------------------

/**
 * Deep module: batch-translates a Transcript or Segment[] using the Gemini REST API.
 *
 * Architecture: ADR-0001 (100% client-side BYOK — direct fetch to Gemini REST, no server).
 * Strategy: ADR-0003 (full upfront batch translation with gemini-2.0-flash).
 */
export class GeminiTranslationClient {
  private readonly apiKey: string | undefined;
  readonly model: string;
  private readonly fetchFn: FetchFn;

  constructor(options: GeminiTranslationClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Translate every segment in a Transcript, returning a new Transcript
   * with `translatedText` enriched on each segment.
   */
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

  /**
   * Translate an array of Segments, returning enriched copies.
   * Segments that receive no mapping from the model are returned unchanged.
   */
  async translateSegments(segments: Segment[], options?: TranslateOptions): Promise<Segment[]> {
    const targetLanguage = options?.targetLanguage ?? DEFAULT_TARGET_LANGUAGE;
    const apiKey = await this.resolveApiKey();

    const prompt = buildPrompt(segments, targetLanguage);
    const rawText = await this.callGeminiApi(apiKey, prompt);
    const payload = this.parseGeminiResponse(rawText);

    // Map by segment id for O(1) lookup
    const translationMap = new Map<string, string>(
      payload.translations.map((t) => [t.id, t.translatedText]),
    );

    return segments.map((seg) => {
      const translation = translationMap.get(seg.id);
      if (translation === undefined) return { ...seg };
      return { ...seg, translatedText: translation };
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async resolveApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey;

    const stored = await readApiKeyFromStorage();
    if (stored) return stored;

    throw new TranslationError(
      TranslationErrorCode.API_KEY_MISSING,
      'Gemini API key is missing. Please set it in the extension settings.',
    );
  }

  private async callGeminiApi(apiKey: string, prompt: string): Promise<string> {
    const url = `${GEMINI_API_BASE}/${this.model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });
    } catch (err) {
      throw new TranslationError(
        TranslationErrorCode.NETWORK_ERROR,
        `Network error while calling Gemini API: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new TranslationError(
          TranslationErrorCode.RATE_LIMITED,
          'Gemini API rate limit exceeded (HTTP 429). Please try again later.',
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new TranslationError(
          TranslationErrorCode.AUTH_ERROR,
          `Gemini API authentication error (HTTP ${response.status}). Check your API key.`,
        );
      }
      throw new TranslationError(
        TranslationErrorCode.NETWORK_ERROR,
        `Gemini API returned unexpected status ${response.status}.`,
      );
    }

    let body: GeminiApiResponse;
    try {
      body = (await response.json()) as GeminiApiResponse;
    } catch {
      throw new TranslationError(
        TranslationErrorCode.INVALID_RESPONSE,
        'Failed to parse Gemini API response body as JSON.',
      );
    }

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new TranslationError(
        TranslationErrorCode.INVALID_RESPONSE,
        'Gemini API returned an empty or malformed response (no candidates).',
      );
    }

    return text;
  }

  private parseGeminiResponse(rawText: string): GeminiTranslationPayload {
    const stripped = stripMarkdownFences(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      throw new TranslationError(
        TranslationErrorCode.INVALID_RESPONSE,
        `Gemini response is not valid JSON. Raw: ${stripped.slice(0, 200)}`,
      );
    }

    const payload = parsed as GeminiTranslationPayload;
    if (!Array.isArray(payload?.translations)) {
      throw new TranslationError(
        TranslationErrorCode.INVALID_RESPONSE,
        'Gemini response JSON does not contain a "translations" array.',
      );
    }

    return payload;
  }
}
