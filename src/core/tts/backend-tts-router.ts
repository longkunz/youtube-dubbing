/**
 * BackendTtsRouter
 *
 * Routes TTS synthesis to the Self-hosted Backend (`POST {backendUrl}/v1/tts`)
 * from the MV3 service worker. Never opens a Bing WebSocket from Chrome.
 *
 * Session breaker: 3 consecutive HTTP/network failures stop further fetches
 * until `resetBreaker()` (successful Ping or explicit reset). While open,
 * synthesize responds `BACKEND_TTS_UNAVAILABLE` so the orchestrator skips
 * the cue instead of stacking voices. When `ttsProvider` is `web-speech`,
 * no fetch is made and `WEB_SPEECH_REQUIRED` is returned so the content
 * script can speak via `WebSpeechFallback` without feeding a dummy blob
 * into the Playback Sync Engine.
 */

import type { VoiceProfile } from '../../types/domain';
import { defaultFetch } from '../default-fetch';
import { arrayBufferToBase64 } from './base64';

export type BackendTtsErrorCode = 'WEB_SPEECH_REQUIRED' | 'BACKEND_TTS_UNAVAILABLE';

export interface BackendTtsSuccess {
  success: true;
  audioBase64: string;
  mimeType: string;
}

export interface BackendTtsFailure {
  success: false;
  code: BackendTtsErrorCode;
  error: string;
}

export type SynthesizeTtsResult = BackendTtsSuccess | BackendTtsFailure;

export interface BackendTtsRouterSettings {
  backendUrl: string;
  backendApiKey: string;
  ttsProvider: string;
}

export interface BackendTtsRouterOptions {
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<any>;
  getSettings: () => Promise<BackendTtsRouterSettings>;
  fetchTimeoutMs?: number;
}

const BACKEND_TTS_FETCH_TIMEOUT_MS = 8_000;
const BREAKER_FAILURE_THRESHOLD = 3;

export interface BackendTtsRouter {
  synthesize(text: string, voice: VoiceProfile): Promise<SynthesizeTtsResult>;
  resetBreaker(): void;
}

export function createBackendTtsRouter(options: BackendTtsRouterOptions): BackendTtsRouter {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? BACKEND_TTS_FETCH_TIMEOUT_MS;
  let consecutiveFailures = 0;

  function fail(error: string): BackendTtsFailure {
    consecutiveFailures += 1;
    return { success: false, code: 'BACKEND_TTS_UNAVAILABLE', error };
  }

  return {
    resetBreaker(): void {
      consecutiveFailures = 0;
    },

    async synthesize(text: string, voice: VoiceProfile): Promise<SynthesizeTtsResult> {
      const settings = await options.getSettings();
      if (settings.ttsProvider === 'web-speech') {
        return {
          success: false,
          code: 'WEB_SPEECH_REQUIRED',
          error: 'Web Speech TTS selected; synthesize in page',
        };
      }

      if (consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
        return {
          success: false,
          code: 'BACKEND_TTS_UNAVAILABLE',
          error: 'Backend TTS breaker open after 3 consecutive failures',
        };
      }

      const base = (settings.backendUrl || 'http://127.0.0.1:8787').replace(/\/+$/, '');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);
      try {
        const response = await fetchFn(`${base}/v1/tts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.backendApiKey ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: text.length > 500 ? text.slice(0, 500) : text,
            lang: voice.locale ?? 'vi-VN',
            voice: voice.voiceKey ?? voice.id,
            rate: voice.rate ?? '+0%',
            format: 'mp3',
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          return fail(`Backend TTS failed: HTTP ${response.status}`);
        }
        const buffer: ArrayBuffer = await response.arrayBuffer();
        if (!buffer || buffer.byteLength === 0) {
          return fail('Backend TTS returned empty audio');
        }
        const mimeType =
          typeof response.headers?.get === 'function'
            ? (response.headers.get('content-type') ?? 'audio/mpeg')
            : 'audio/mpeg';
        consecutiveFailures = 0;
        return { success: true, audioBase64: arrayBufferToBase64(buffer), mimeType };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(message || 'Backend TTS request failed');
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
