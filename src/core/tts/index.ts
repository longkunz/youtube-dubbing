/**
 * Edge TTS public seam.
 *
 * Provides WebSocket-based Microsoft Edge Neural TTS synthesis running
 * entirely client-side inside the Background Service Worker.
 *
 * ADR-0003: Upfront batch translation with sliding window TTS
 */

export { EdgeTtsClient } from './edge-tts-client';
export type {
  EdgeTtsClientOptions,
  SynthesizeOptions,
  WebSocketLike,
} from './edge-tts-client';

export { EdgeTtsError, EdgeTtsErrorCode } from './errors';

export { DEFAULT_HOAI_MY_VOICE, DEFAULT_NAM_MINH_VOICE } from './voices';
