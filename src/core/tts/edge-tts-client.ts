/**
 * EdgeTtsClient — Microsoft Edge Neural TTS streaming client.
 *
 * Establishes a WebSocket connection to the Edge TTS endpoint, sends SSML
 * synthesis requests, parses incoming binary audio frames (2-byte big-endian
 * header length framing), and assembles them into a single audio/mpeg Blob.
 *
 * ADR-0002: Volume Lerp for Audio Ducking (no CORS issues; pure client-side)
 * Design: Injectable `webSocketFactory` seam for pure unit testability.
 */

import type { VoiceProfile } from '../../types/domain';
import { EdgeTtsError, EdgeTtsErrorCode } from './errors';
import { WebSpeechFallback } from './web-speech-fallback';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDGE_TTS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readahead/edge/v1' +
  '?trustedclienttoken=6A5AA1D4EA654B9D8325B2C1EB673970' +
  '&ConnectionId=';

const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal WebSocket-like interface — injectable for testability.
 */
export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string | ArrayBuffer | Blob): void;
  close(): void;
}

/**
 * Options for EdgeTtsClient constructor.
 */
export interface EdgeTtsClientOptions {
  /** Injectable WebSocket factory for pure unit testing without real network. */
  webSocketFactory?: (url: string) => WebSocketLike;
  /** Base retry delay in ms (for exponential backoff). Default: 200ms. */
  retryDelayMs?: number;
  /** Whether to fall back to Web Speech API when retries are exhausted. */
  enableFallback?: boolean;
  /** Optional fallback WebSpeechFallback adapter instance. */
  fallback?: WebSpeechFallback;
}


/**
 * Per-call synthesis options.
 */
export interface SynthesizeOptions {
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a UUID v4 (RFC 4122). */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Escape XML special characters in text content. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parse a binary Edge TTS audio frame.
 * Frame format: [2-byte big-endian header length][UTF-8 header][binary audio payload]
 *
 * Returns the audio payload bytes if the header Path is "audio", otherwise null.
 */
function parseAudioFrame(buffer: ArrayBuffer): Uint8Array<ArrayBuffer> | null {
  if (buffer.byteLength < 2) return null;

  const view = new DataView(buffer);
  const headerLen = view.getUint16(0, false); // big-endian

  if (buffer.byteLength < 2 + headerLen) return null;

  const headerBytes = new Uint8Array(buffer, 2, headerLen);
  const header = new TextDecoder().decode(headerBytes);

  // Only process audio frames
  if (!/(^|\r\n)Path:audio(\r\n|$)/.test(header)) return null;

  const payloadStart = 2 + headerLen;
  const payloadLen = buffer.byteLength - payloadStart;
  if (payloadLen <= 0) return null;

  // Copy into a fresh ArrayBuffer so the result is Uint8Array<ArrayBuffer>
  // (satisfies BlobPart[] without SharedArrayBuffer ambiguity).
  const payload = new Uint8Array(payloadLen);
  payload.set(new Uint8Array(buffer, payloadStart, payloadLen));
  return payload;
}

/**
 * Build the synthesis SSML request message sent over the WebSocket.
 */
function buildSynthesisMessage(requestId: string, ssml: string): string {
  const timestamp = new Date().toISOString();
  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp}\r\n` +
    `Path:ssml\r\n\r\n` +
    ssml
  );
}

/**
 * Build the initial config message sent right after WS open.
 */
function buildConfigMessage(requestId: string): string {
  const timestamp = new Date().toISOString();
  const config = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        },
      },
    },
  });
  return (
    `X-Timestamp:${timestamp}\r\n` +
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    config
  );
}

// ---------------------------------------------------------------------------
// EdgeTtsClient
// ---------------------------------------------------------------------------

/**
 * Microsoft Edge Neural TTS streaming client.
 *
 * Usage:
 * ```ts
 * const client = new EdgeTtsClient();
 * const blob = await client.synthesize('Xin chào', DEFAULT_HOAI_MY_VOICE);
 * ```
 */
export class EdgeTtsClient {
  private readonly wsFactory: (url: string) => WebSocketLike;
  private readonly retryDelayMs: number;
  private readonly enableFallback: boolean;
  private readonly fallback?: WebSpeechFallback;

  constructor(options: EdgeTtsClientOptions = {}) {
    this.wsFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.retryDelayMs = options.retryDelayMs ?? 200;
    this.enableFallback = options.enableFallback ?? false;
    this.fallback = options.fallback;
  }


  /**
   * Format SSML markup for the given text and voice profile.
   *
   * Escapes XML special characters in the text content.
   * Defaults pitch to '+0Hz' and rate to '+0%' when not provided.
   */
  formatSsml(text: string, voice: VoiceProfile): string {
    const pitch = voice.pitch ?? '+0Hz';
    const rate = voice.rate ?? '+0%';
    const escapedText = escapeXml(text);

    return (
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${voice.locale}'>` +
      `<voice name='${voice.voiceKey}'>` +
      `<prosody pitch='${pitch}' rate='${rate}'>` +
      escapedText +
      `</prosody>` +
      `</voice>` +
      `</speak>`
    );
  }

  /**
   * Synthesize text to speech using the given voice profile.
   *
   * Retries up to MAX_RETRIES times with exponential backoff on transient errors.
   *
   * @returns A Blob of type 'audio/mpeg' containing the synthesized audio.
   */
  async synthesize(
    text: string,
    voice: VoiceProfile,
    options?: SynthesizeOptions
  ): Promise<Blob> {
    if (options?.signal?.aborted) {
      throw new EdgeTtsError(
        EdgeTtsErrorCode.CONNECTION_CLOSED,
        'Synthesis was aborted by caller'
      );
    }

    const ssml = this.formatSsml(text, voice);
    let lastError: EdgeTtsError | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (options?.signal?.aborted) {
        throw new EdgeTtsError(
          EdgeTtsErrorCode.CONNECTION_CLOSED,
          'Synthesis was aborted by caller'
        );
      }

      if (attempt > 0) {
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const blob = await this._attemptSynthesize(ssml, options?.signal);
        return blob;
      } catch (err) {
        if (err instanceof EdgeTtsError) {
          // For CONNECTION_CLOSED and NETWORK_ERROR — retry
          if (
            err.code === EdgeTtsErrorCode.NETWORK_ERROR ||
            err.code === EdgeTtsErrorCode.CONNECTION_CLOSED
          ) {
            lastError = err;
            continue;
          }
        }
        throw err;
      }
    }

    if (this.enableFallback) {
      const fallback = this.fallback ?? new WebSpeechFallback();
      if (fallback.isSupported()) {
        await fallback.speak(text, voice);
        return new Blob(['web-speech-audio'], { type: 'audio/mpeg' });
      }
    }

    throw new EdgeTtsError(
      EdgeTtsErrorCode.MAX_RETRIES_EXCEEDED,
      `Edge TTS synthesis failed after ${MAX_RETRIES} retries. Last error: ${lastError?.message ?? 'unknown'}`
    );
  }


  /**
   * Single synthesis attempt over one WebSocket connection.
   */
  private _attemptSynthesize(ssml: string, signal?: AbortSignal): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      const requestId = uuid().replace(/-/g, '');
      const url = EDGE_TTS_URL + requestId;
      const ws = this.wsFactory(url);
      const audioChunks: Uint8Array<ArrayBuffer>[] = [];
      let settled = false;

      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        ws.close();
        action();
      };

      if (signal) {
        const onAbort = () => {
          settle(() =>
            reject(
              new EdgeTtsError(
                EdgeTtsErrorCode.CONNECTION_CLOSED,
                'Synthesis was aborted by caller'
              )
            )
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      ws.onopen = () => {
        ws.send(buildConfigMessage(requestId));
        ws.send(buildSynthesisMessage(requestId, ssml));
      };

      ws.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const chunk = parseAudioFrame(event.data);
          if (chunk) audioChunks.push(chunk);
        } else if (typeof event.data === 'string') {
          if (event.data.includes('Path:turn.end')) {
            settle(() => resolve(new Blob(audioChunks, { type: 'audio/mpeg' })));
          } else if (event.data.includes('Path:error')) {
            settle(() =>
              reject(
                new EdgeTtsError(
                  EdgeTtsErrorCode.SYNTHESIS_FAILED,
                  `Edge TTS server returned synthesis error: ${event.data}`
                )
              )
            );
          }
        }
      };

      ws.onerror = () => {
        settle(() =>
          reject(
            new EdgeTtsError(EdgeTtsErrorCode.NETWORK_ERROR, 'WebSocket error during Edge TTS synthesis')
          )
        );
      };

      ws.onclose = (event: CloseEvent) => {
        if (!settled) {
          settle(() =>
            reject(
              new EdgeTtsError(
                EdgeTtsErrorCode.CONNECTION_CLOSED,
                `WebSocket closed before synthesis completed (code=${event.code}, reason=${event.reason})`
              )
            )
          );
        }
      };
    });
  }
}
