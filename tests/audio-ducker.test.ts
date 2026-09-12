import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioDucker } from '../src/core/player/audio-ducker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVideoElement(initialVolume = 1.0): HTMLVideoElement {
  const el = document.createElement('video');
  el.volume = initialVolume;
  return el;
}

/**
 * Advance requestAnimationFrame callbacks until the volume converges.
 * jsdom does not drive rAF automatically; we flush the queue manually.
 */
function flushRaf(count = 20): void {
  vi.runAllTimers();
}

// ---------------------------------------------------------------------------
// AudioDucker Tests
// ---------------------------------------------------------------------------

describe('AudioDucker', () => {
  let video: HTMLVideoElement;
  let ducker: AudioDucker;

  beforeEach(() => {
    vi.useFakeTimers();
    video = makeVideoElement(1.0);
    ducker = new AudioDucker(video);
  });

  afterEach(() => {
    ducker.destroy();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Constructor defaults
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('starts in unducked state', () => {
      expect(ducker.isDucked).toBe(false);
    });

    it('accepts a custom duck level', () => {
      const custom = new AudioDucker(video, { duckLevel: 0.1 });
      expect(custom.isDucked).toBe(false);
      custom.destroy();
    });

    it('clamps duckLevel below 0 to 0', () => {
      const clamped = new AudioDucker(video, { duckLevel: -0.5 });
      clamped.duck();
      flushRaf();
      expect(video.volume).toBeCloseTo(0.0, 5);
      clamped.destroy();
    });

    it('clamps duckLevel above 1 to 1', () => {
      video.volume = 0.8;
      const clamped = new AudioDucker(video, { duckLevel: 1.5 });
      clamped.duck();
      flushRaf();
      expect(video.volume).toBeCloseTo(0.8, 5);
      clamped.destroy();
    });

    it('handles NaN duckLevel by falling back to 0.2 default', () => {
      const fallback = new AudioDucker(video, { duckLevel: NaN });
      fallback.duck();
      flushRaf();
      expect(video.volume).toBeCloseTo(0.2, 1);
      fallback.destroy();
    });
  });

  // -------------------------------------------------------------------------
  // duck()
  // -------------------------------------------------------------------------

  describe('duck()', () => {
    it('sets isDucked to true immediately', () => {
      ducker.duck();
      expect(ducker.isDucked).toBe(true);
    });

    it('reduces video.volume toward duckLevel after lerp completes', () => {
      ducker.duck();
      flushRaf();
      // volume should be close to the default duck level (0.2) after lerp
      expect(video.volume).toBeCloseTo(0.2, 1);
    });

    it('calling duck() while already ducked is a no-op', () => {
      ducker.duck();
      flushRaf();
      const vol = video.volume;
      ducker.duck(); // call again
      flushRaf();
      expect(video.volume).toBeCloseTo(vol, 5);
    });
  });

  // -------------------------------------------------------------------------
  // unduck()
  // -------------------------------------------------------------------------

  describe('unduck()', () => {
    it('sets isDucked to false', () => {
      ducker.duck();
      flushRaf();
      ducker.unduck();
      expect(ducker.isDucked).toBe(false);
    });

    it('restores video.volume to baseline after lerp completes', () => {
      ducker.duck();
      flushRaf();
      ducker.unduck();
      flushRaf();
      expect(video.volume).toBeCloseTo(1.0, 1);
    });

    it('calling unduck() when not ducked is a no-op', () => {
      ducker.unduck(); // no duck beforehand
      flushRaf();
      expect(video.volume).toBeCloseTo(1.0, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Interruption handling
  // -------------------------------------------------------------------------

  describe('interruption handling', () => {
    it('unduck() cancels an in-progress duck lerp and trends toward baseline', () => {
      ducker.duck();
      // cancel immediately before flush
      ducker.unduck();
      flushRaf();
      // volume should have gone back up toward 1.0, not toward 0.2
      expect(video.volume).toBeGreaterThan(0.5);
    });

    it('duck() cancels an in-progress unduck lerp and trends toward duckLevel', () => {
      ducker.duck();
      flushRaf();
      ducker.unduck(); // start unducking
      // immediately duck again before flush
      ducker.duck();
      flushRaf();
      expect(video.volume).toBeCloseTo(0.2, 1);
    });
  });

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------

  describe('destroy()', () => {
    it('restores video.volume to baseline', () => {
      ducker.duck();
      flushRaf();
      expect(video.volume).toBeCloseTo(0.2, 1);
      ducker.destroy();
      expect(video.volume).toBeCloseTo(1.0, 5);
    });

    it('cancels any pending lerp so volume stops changing', () => {
      ducker.duck();
      ducker.destroy(); // cancel mid-lerp
      const vol = video.volume;
      flushRaf();
      // volume should not have changed after destroy
      expect(video.volume).toBeCloseTo(vol, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Custom baseline volume
  // -------------------------------------------------------------------------

  describe('custom baseline volume', () => {
    it('preserves a non-1.0 initial baseline when restoring after unduck', () => {
      video.volume = 0.7;
      const d = new AudioDucker(video);
      d.duck();
      flushRaf();
      d.unduck();
      flushRaf();
      expect(video.volume).toBeCloseTo(0.7, 1);
      d.destroy();
    });
  });
});
