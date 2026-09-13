/**
 * Storage layer — persistent IndexedDB cache for translated transcripts
 * and synthesized audio blobs.
 *
 * @module storage
 */
export { SegmentCache } from './segment-cache';
export type { StorageUsageStats, CachedAudioSegment, SegmentCacheOptions } from './segment-cache';
export {
  getSettings,
  saveSettings,
  resetSettingsForTesting,
  pingBackendConnection,
  DEFAULT_USER_SETTINGS,
} from './settings';
export type {
  UserSettings,
  TranslationProvider,
  TtsProvider,
  SubtitleDisplayMode,
  SubtitleLineOrder,
  SubtitleFontSize,
  PingBackendResult,
} from './settings';
