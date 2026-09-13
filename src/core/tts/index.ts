/**
 * Speech Synthesis public seam.
 * Strictly routes TTS synthesis to Self-hosted Backend (ZeroTTS CPU) per ADR-0013.
 */

export { DEFAULT_MAI_CHI_VOICE, DEFAULT_HOAI_MY_VOICE, DEFAULT_NAM_MINH_VOICE } from './voices';
export { BackgroundDubbingTtsClient } from './background-tts-client';
export { createBackendTtsRouter } from './backend-tts-router';
export type {
  BackendTtsRouter,
  BackendTtsRouterOptions,
  BackendTtsRouterSettings,
  SynthesizeTtsResult,
  BackendTtsSuccess,
  BackendTtsFailure,
  BackendTtsErrorCode,
} from './backend-tts-router';
export { playAudioBlob, TTS_PREVIEW_TEXT } from './tts-preview';
export type { PreviewAudio, PreviewPlayback } from './tts-preview';
