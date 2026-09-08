import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaybackSyncEngine } from '../src/core/player/sync-engine';
import type { Segment } from '../src/types/domain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSegment(id: string = 's1', duration: number = 5): Segment {
  return {
    id,
    startTime: 0,
    endTime: duration,
    duration,
    sourceText: 'Hello world',
    translatedText: 'Xin chào thế giới',
  };
}

function makeBlob(content = 'fake-audio-bytes'): Blob {
  return new Blob([content], { type: 'audio/mpeg' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlaybackSyncEngine', () => {
  let engine: PlaybackSyncEngine;
  let lastAudio: HTMLAudioElement | null = null;
  let createUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeUrlSpy: ReturnType<typeof vi.spyOn>;
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;
  let originalAudio: typeof Audio;
  let objectUrlCounter = 0;

  beforeEach(() => {
    lastAudio = null;
    objectUrlCounter = 0;

    createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      objectUrlCounter += 1;
      return `blob:http://localhost/audio-${objectUrlCounter}`;
    });

    revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { value: false, configurable: true, writable: true });
      return Promise.resolve();
    });

    pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { value: true, configurable: true, writable: true });
    });

    originalAudio = window.Audio;
    class MockAudio extends originalAudio {
      constructor(src?: string) {
        super(src);
        Object.defineProperty(this, 'paused', { value: true, configurable: true, writable: true });
        lastAudio = this;
      }
    }
    window.Audio = MockAudio as unknown as typeof Audio;

    engine = new PlaybackSyncEngine();
  });

  afterEach(() => {
    engine.destroy();
    window.Audio = originalAudio;
    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Playback lifecycle: play, pause, resume, stop, rate change
  // -------------------------------------------------------------------------

  describe('playback lifecycle', () => {
    it('plays a segment, creates audio with specified rate, and tracks state', () => {
      const segment = makeSegment('seg-1');
      const blob = makeBlob();

      expect(engine.isPlaying).toBe(false);
      expect(engine.currentSegmentId).toBeNull();

      engine.playSegment(segment, blob, 1.25);

      expect(lastAudio).not.toBeNull();
      expect(lastAudio?.playbackRate).toBe(1.25);
      expect(playSpy).toHaveBeenCalled();
      expect(engine.currentSegmentId).toBe('seg-1');
      expect(engine.isPlaying).toBe(true);
    });

    it('pauses currently playing audio', () => {
      engine.playSegment(makeSegment('seg-1'), makeBlob(), 1.0);
      expect(engine.isPlaying).toBe(true);

      engine.pause();

      expect(pauseSpy).toHaveBeenCalled();
      expect(engine.isPlaying).toBe(false);
      expect(engine.currentSegmentId).toBe('seg-1');
    });

    it('resumes paused audio', () => {
      engine.playSegment(makeSegment('seg-1'), makeBlob(), 1.0);
      engine.pause();
      expect(engine.isPlaying).toBe(false);

      engine.resume();

      expect(playSpy).toHaveBeenCalledTimes(2);
      expect(engine.isPlaying).toBe(true);
    });

    it('handles pause and resume gracefully when no audio is active', () => {
      expect(() => engine.pause()).not.toThrow();
      expect(() => engine.resume()).not.toThrow();
      expect(engine.isPlaying).toBe(false);
    });

    it('stops active audio and resets currentSegmentId without emitting speechend', () => {
      const endSpy = vi.fn();
      engine.on('speechend', endSpy);

      engine.playSegment(makeSegment('seg-1'), makeBlob(), 1.0);
      expect(engine.isPlaying).toBe(true);

      engine.stop();

      expect(pauseSpy).toHaveBeenCalled();
      expect(engine.isPlaying).toBe(false);
      expect(engine.currentSegmentId).toBeNull();
      expect(endSpy).not.toHaveBeenCalled();
    });

    it('updates playback rate on active audio', () => {
      engine.playSegment(makeSegment('seg-1'), makeBlob(), 1.0);
      expect(lastAudio?.playbackRate).toBe(1.0);

      engine.setPlaybackRate(1.5);
      expect(lastAudio?.playbackRate).toBe(1.5);
    });

    it('does not throw when setPlaybackRate is called without active audio', () => {
      expect(() => engine.setPlaybackRate(1.5)).not.toThrow();
    });

    it('destroy() stops audio and cleans up resources', () => {
      engine.playSegment(makeSegment('seg-1'), makeBlob(), 1.0);
      engine.destroy();

      expect(engine.isPlaying).toBe(false);
      expect(engine.currentSegmentId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Event subscription: speechstart & speechend
  // -------------------------------------------------------------------------

  describe('events (speechstart & speechend)', () => {
    it('emits speechstart when playSegment is invoked', () => {
      const startSpy = vi.fn();
      engine.on('speechstart', startSpy);

      engine.playSegment(makeSegment('seg-1'), makeBlob(), 1.0);

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('emits speechend when audio dispatches ended event', () => {
      const endSpy = vi.fn();
      engine.on('speechend', endSpy);

      engine.playSegment(makeSegment('seg-1'), makeBlob(), 1.0);
      expect(endSpy).not.toHaveBeenCalled();

      lastAudio?.dispatchEvent(new Event('ended'));

      expect(endSpy).toHaveBeenCalledTimes(1);
      expect(engine.currentSegmentId).toBeNull();
      expect(engine.isPlaying).toBe(false);
    });

    it('stops listening when off() is called', () => {
      const startSpy = vi.fn();
      engine.on('speechstart', startSpy);
      engine.off('speechstart', startSpy);

      engine.playSegment(makeSegment('seg-1'), makeBlob(), 1.0);

      expect(startSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // H2: Object-URL leak prevention & revocation lifecycle
  // -------------------------------------------------------------------------

  describe('H2: Object-URL revocation lifecycle', () => {
    it('creates object URL on playSegment and revokes it on stop()', () => {
      const blob = makeBlob();
      engine.playSegment(makeSegment('s1'), blob, 1.0);

      expect(createUrlSpy).toHaveBeenCalledWith(blob);
      expect(revokeUrlSpy).not.toHaveBeenCalled();

      engine.stop();

      expect(revokeUrlSpy).toHaveBeenCalledTimes(1);
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:http://localhost/audio-1');
    });

    it('revokes the previous object URL when playSegment is called consecutively', () => {
      const blob1 = makeBlob('first');
      const blob2 = makeBlob('second');

      engine.playSegment(makeSegment('s1'), blob1, 1.0);
      expect(createUrlSpy).toHaveBeenCalledWith(blob1);
      expect(revokeUrlSpy).not.toHaveBeenCalled();

      // Second playSegment must stop the first and revoke blob1's URL
      engine.playSegment(makeSegment('s2'), blob2, 1.0);

      expect(revokeUrlSpy).toHaveBeenCalledTimes(1);
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:http://localhost/audio-1');

      // Stop second segment
      engine.stop();
      expect(revokeUrlSpy).toHaveBeenCalledTimes(2);
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:http://localhost/audio-2');
    });

    it('revokes active object URL when destroy() is called', () => {
      engine.playSegment(makeSegment('s1'), makeBlob(), 1.0);
      expect(revokeUrlSpy).not.toHaveBeenCalled();

      engine.destroy();

      expect(revokeUrlSpy).toHaveBeenCalledTimes(1);
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:http://localhost/audio-1');
    });

    it('revokes object URL when ended event fires', () => {
      engine.playSegment(makeSegment('s1'), makeBlob(), 1.0);
      expect(revokeUrlSpy).not.toHaveBeenCalled();

      lastAudio?.dispatchEvent(new Event('ended'));

      expect(revokeUrlSpy).toHaveBeenCalledTimes(1);
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:http://localhost/audio-1');
    });

    it('does NOT double-revoke if stop() is called after ended event has already fired', () => {
      engine.playSegment(makeSegment('s1'), makeBlob(), 1.0);

      lastAudio?.dispatchEvent(new Event('ended'));
      expect(revokeUrlSpy).toHaveBeenCalledTimes(1);

      // Subsequent stop should be a no-op for URL revocation
      engine.stop();
      expect(revokeUrlSpy).toHaveBeenCalledTimes(1);
    });

    it('revokes object URL and finishes safely if audio.play() rejects (e.g. autoplay blocked)', async () => {
      playSpy.mockImplementationOnce(() => Promise.reject(new Error('Autoplay blocked')));

      engine.playSegment(makeSegment('s1'), makeBlob(), 1.0);

      // Allow catch promise tick
      await Promise.resolve();

      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:http://localhost/audio-1');
      expect(engine.currentSegmentId).toBeNull();
      expect(engine.isPlaying).toBe(false);
    });

    it('does not emit spurious speechend if segment was stopped before play() rejects', async () => {
      let rejectPlay: (err: Error) => void;
      playSpy.mockImplementationOnce(() => new Promise((_, reject) => {
        rejectPlay = reject;
      }));

      const endSpy = vi.fn();
      engine.on('speechend', endSpy);

      engine.playSegment(makeSegment('s1'), makeBlob(), 1.0);

      // Stop before rejection resolves
      engine.stop();
      expect(revokeUrlSpy).toHaveBeenCalledTimes(1);

      // Now reject
      rejectPlay!(new Error('Blocked'));
      await Promise.resolve();

      // Guard should ensure no double revocation and no spurious speechend
      expect(revokeUrlSpy).toHaveBeenCalledTimes(1);
      expect(endSpy).not.toHaveBeenCalled();
    });
  });
});
