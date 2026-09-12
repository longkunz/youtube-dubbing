import type { Segment, Transcript } from '../../types/domain';
import { DEFAULT_GEMINI_MODEL, GEMINI_FALLBACK_MODELS } from '../../storage/settings';
import { defaultFetch } from '../default-fetch';
import { TranslationError, TranslationErrorCode } from './errors';
import type { TranslationClient, TranslateOptions, FetchFn } from './types';

export type { TranslationClient, TranslateOptions, FetchFn };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GeminiTranslationClientOptions {
  /** Explicit Gemini API key. When omitted the client reads from chrome.storage.local. */
  apiKey?: string;
  /** Gemini model to use. Defaults to DEFAULT_GEMINI_MODEL. */
  model?: string;
  /**
   * Injectable fetch function. Defaults to the global `fetch`.
   * Pass a mock in tests to avoid real HTTP calls.
   */
  fetchFn?: FetchFn;
}

// ---------------------------------------------------------------------------
// Internal types — shape returned by Gemini
// ---------------------------------------------------------------------------

interface GeminiTranslationItem {
  id: string;
  translatedText: string;
  speakerGender?: 'female' | 'male' | string;
}

interface GeminiTranslationPayload {
  translations: GeminiTranslationItem[];
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiCandidate {
  finishReason?: string;
  content?: {
    parts?: GeminiPart[];
  };
}

interface GeminiApiResponse {
  candidates?: GeminiCandidate[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = DEFAULT_GEMINI_MODEL;
const FALLBACK_MODELS = GEMINI_FALLBACK_MODELS;
const DEFAULT_TARGET_LANGUAGE = 'vi';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_LISTED_MODEL_RETRIES = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeModel(model?: string): string {
  const trimmed = model?.trim();
  return trimmed || DEFAULT_MODEL;
}

async function readGeminiErrorMessage(response: Response): Promise<string | undefined> {
  if (typeof response.json !== 'function') return undefined;
  try {
    const data = (await response.json()) as { error?: { message?: string } };
    const message = data?.error?.message;
    return typeof message === 'string' && message.trim() ? message : undefined;
  } catch {
    return undefined;
  }
}

function toGeminiHttpError(status: number, apiMessage?: string): TranslationError {
  if (status === 429) {
    return new TranslationError(
      TranslationErrorCode.RATE_LIMITED,
      apiMessage
        ? `Gemini API rate limit exceeded (HTTP 429). ${apiMessage}`
        : 'Gemini API rate limit exceeded (HTTP 429). Please try again later.',
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new TranslationError(
      TranslationErrorCode.AUTH_ERROR,
      apiMessage
        ? `Gemini API authentication error (HTTP ${status}). ${apiMessage}`
        : `Gemini API authentication error (HTTP ${status}). Check your API key.`,
      status,
    );
  }
  return new TranslationError(
    TranslationErrorCode.NETWORK_ERROR,
    apiMessage
      ? `Gemini API returned unexpected status ${status}. ${apiMessage}`
      : `Gemini API returned unexpected status ${status}.`,
    status,
  );
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof TranslationError && err.httpStatus === 404;
}

function normalizeListedModelName(name: string): string {
  return name.replace(/^models\//, '').trim();
}

/**
 * Lowest supported thinking setting for the given Gemini model.
 * Gemini 3.8/3.7 Flash and Gemini 3 Pro reject `thinkingLevel: "minimal"`;
 * Gemini 2.5 uses `thinkingBudget: 0` to turn thinking off.
 */
function generationConfigForModel(model: string): {
  thinkingConfig: { thinkingLevel: 'low' | 'minimal' } | { thinkingBudget: number };
  responseMimeType: 'application/json';
  maxOutputTokens: number;
} {
  const id = model.toLowerCase();
  const thinkingConfig = id.includes('gemini-3')
    ? {
        thinkingLevel: (/gemini-3\.[78]/.test(id) || id.includes('pro')
          ? 'low'
          : 'minimal') as 'low' | 'minimal',
      }
    : { thinkingBudget: 0 };

  return {
    thinkingConfig,
    responseMimeType: 'application/json',
    maxOutputTokens: 16384,
  };
}

/** Skip thought drafts and join remaining text parts into the model answer. */
function extractGeminiAnswerText(body: GeminiApiResponse): string | undefined {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const answer = parts
    .filter((part) => !part.thought && typeof part.text === 'string' && part.text.length > 0)
    .map((part) => part.text as string)
    .join('');
  if (answer) return answer;

  const fallback = parts
    .filter((part) => typeof part.text === 'string' && part.text.length > 0)
    .map((part) => part.text as string)
    .join('');
  return fallback || undefined;
}

function isUsableListedFlashModel(name: string, methods: string[] | undefined): boolean {
  if (!name) return false;
  if (!methods?.includes('generateContent')) return false;
  const id = name.toLowerCase();
  if (!id.includes('flash')) return false;
  if (/(image|tts|live|audio|embedding|imagen|veo|lyria)/.test(id)) return false;
  return true;
}

/** Strip optional markdown code-block fences (```json ... ```) from text. */
function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

/** Build the system + user prompt for a batch translation request. */
function buildPrompt(segments: Segment[], targetLanguage: string): string {
  const segmentList = segments
    .map((s) => `{ "id": ${JSON.stringify(s.id)}, "sourceText": ${JSON.stringify(s.sourceText)} }`)
    .join(',\n  ');

  return `You are a professional translator and dialogue analyst. Translate the following dialogue segments into ${targetLanguage} and perform speaker diarization.

Rules:
- Translate naturally and conversationally.
- Preserve technical terminology, proper nouns, and brand names.
- Keep consistent pronouns throughout.
- Infer speaker gender ('female' or 'male') for each segment from conversational context, tone, and pronouns. Tag each segment with "speakerGender": "female" | "male".
- Preserve the segment "id" field exactly as given.
- Return ONLY a valid JSON object with this exact shape:
  { "translations": [ { "id": "<id>", "translatedText": "<translation>", "speakerGender": "female" | "male" }, ... ] }
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
 * Strategy: ADR-0003 (full upfront batch translation with a Gemini Flash model).
 */
export class GeminiTranslationClient implements TranslationClient {
  private readonly apiKey: string | undefined;
  readonly model: string;
  private readonly fetchFn: FetchFn;

  constructor(options: GeminiTranslationClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = sanitizeModel(options.model);
    this.fetchFn = options.fetchFn ?? defaultFetch;
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
    const rawText = await this.callGeminiApi(apiKey.trim(), prompt);
    const payload = this.parseGeminiResponse(rawText);

    // Map by segment id for O(1) lookup
    const resultMap = new Map<string, GeminiTranslationItem>(
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
    const tried = new Set<string>();
    const candidates = [
      this.model,
      ...FALLBACK_MODELS.filter((model) => model !== this.model),
    ];

    let lastError: unknown;
    for (const model of candidates) {
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        return await this.requestGenerateContent(apiKey, model, prompt);
      } catch (err) {
        lastError = err;
        if (!isNotFoundError(err)) throw err;
      }
    }

    const listed = await this.listGenerateContentFlashModels(apiKey);
    let listedAttempts = 0;
    for (const model of listed) {
      if (tried.has(model)) continue;
      tried.add(model);
      listedAttempts += 1;
      try {
        return await this.requestGenerateContent(apiKey, model, prompt);
      } catch (err) {
        lastError = err;
        if (!isNotFoundError(err)) throw err;
      }
      if (listedAttempts >= MAX_LISTED_MODEL_RETRIES) break;
    }

    throw lastError;
  }

  private async listGenerateContentFlashModels(apiKey: string): Promise<string[]> {
    const url = `${GEMINI_API_BASE}?key=${encodeURIComponent(apiKey)}`;
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };
      return (body.models ?? [])
        .map((model) => ({
          name: normalizeListedModelName(model.name ?? ''),
          methods: model.supportedGenerationMethods,
        }))
        .filter((model) => isUsableListedFlashModel(model.name, model.methods))
        .map((model) => model.name);
    } catch {
      return [];
    }
  }

  private async requestGenerateContent(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: generationConfigForModel(model),
        }),
      });
    } catch (err) {
      throw new TranslationError(
        TranslationErrorCode.NETWORK_ERROR,
        `Network error while calling Gemini API: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const apiMessage = await readGeminiErrorMessage(response);
      throw toGeminiHttpError(response.status, apiMessage);
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

    const text = extractGeminiAnswerText(body);

    if (!text) {
      const finishReason = body.candidates?.[0]?.finishReason;
      throw new TranslationError(
        TranslationErrorCode.INVALID_RESPONSE,
        finishReason
          ? `Gemini API returned an empty or malformed response (no candidates, finishReason=${finishReason}).`
          : 'Gemini API returned an empty or malformed response (no candidates).',
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
