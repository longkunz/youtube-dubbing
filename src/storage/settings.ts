/**
 * User Settings Storage & Gemini Connectivity Ping
 *
 * Manages API keys, TTS preferences, and network verification
 * with dual persistence (chrome.storage.local with in-memory test fallback).
 *
 * @module storage/settings
 */

import { defaultFetch } from '../core/default-fetch';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const GEMINI_MODEL_PRESETS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
] as const;

/** 404 fallback chain after the user-selected Gemini model. */
export const GEMINI_FALLBACK_MODELS = [
  ...GEMINI_MODEL_PRESETS,
  'gemini-flash-latest',
] as const;

export type TranslationProvider =
  | 'self-hosted'
  | 'gemini'
  | 'openai-compatible'
  | 'youtube-caption-translation';

export const YOUTUBE_CAPTION_TRANSLATION = 'youtube-caption-translation' as const;

export type TtsProvider = 'backend' | 'web-speech';

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<any>;

export interface UserSettings {
  translationProvider: TranslationProvider;
  geminiApiKey: string;
  geminiModel: string;
  openaiEndpoint: string;
  openaiModel: string;
  openaiApiKey: string;
  groqApiKey: string;
  /** BCP-47 target language for the Dub Track (cockpit selector). */
  targetLanguage: string;
  ttsPitch?: string;
  ttsRate?: string;
  ttsProvider: TtsProvider;
  enableFallback: boolean;
  backendUrl: string;
  backendApiKey: string;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  translationProvider: 'self-hosted',
  geminiApiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  openaiEndpoint: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  openaiApiKey: '',
  groqApiKey: '',
  targetLanguage: 'vi',
  ttsPitch: '+0Hz',
  ttsRate: '+0%',
  ttsProvider: 'backend',
  enableFallback: true,
  backendUrl: 'http://127.0.0.1:8787',
  backendApiKey: '',
};

export function normalizeSettings(input: Partial<UserSettings> | undefined): UserSettings {
  const merged: UserSettings = { ...DEFAULT_USER_SETTINGS, ...(input ?? {}) };
  if ((input as { ttsProvider?: string } | undefined)?.ttsProvider === 'edge-tts') {
    merged.ttsProvider = 'backend';
  }
  return merged;
}

let inMemorySettings: UserSettings = { ...DEFAULT_USER_SETTINGS };

/**
 * Retrieve current user settings from chrome.storage.local,
 * falling back to in-memory state in unit test environments.
 */
export async function getSettings(): Promise<UserSettings> {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    return new Promise<UserSettings>((resolve) => {
      chrome.storage.local.get('userSettings', (items: Record<string, unknown>) => {
        const stored = items?.userSettings as Partial<UserSettings> | undefined;
        if (chrome.runtime?.lastError || !stored) {
          resolve(normalizeSettings(stored ?? undefined));
        } else {
          resolve(normalizeSettings(stored));
        }
      });

    });
  }

  return normalizeSettings(inMemorySettings);
}

/**
 * Persist partial or full user settings to chrome.storage.local
 * and update in-memory state.
 */
export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  const updated: UserSettings = normalizeSettings({
    ...current,
    ...settings,
  });

  inMemorySettings = { ...updated };

  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set(
        { userSettings: updated as unknown as Record<string, unknown> },
        () => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message ?? 'Failed to save settings'));
          } else {
            resolve();
          }
        }
      );

    });
  }
}

/**
 * Reset all stored settings back to default.
 * Intended for test isolation.
 */
export async function resetSettingsForTesting(): Promise<void> {
  inMemorySettings = { ...DEFAULT_USER_SETTINGS };

  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.clear(() => {
        resolve();
      });
    });
  }
}

/**
 * Ping Gemini API endpoint to verify connectivity and API key validity.
 *
 * @param apiKey - Gemini API Key to test
 * @param fetchFn - Optional custom fetch implementation (useful for mocking)
 * @returns Object with ok status, round-trip latency in ms, and optional error message
 */
export async function pingGeminiConnection(
  apiKey: string,
  fetchFn: typeof fetch = defaultFetch as typeof fetch,
  model: string = DEFAULT_GEMINI_MODEL,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      latencyMs: 0,
      error: 'API key is required',
    };
  }

  const startTime = performance.now();
  const trimmedModel = model.trim() || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(trimmedModel)}?key=${encodeURIComponent(apiKey.trim())}`;

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = (await response.json()) as { error?: { message?: string } };
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Fallback to HTTP status text
      }

      return {
        ok: false,
        latencyMs,
        error: errorMessage,
      };
    }

    return {
      ok: true,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      ok: false,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface PingBackendResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  tts?: string;
}

/**
 * Ping the Self-hosted Backend: GET /v1/health then a one-cue
 * POST /v1/translate to verify the Bearer key is accepted.
 */
export async function pingBackendConnection(
  url: string,
  apiKey: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<PingBackendResult> {
  const base = url.replace(/\/+$/, '');
  const started = Date.now();
  try {
    const healthRes = await fetchFn(`${base}/v1/health`);
    if (!healthRes.ok) {
      return { ok: false, error: `health HTTP ${healthRes.status}` };
    }
    const health = await healthRes.json();
    const translateRes = await fetchFn(`${base}/v1/translate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source: 'en', target: 'vi', cues: [{ id: 'ping', text: 'ok' }] }),
    });
    if (!translateRes.ok) {
      return { ok: false, latencyMs: Date.now() - started, error: `translate HTTP ${translateRes.status}`, tts: health.tts };
    }
    return { ok: true, latencyMs: Date.now() - started, tts: health.tts };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PingOpenAiResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Normalizes OpenAI-compatible endpoint URL, ensuring it points to /chat/completions.
 */
export function normalizeEndpoint(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

/**
 * Ping OpenAI-compatible API endpoint to verify connectivity, model existence, and optional API key.
 *
 * @param endpoint - Proxy or OpenAI endpoint base URL
 * @param model - Model identifier (e.g. gpt-4o-mini, llama3)
 * @param apiKey - Optional API key for authenticated proxies
 * @param fetchFn - Optional custom fetch implementation (useful for mocking)
 * @returns Object with ok status, round-trip latency in ms, and optional error message
 */
export async function pingOpenAiConnection(
  endpoint: string,
  model: string,
  apiKey?: string,
  fetchFn: (input: string | URL | Request, init?: RequestInit) => Promise<any> = defaultFetch,
): Promise<PingOpenAiResult> {
  if (!endpoint || !endpoint.trim()) {
    return {
      ok: false,
      latencyMs: 0,
      error: 'Proxy endpoint URL is required',
    };
  }
  if (!model || !model.trim()) {
    return {
      ok: false,
      latencyMs: 0,
      error: 'Model identifier is required',
    };
  }

  const normalizedUrl = normalizeEndpoint(endpoint);
  const startTime = performance.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  try {
    const response = await fetchFn(normalizedUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model.trim(),
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5,
        stream: false,
        reasoning_effort: 'none',
        reasoning: { effort: 'none' },
      }),
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = (await response.json()) as { error?: { message?: string } };
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Fallback to HTTP status text
      }
      return {
        ok: false,
        latencyMs,
        error: errorMessage,
      };
    }

    return {
      ok: true,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      ok: false,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}