/**
 * Whisper STT fallback seam.
 *
 * Used only when YouTube caption fetch fails. Requires a Groq API key
 * (BYOK) and an unsigned audio URL from playerResponse.streamingData.
 * Ciphered googlevideo URLs and other video platforms are out of scope.
 */

export { GroqWhisperClient } from './groq-whisper-client';
export type { GroqWhisperClientOptions } from './groq-whisper-client';
export { extractUnsignedAudioUrl, whisperSegmentsToDomain } from './audio-stream';
export type { WhisperVerboseSegment } from './audio-stream';
