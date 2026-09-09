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

export { WebSpeechFallback, ResilientTtsClient } from './web-speech-fallback';
export type { ResilientTtsClientOptions } from './web-speech-fallback';

export { BackgroundDubbingTtsClient } from './background-tts-client';

export {
  EDGE_TTS_TRUSTED_CLIENT_TOKEN,
  SEC_MS_GEC_VERSION,
  EDGE_TTS_WS_BASE_URL,
  buildSecMsGecInput,
  generateSecMsGec,
  buildEdgeTtsWsUrl,
} from './sec-ms-gec';

export { playAudioBlob, TTS_PREVIEW_TEXT } from './tts-preview';
export type { PreviewAudio, PreviewPlayback } from './tts-preview';


