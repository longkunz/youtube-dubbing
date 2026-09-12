import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { SegmentCache } from '../src/storage/index';
import type { StorageUsageStats } from '../src/storage/index';
import type { Transcript } from '../src/types/domain';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRANSCRIPT_A: Transcript = {
  videoId: 'vid-001',
  sourceLanguage: 'en',
  targetLanguage: 'vi',
  segments: [
    {
      id: 's1',
      startTime: 0,
      endTime: 4,
      duration: 4,
      sourceText: 'Hello everyone',
      translatedText: 'Xin chào mọi người',
    },
    {
      id: 's2',
      startTime: 4,
      endTime: 9,
      duration: 5,
      sourceText: 'Welcome to the channel',
      translatedText: 'Chào mừng đến kênh',
    },
  ],
};

const TRANSCRIPT_B: Transcript = {
  videoId: 'vid-002',
  sourceLanguage: 'en',
  targetLanguage: 'ja',
  segments: [
    {
      id: 's1',
      startTime: 0,
      endTime: 3,
      duration: 3,
      sourceText: 'Good morning',
      translatedText: 'おはようございます',
    },
  ],
};

function makeAudioBlob(content: string): Blob {
  return new Blob([content], { type: 'audio/mpeg' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SegmentCache', () => {
  let cache: SegmentCache;

  beforeEach(() => {
    // Each test gets a fresh DB instance via a unique name
    cache = new SegmentCache({ dbName: `test-db-${Math.random()}` });
  });

  // --- Transcript Store & Retrieve ---

  it('saves and retrieves a transcript by videoId + targetLanguage', async () => {
    await cache.saveTranscript(TRANSCRIPT_A);

    const result = await cache.getTranscript('vid-001', 'vi');

    expect(result).not.toBeNull();
    expect(result!.videoId).toBe('vid-001');
    expect(result!.targetLanguage).toBe('vi');
    expect(result!.segments).toHaveLength(2);
    expect(result!.segments[0].translatedText).toBe('Xin chào mọi người');
  });

  it('returns null for a transcript that has not been cached', async () => {
    const result = await cache.getTranscript('vid-999', 'vi');
    expect(result).toBeNull();
  });

  it('distinguishes transcripts by targetLanguage', async () => {
    await cache.saveTranscript(TRANSCRIPT_A); // vid-001 / vi
    await cache.saveTranscript(TRANSCRIPT_B); // vid-002 / ja

    const viResult = await cache.getTranscript('vid-001', 'vi');
    const jaResult = await cache.getTranscript('vid-002', 'ja');
    const missResult = await cache.getTranscript('vid-001', 'ja');

    expect(viResult).not.toBeNull();
    expect(jaResult).not.toBeNull();
    expect(missResult).toBeNull();
  });

  it('overwrites an existing transcript on re-save', async () => {
    await cache.saveTranscript(TRANSCRIPT_A);

    const updated: Transcript = {
      ...TRANSCRIPT_A,
      segments: [{ ...TRANSCRIPT_A.segments[0], translatedText: 'Cập nhật' }],
    };
    await cache.saveTranscript(updated);

    const result = await cache.getTranscript('vid-001', 'vi');
    expect(result!.segments).toHaveLength(1);
    expect(result!.segments[0].translatedText).toBe('Cập nhật');
  });

  // --- Audio Segment Store & Retrieve ---

  it('saves and retrieves an audio segment by videoId + language + voiceId + segmentId', async () => {
    const blob = makeAudioBlob('fake-audio-data');
    await cache.saveAudioSegment({
      videoId: 'vid-001',
      language: 'vi',
      voiceId: 'voice-female-vi',
      segmentId: 's1',
      audioBlob: blob,
    });

    const result = await cache.getAudioSegment('vid-001', 'vi', 'voice-female-vi', 's1');

    expect(result).not.toBeNull();
    expect(result!.size).toBe(blob.size);
    expect(result!.type).toBe('audio/mpeg');
  });

  it('returns null for an audio segment that has not been cached', async () => {
    const result = await cache.getAudioSegment('vid-001', 'vi', 'voice-female-vi', 's99');
    expect(result).toBeNull();
  });

  it('distinguishes audio segments by voiceId', async () => {
    const blobFemale = makeAudioBlob('female-audio');
    const blobMale = makeAudioBlob('male-audio');

    await cache.saveAudioSegment({ videoId: 'vid-001', language: 'vi', voiceId: 'voice-female', segmentId: 's1', audioBlob: blobFemale });
    await cache.saveAudioSegment({ videoId: 'vid-001', language: 'vi', voiceId: 'voice-male', segmentId: 's1', audioBlob: blobMale });

    const female = await cache.getAudioSegment('vid-001', 'vi', 'voice-female', 's1');
    const male = await cache.getAudioSegment('vid-001', 'vi', 'voice-male', 's1');

    expect(female!.size).toBe(blobFemale.size);
    expect(male!.size).toBe(blobMale.size);
  });

  // --- Batch Retrieval ---

  it('retrieves all audio segments for a video as a Map<segmentId, Blob>', async () => {
    await cache.saveAudioSegment({ videoId: 'vid-001', language: 'vi', voiceId: 'voice-v1', segmentId: 's1', audioBlob: makeAudioBlob('audio-s1') });
    await cache.saveAudioSegment({ videoId: 'vid-001', language: 'vi', voiceId: 'voice-v1', segmentId: 's2', audioBlob: makeAudioBlob('audio-s2') });
    // Different video — should not appear
    await cache.saveAudioSegment({ videoId: 'vid-002', language: 'vi', voiceId: 'voice-v1', segmentId: 's1', audioBlob: makeAudioBlob('audio-other') });

    const segmentsMap = await cache.getAudioSegmentsForVideo('vid-001', 'vi', 'voice-v1');

    expect(segmentsMap.size).toBe(2);
    expect(segmentsMap.has('s1')).toBe(true);
    expect(segmentsMap.has('s2')).toBe(true);
    expect(segmentsMap.has('other')).toBe(false);
  });

  it('returns an empty map when no audio segments exist for a video', async () => {
    const segmentsMap = await cache.getAudioSegmentsForVideo('vid-999', 'vi', 'voice-v1');
    expect(segmentsMap.size).toBe(0);
  });

  // --- Storage Usage ---

  it('returns zero usage stats on empty cache', async () => {
    const stats: StorageUsageStats = await cache.getStorageUsage();
    expect(stats.transcriptCount).toBe(0);
    expect(stats.audioSegmentCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it('reports accurate usage stats after saving transcripts and audio segments', async () => {
    await cache.saveTranscript(TRANSCRIPT_A);

    const blob = makeAudioBlob('audio-content');
    await cache.saveAudioSegment({ videoId: 'vid-001', language: 'vi', voiceId: 'v1', segmentId: 's1', audioBlob: blob });

    const stats = await cache.getStorageUsage();
    expect(stats.transcriptCount).toBe(1);
    expect(stats.audioSegmentCount).toBe(1);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  // --- Purge All ---

  it('purge() wipes all cached audio blobs and transcripts', async () => {
    await cache.saveTranscript(TRANSCRIPT_A);
    await cache.saveAudioSegment({ videoId: 'vid-001', language: 'vi', voiceId: 'v1', segmentId: 's1', audioBlob: makeAudioBlob('data') });

    await cache.purge();

    const transcript = await cache.getTranscript('vid-001', 'vi');
    const audio = await cache.getAudioSegment('vid-001', 'vi', 'v1', 's1');
    const stats = await cache.getStorageUsage();

    expect(transcript).toBeNull();
    expect(audio).toBeNull();
    expect(stats.transcriptCount).toBe(0);
    expect(stats.audioSegmentCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  // --- Per-Video Purge ---

  it('purgeVideo() removes only entries for the given videoId', async () => {
    await cache.saveTranscript(TRANSCRIPT_A); // vid-001
    await cache.saveTranscript(TRANSCRIPT_B); // vid-002
    await cache.saveAudioSegment({ videoId: 'vid-001', language: 'vi', voiceId: 'v1', segmentId: 's1', audioBlob: makeAudioBlob('a') });
    await cache.saveAudioSegment({ videoId: 'vid-002', language: 'ja', voiceId: 'v1', segmentId: 's1', audioBlob: makeAudioBlob('b') });

    await cache.purgeVideo('vid-001');

    expect(await cache.getTranscript('vid-001', 'vi')).toBeNull();
    expect(await cache.getAudioSegment('vid-001', 'vi', 'v1', 's1')).toBeNull();

    // vid-002 must be untouched
    expect(await cache.getTranscript('vid-002', 'ja')).not.toBeNull();
    expect(await cache.getAudioSegment('vid-002', 'ja', 'v1', 's1')).not.toBeNull();
  });

  // --- Cache-Hit Lifecycle ---

  it('returns a cached audio segment immediately on a second fetch (cache-hit)', async () => {
    const blob = makeAudioBlob('segment-audio');
    await cache.saveAudioSegment({ videoId: 'vid-001', language: 'vi', voiceId: 'v1', segmentId: 's1', audioBlob: blob });

    // First fetch
    const first = await cache.getAudioSegment('vid-001', 'vi', 'v1', 's1');
    // Second fetch (cache-hit)
    const second = await cache.getAudioSegment('vid-001', 'vi', 'v1', 's1');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.size).toBe(second!.size);
  });

  // --- close() ---

  it('isolates transcripts by Translation Provider and reads legacy keys as Gemini', async () => {
    const youtubeCopy: Transcript = {
      ...TRANSCRIPT_A,
      segments: TRANSCRIPT_A.segments.map((s) => ({
        ...s,
        translatedText: 'Bản YouTube',
      })),
    };

    await cache.saveTranscript(TRANSCRIPT_A, 'gemini');
    await cache.saveTranscript(youtubeCopy, 'youtube-caption-translation');

    const gemini = await cache.getTranscript('vid-001', 'vi', 'gemini');
    const youtube = await cache.getTranscript('vid-001', 'vi', 'youtube-caption-translation');

    expect(gemini!.segments[0].translatedText).toBe('Xin chào mọi người');
    expect(youtube!.segments[0].translatedText).toBe('Bản YouTube');
  });

  it('reads a pre-provider transcript key as Gemini and not as YouTube Caption Translation', async () => {
    const { openDB } = await import('idb');
    const dbName = `legacy-transcript-${Math.random()}`;
    const legacyCache = new SegmentCache({ dbName });
    await legacyCache.getTranscript('missing', 'vi');

    const db = await openDB(dbName, 1);
    await db.put('transcripts', {
      key: 'vid-legacy_vi',
      videoId: 'vid-legacy',
      targetLanguage: 'vi',
      transcript: { ...TRANSCRIPT_A, videoId: 'vid-legacy' },
      byteSize: 32,
    });
    db.close();

    expect(await legacyCache.getTranscript('vid-legacy', 'vi', 'gemini')).not.toBeNull();
    expect(await legacyCache.getTranscript('vid-legacy', 'vi', 'youtube-caption-translation')).toBeNull();
    legacyCache.close();
  });

  it('close() does not throw', () => {
    expect(() => cache.close()).not.toThrow();
  });
});
