import { openDB, type IDBPDatabase } from 'idb';
import type { Transcript } from '../types/domain';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface StorageUsageStats {
  totalBytes: number;
  transcriptCount: number;
  audioSegmentCount: number;
  videoCount?: number;
}

/**
 * Public shape of a cached audio segment entry.
 * Consumers always receive a reconstructed `Blob`.
 */
export interface CachedAudioSegment {
  /** Composite key: `${videoId}_${language}_${voiceId}_${segmentId}` */
  key: string;
  videoId: string;
  language: string;
  voiceId: string;
  segmentId: string;
  audioBlob: Blob;
  byteSize: number;
}

export interface SegmentCacheOptions {
  /** IndexedDB database name. Defaults to `'segment-cache'`. */
  dbName?: string;
  /** IndexedDB version. Defaults to `1`. */
  version?: number;
}

// ---------------------------------------------------------------------------
// Internal DB Schema
// ---------------------------------------------------------------------------

const TRANSCRIPT_STORE = 'transcripts' as const;
const AUDIO_STORE = 'audio-segments' as const;

interface TranscriptRecord {
  key: string;
  videoId: string;
  targetLanguage: string;
  transcript: Transcript;
  byteSize: number;
}

/**
 * Internal storage format: Blob is split into an ArrayBuffer + MIME type so
 * that structured-clone (used by IndexedDB) can round-trip it reliably in all
 * environments (including jsdom + fake-indexeddb).
 */
interface AudioRecord {
  key: string;
  videoId: string;
  language: string;
  voiceId: string;
  segmentId: string;
  /** Raw audio bytes — ArrayBuffer survives structured clone in all environments. */
  buffer: ArrayBuffer;
  /** MIME type of the original Blob (e.g. `'audio/mpeg'`). */
  mimeType: string;
  byteSize: number;
}

type SegmentCacheDB = {
  [TRANSCRIPT_STORE]: {
    key: string;
    value: TranscriptRecord;
    indexes: { byVideoId: string };
  };
  [AUDIO_STORE]: {
    key: string;
    value: AudioRecord;
    indexes: { byVideoId: string };
  };
};

// ---------------------------------------------------------------------------
// SegmentCache
// ---------------------------------------------------------------------------

/**
 * Persistent IndexedDB storage of translated text and synthesized audio blobs
 * keyed by video, target language, and voice profile.
 *
 * Audio blobs are serialised to ArrayBuffers before storage so that they round-
 * trip correctly through the IndexedDB structured-clone algorithm in every
 * runtime environment (browser, jsdom + fake-indexeddb, etc.).
 */
export class SegmentCache {
  private readonly dbName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBPDatabase<SegmentCacheDB>> | null = null;

  constructor(options?: SegmentCacheOptions) {
    this.dbName = options?.dbName ?? 'segment-cache';
    this.version = options?.version ?? 1;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getDb(): Promise<IDBPDatabase<SegmentCacheDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<SegmentCacheDB>(this.dbName, this.version, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(TRANSCRIPT_STORE)) {
            const ts = db.createObjectStore(TRANSCRIPT_STORE, { keyPath: 'key' });
            ts.createIndex('byVideoId', 'videoId');
          }
          if (!db.objectStoreNames.contains(AUDIO_STORE)) {
            const as = db.createObjectStore(AUDIO_STORE, { keyPath: 'key' });
            as.createIndex('byVideoId', 'videoId');
          }
        },
      });
    }
    return this.dbPromise;
  }

  private static transcriptKey(videoId: string, targetLanguage: string): string {
    return `${videoId}_${targetLanguage}`;
  }

  private static audioKey(
    videoId: string,
    language: string,
    voiceId: string,
    segmentId: string,
  ): string {
    return `${videoId}_${language}_${voiceId}_${segmentId}`;
  }

  private static audioPrefix(videoId: string, language: string, voiceId: string): string {
    return `${videoId}_${language}_${voiceId}_`;
  }

  /** Reconstruct a Blob from an AudioRecord. */
  private static recordToBlob(record: AudioRecord): Blob {
    return new Blob([record.buffer], { type: record.mimeType });
  }

  // -------------------------------------------------------------------------
  // Transcript API
  // -------------------------------------------------------------------------

  async saveTranscript(transcript: Transcript): Promise<void> {
    const targetLanguage = transcript.targetLanguage ?? '';
    const key = SegmentCache.transcriptKey(transcript.videoId, targetLanguage);
    const byteSize = new TextEncoder().encode(JSON.stringify(transcript)).length;

    const record: TranscriptRecord = {
      key,
      videoId: transcript.videoId,
      targetLanguage,
      transcript,
      byteSize,
    };

    const db = await this.getDb();
    await db.put(TRANSCRIPT_STORE, record);
  }

  async getTranscript(videoId: string, targetLanguage: string): Promise<Transcript | null> {
    const key = SegmentCache.transcriptKey(videoId, targetLanguage);
    const db = await this.getDb();
    const record = await db.get(TRANSCRIPT_STORE, key);
    return record?.transcript ?? null;
  }

  // -------------------------------------------------------------------------
  // Audio Segment API
  // -------------------------------------------------------------------------

  async saveAudioSegment(entry: {
    videoId: string;
    language: string;
    voiceId: string;
    segmentId: string;
    audioBlob: Blob;
  }): Promise<void> {
    const { videoId, language, voiceId, segmentId, audioBlob } = entry;
    const key = SegmentCache.audioKey(videoId, language, voiceId, segmentId);

    // Convert Blob → ArrayBuffer so structured-clone can handle it in all envs
    const buffer = await audioBlob.arrayBuffer();

    const record: AudioRecord = {
      key,
      videoId,
      language,
      voiceId,
      segmentId,
      buffer,
      mimeType: audioBlob.type,
      byteSize: audioBlob.size,
    };

    const db = await this.getDb();
    await db.put(AUDIO_STORE, record);
  }

  async putAudioSegment(entry: {
    key?: string;
    videoId: string;
    language: string;
    voiceId: string;
    segmentId: string;
    audioBlob: Blob;
    byteSize?: number;
  }): Promise<void> {
    return this.saveAudioSegment(entry);
  }


  async getAudioSegment(
    videoId: string,
    language: string,
    voiceId: string,
    segmentId: string,
  ): Promise<Blob | null> {
    const key = SegmentCache.audioKey(videoId, language, voiceId, segmentId);
    const db = await this.getDb();
    const record = await db.get(AUDIO_STORE, key);
    if (!record) return null;
    return SegmentCache.recordToBlob(record);
  }

  async getAudioSegmentsForVideo(
    videoId: string,
    language: string,
    voiceId: string,
  ): Promise<Map<string, Blob>> {
    const db = await this.getDb();
    const prefix = SegmentCache.audioPrefix(videoId, language, voiceId);

    // Key range covering all keys with the given `${videoId}_${language}_${voiceId}_` prefix
    const range = IDBKeyRange.bound(prefix, prefix + '\ufffd');
    const records = await db.getAll(AUDIO_STORE, range);

    const result = new Map<string, Blob>();
    for (const record of records) {
      result.set(record.segmentId, SegmentCache.recordToBlob(record));
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Usage Stats
  // -------------------------------------------------------------------------

  async getStorageUsage(): Promise<StorageUsageStats> {
    const db = await this.getDb();

    const [transcripts, audioSegments] = await Promise.all([
      db.getAll(TRANSCRIPT_STORE),
      db.getAll(AUDIO_STORE),
    ]);

    const transcriptBytes = transcripts.reduce((sum, r) => sum + r.byteSize, 0);
    const audioBytes = audioSegments.reduce((sum, r) => sum + r.byteSize, 0);

    const videoIds = new Set<string>([
      ...transcripts.map((r) => r.videoId),
      ...audioSegments.map((r) => r.videoId),
    ]);

    return {
      transcriptCount: transcripts.length,
      audioSegmentCount: audioSegments.length,
      videoCount: videoIds.size,
      totalBytes: transcriptBytes + audioBytes,
    };
  }

  // -------------------------------------------------------------------------
  // Purge API
  // -------------------------------------------------------------------------

  async purge(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([TRANSCRIPT_STORE, AUDIO_STORE], 'readwrite');
    await Promise.all([
      tx.objectStore(TRANSCRIPT_STORE).clear(),
      tx.objectStore(AUDIO_STORE).clear(),
    ]);
    await tx.done;
  }

  async purgeAll(): Promise<void> {
    return this.purge();
  }

  async purgeVideo(videoId: string): Promise<void> {
    const db = await this.getDb();

    const [transcriptRecords, audioRecords] = await Promise.all([
      db.getAllFromIndex(TRANSCRIPT_STORE, 'byVideoId', IDBKeyRange.only(videoId)),
      db.getAllFromIndex(AUDIO_STORE, 'byVideoId', IDBKeyRange.only(videoId)),
    ]);

    const tx = db.transaction([TRANSCRIPT_STORE, AUDIO_STORE], 'readwrite');
    const tsStore = tx.objectStore(TRANSCRIPT_STORE);
    const asStore = tx.objectStore(AUDIO_STORE);

    await Promise.all([
      ...transcriptRecords.map((r) => tsStore.delete(r.key)),
      ...audioRecords.map((r) => asStore.delete(r.key)),
    ]);
    await tx.done;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    if (this.dbPromise) {
      this.dbPromise.then((db) => db.close()).catch(() => {/* ignore */});
      this.dbPromise = null;
    }
  }
}
