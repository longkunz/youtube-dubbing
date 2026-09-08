/**
 * User Settings Storage & Gemini Connectivity Ping
 *
 * Manages API keys, TTS preferences, and network verification
 * with dual persistence (chrome.storage.local with in-memory test fallback).
 *
 * @module storage/settings
 */

export interface UserSettings {
  geminiApiKey: string;
  groqApiKey: string;
  openaiApiKey?: string;
  ttsPitch?: string;
  ttsRate?: string;
  ttsProvider: 'edge-tts' | 'web-speech';
  enableFallback: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  geminiApiKey: '',
  groqApiKey: '',
  openaiApiKey: '',
  ttsPitch: '+0Hz',
  ttsRate: '+0%',
  ttsProvider: 'edge-tts',
  enableFallback: true,
};

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
          resolve({ ...DEFAULT_USER_SETTINGS, ...(stored ?? {}) });
        } else {
          resolve({ ...DEFAULT_USER_SETTINGS, ...stored });
        }
      });

    });
  }

  return { ...inMemorySettings };
}

/**
 * Persist partial or full user settings to chrome.storage.local
 * and update in-memory state.
 */
export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  const updated: UserSettings = {
    ...current,
    ...settings,
  };

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
  fetchFn: typeof fetch = globalThis.fetch
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      latencyMs: 0,
      error: 'API key is required',
    };
  }

  const startTime = performance.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`;

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