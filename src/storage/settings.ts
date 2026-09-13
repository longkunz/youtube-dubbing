/**
 * User Settings Storage & Backend Connectivity Ping
 *
 * Manages Self-hosted Backend preferences and network verification
 * with dual persistence (chrome.storage.local with in-memory test fallback).
 * Strictly Self-hosted Backend-Only (ADR-0013).
 *
 * @module storage/settings
 */

import { defaultFetch } from '../core/default-fetch';

export type TranslationProvider = 'self-hosted';

export type TtsProvider = 'zerotts' | 'piper' | 'edge';

export type SubtitleDisplayMode = 'bilingual' | 'translated-only' | 'original-only';
export type SubtitleLineOrder = 'translated-first' | 'original-first';
export type SubtitleFontSize = 'small' | 'standard' | 'large';

export interface SubtitlePosition {
  xPercent: number;
  yPercent: number;
}

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<any>;

export interface UserSettings {
  translationProvider: TranslationProvider;
  /** BCP-47 target language for the Dub Track (cockpit selector). Locked to 'vi'. */
  targetLanguage: string;
  ttsPitch?: string;
  ttsRate?: string;
  ttsProvider: TtsProvider;
  backendUrl: string;
  backendApiKey: string;
  subtitleDisplayMode: SubtitleDisplayMode;
  subtitleLineOrder: SubtitleLineOrder;
  subtitleFontSize: SubtitleFontSize;
  subtitlePosition?: SubtitlePosition | null;
  subtitleOriginalFontSize: number;
  subtitleTranslatedFontSize: number;
  subtitleOriginalColor: string;
  subtitleTranslatedColor: string;
  subtitleBackgroundOpacity: number;
  subtitleTextShadow: boolean;
  subtitleAutoPause: boolean;
  subtitleHotkeysEnabled: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  translationProvider: 'self-hosted',
  targetLanguage: 'vi',
  ttsPitch: '+0Hz',
  ttsRate: '+0%',
  ttsProvider: 'zerotts',
  backendUrl: 'http://127.0.0.1:8787',
  backendApiKey: '',
  subtitleDisplayMode: 'bilingual',
  subtitleLineOrder: 'original-first',
  subtitleFontSize: 'standard',
  subtitlePosition: null,
  subtitleOriginalFontSize: 18,
  subtitleTranslatedFontSize: 15,
  subtitleOriginalColor: '#ffffff',
  subtitleTranslatedColor: '#00f2fe',
  subtitleBackgroundOpacity: 78,
  subtitleTextShadow: true,
  subtitleAutoPause: false,
  subtitleHotkeysEnabled: false,
};

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export function normalizeSettings(input: Partial<UserSettings> | undefined): UserSettings {
  const merged: UserSettings = { ...DEFAULT_USER_SETTINGS, ...(input ?? {}) };
  merged.translationProvider = 'self-hosted';
  merged.targetLanguage = 'vi';
  const rawTts = (input as { ttsProvider?: string } | undefined)?.ttsProvider;
  if (rawTts === 'edge-tts') {
    merged.ttsProvider = 'edge';
  } else if (rawTts === 'backend') {
    merged.ttsProvider = 'piper';
  } else if (rawTts === 'web-speech') {
    merged.ttsProvider = 'zerotts';
  } else if (!merged.ttsProvider) {
    merged.ttsProvider = 'zerotts';
  }
  if (!merged.subtitleDisplayMode) {
    merged.subtitleDisplayMode = 'bilingual';
  }
  if (!merged.subtitleLineOrder) {
    merged.subtitleLineOrder = 'original-first';
  }
  if (!merged.subtitleFontSize) {
    merged.subtitleFontSize = 'standard';
  }
  if (input && 'subtitlePosition' in input) {
    if (input.subtitlePosition === null) {
      merged.subtitlePosition = null;
    } else if (
      input.subtitlePosition &&
      typeof input.subtitlePosition.xPercent === 'number' &&
      typeof input.subtitlePosition.yPercent === 'number'
    ) {
      merged.subtitlePosition = {
        xPercent: Math.max(0, Math.min(100, input.subtitlePosition.xPercent)),
        yPercent: Math.max(0, Math.min(100, input.subtitlePosition.yPercent)),
      };
    } else {
      merged.subtitlePosition = null;
    }
  } else if (merged.subtitlePosition) {
    merged.subtitlePosition = {
      xPercent: Math.max(0, Math.min(100, merged.subtitlePosition.xPercent)),
      yPercent: Math.max(0, Math.min(100, merged.subtitlePosition.yPercent)),
    };
  } else {
    merged.subtitlePosition = null;
  }

  // Numeric clamping
  if (typeof input?.subtitleOriginalFontSize === 'number' && !Number.isNaN(input.subtitleOriginalFontSize)) {
    merged.subtitleOriginalFontSize = Math.max(12, Math.min(36, Math.round(input.subtitleOriginalFontSize)));
  } else if (typeof merged.subtitleOriginalFontSize === 'number' && !Number.isNaN(merged.subtitleOriginalFontSize)) {
    merged.subtitleOriginalFontSize = Math.max(12, Math.min(36, Math.round(merged.subtitleOriginalFontSize)));
  } else {
    merged.subtitleOriginalFontSize = 18;
  }

  if (typeof input?.subtitleTranslatedFontSize === 'number' && !Number.isNaN(input.subtitleTranslatedFontSize)) {
    merged.subtitleTranslatedFontSize = Math.max(10, Math.min(30, Math.round(input.subtitleTranslatedFontSize)));
  } else if (typeof merged.subtitleTranslatedFontSize === 'number' && !Number.isNaN(merged.subtitleTranslatedFontSize)) {
    merged.subtitleTranslatedFontSize = Math.max(10, Math.min(30, Math.round(merged.subtitleTranslatedFontSize)));
  } else {
    merged.subtitleTranslatedFontSize = 15;
  }

  if (typeof input?.subtitleBackgroundOpacity === 'number' && !Number.isNaN(input.subtitleBackgroundOpacity)) {
    merged.subtitleBackgroundOpacity = Math.max(0, Math.min(100, Math.round(input.subtitleBackgroundOpacity)));
  } else if (typeof merged.subtitleBackgroundOpacity === 'number' && !Number.isNaN(merged.subtitleBackgroundOpacity)) {
    merged.subtitleBackgroundOpacity = Math.max(0, Math.min(100, Math.round(merged.subtitleBackgroundOpacity)));
  } else {
    merged.subtitleBackgroundOpacity = 78;
  }

  // Color validation
  if (typeof input?.subtitleOriginalColor === 'string' && HEX_COLOR_REGEX.test(input.subtitleOriginalColor)) {
    merged.subtitleOriginalColor = input.subtitleOriginalColor.toLowerCase();
  } else if (typeof merged.subtitleOriginalColor === 'string' && HEX_COLOR_REGEX.test(merged.subtitleOriginalColor)) {
    merged.subtitleOriginalColor = merged.subtitleOriginalColor.toLowerCase();
  } else {
    merged.subtitleOriginalColor = '#ffffff';
  }

  if (typeof input?.subtitleTranslatedColor === 'string' && HEX_COLOR_REGEX.test(input.subtitleTranslatedColor)) {
    merged.subtitleTranslatedColor = input.subtitleTranslatedColor.toLowerCase();
  } else if (typeof merged.subtitleTranslatedColor === 'string' && HEX_COLOR_REGEX.test(merged.subtitleTranslatedColor)) {
    merged.subtitleTranslatedColor = merged.subtitleTranslatedColor.toLowerCase();
  } else {
    merged.subtitleTranslatedColor = '#00f2fe';
  }

  // Boolean flags
  if (input && typeof input.subtitleTextShadow === 'boolean') {
    merged.subtitleTextShadow = input.subtitleTextShadow;
  } else if (typeof merged.subtitleTextShadow !== 'boolean') {
    merged.subtitleTextShadow = true;
  }

  if (input && typeof input.subtitleAutoPause === 'boolean') {
    merged.subtitleAutoPause = input.subtitleAutoPause;
  } else if (typeof merged.subtitleAutoPause !== 'boolean') {
    merged.subtitleAutoPause = false;
  }

  if (input && typeof input.subtitleHotkeysEnabled === 'boolean') {
    merged.subtitleHotkeysEnabled = input.subtitleHotkeysEnabled;
  } else if (typeof merged.subtitleHotkeysEnabled !== 'boolean') {
    merged.subtitleHotkeysEnabled = false;
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
        const normalized = normalizeSettings(
          chrome.runtime?.lastError || !stored ? undefined : stored
        );
        inMemorySettings = { ...normalized };
        resolve(normalized);
      });
    });
  }

  return normalizeSettings(inMemorySettings);
}

export type SettingsListener = (settings: UserSettings) => void;
const settingsListeners = new Set<SettingsListener>();

/**
 * Subscribe to settings changes. Returns an unsubscribe function.
 */
export function subscribeToSettings(listener: SettingsListener): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

let saveQueue: Promise<void> = Promise.resolve();

/**
 * Persist partial or full user settings to chrome.storage.local
 * and update in-memory state. Concurrent calls within the same realm
 * are serialized so rapid UI events do not race each other.
 */
export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const runSave = async () => {
    const current = await getSettings();
    const updated: UserSettings = normalizeSettings({
      ...current,
      ...settings,
    });

    inMemorySettings = { ...updated };

    for (const listener of settingsListeners) {
      try {
        listener(updated);
      } catch (e) {
        console.error('[AetherDub] Error in settings listener:', e);
      }
    }

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
  };

  saveQueue = saveQueue.then(runSave, runSave);
  return saveQueue;
}

/**
 * Reset all stored settings back to default.
 * Intended for test isolation.
 */
export async function resetSettingsForTesting(): Promise<void> {
  saveQueue = Promise.resolve();
  inMemorySettings = { ...DEFAULT_USER_SETTINGS };

  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.clear(() => {
        resolve();
      });
    });
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