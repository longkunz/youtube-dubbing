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
  pingGeminiConnection,
  DEFAULT_USER_SETTINGS,
} from './settings';
export type { UserSettings } from './settings';

