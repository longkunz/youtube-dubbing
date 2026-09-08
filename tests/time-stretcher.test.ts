import { describe, it, expect, beforeEach } from 'vitest';
import { TimeStretcher } from '../src/core/player/time-stretcher';

// ---------------------------------------------------------------------------
// TimeStretcher Tests
// ---------------------------------------------------------------------------

describe('TimeStretcher', () => {
  let stretcher: TimeStretcher;

  beforeEach(() => {
    stretcher = new TimeStretcher();
  });

  // -------------------------------------------------------------------------
  // No stretch needed (audio fits within segment)
  // -------------------------------------------------------------------------

  describe('when audio fits within segment duration', () => {
    it('returns 1.0 when audio is shorter than segment', () => {
      const rate = stretcher.calculateRate(3.0, 5.0);
      expect(rate).toBe(1.0);
    });

    it('returns 1.0 when audio equals segment duration exactly', () => {
      const rate = stretcher.calculateRate(5.0, 5.0);
      expect(rate).toBe(1.0);
    });
  });

  // -------------------------------------------------------------------------
  // Stretch required
  // -------------------------------------------------------------------------

  describe('when audio exceeds segment duration', () => {
    it('returns the raw ratio when it is within the 1.35 clamp', () => {
      // audioDuration=6, segmentDuration=5 → ratio = 1.2
      const rate = stretcher.calculateRate(6.0, 5.0);
      expect(rate).toBeCloseTo(1.2, 5);
    });

    it('clamps stretch ratio at 1.35 when raw ratio exceeds maximum', () => {
      // audioDuration=10, segmentDuration=5 → raw ratio = 2.0, clamped to 1.35
      const rate = stretcher.calculateRate(10.0, 5.0);
      expect(rate).toBe(1.35);
    });

    it('returns exactly 1.35 when raw ratio is exactly 1.35', () => {
      // audioDuration=6.75, segmentDuration=5 → ratio = 1.35
      const rate = stretcher.calculateRate(6.75, 5.0);
      expect(rate).toBeCloseTo(1.35, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Host playback rate scaling
  // -------------------------------------------------------------------------

  describe('host playback rate scaling', () => {
    it('scales proportionally when hostPlaybackRate is 1.5', () => {
      // stretch = 1.0 (audio < segment) → effectiveRate = 1.0 * 1.5 = 1.5
      const rate = stretcher.calculateRate(3.0, 5.0, 1.5);
      expect(rate).toBeCloseTo(1.5, 5);
    });

    it('scales clamped stretch by host rate at 2.0x', () => {
      // rawRatio = 2.0 clamped to 1.35 → effectiveRate = 1.35 * 2.0 = 2.7
      const rate = stretcher.calculateRate(10.0, 5.0, 2.0);
      expect(rate).toBeCloseTo(2.7, 5);
    });

    it('defaults hostPlaybackRate to 1.0 when omitted', () => {
      const rateWithDefault = stretcher.calculateRate(6.0, 5.0);
      const rateExplicit = stretcher.calculateRate(6.0, 5.0, 1.0);
      expect(rateWithDefault).toBe(rateExplicit);
    });

    it('handles 1.25x host rate with non-clamped stretch', () => {
      // rawRatio = 6/5 = 1.2, hostRate = 1.25 → 1.2 * 1.25 = 1.5
      const rate = stretcher.calculateRate(6.0, 5.0, 1.25);
      expect(rate).toBeCloseTo(1.5, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles very short audio gracefully (returns 1.0 * hostRate)', () => {
      const rate = stretcher.calculateRate(0.1, 5.0, 1.5);
      expect(rate).toBeCloseTo(1.5, 5);
    });

    it('returns 1.0 when audioDuration is 0 or negative', () => {
      expect(stretcher.calculateRate(0, 5.0)).toBe(1.0);
      expect(stretcher.calculateRate(-2.0, 5.0)).toBe(1.0);
    });

    it('returns 1.0 when segmentDuration is 0 or negative', () => {
      expect(stretcher.calculateRate(5.0, 0)).toBe(1.0);
      expect(stretcher.calculateRate(5.0, -1.0)).toBe(1.0);
    });

    it('returns 1.0 when durations are NaN or Infinite', () => {
      expect(stretcher.calculateRate(NaN, 5.0)).toBe(1.0);
      expect(stretcher.calculateRate(5.0, NaN)).toBe(1.0);
      expect(stretcher.calculateRate(Infinity, 5.0)).toBe(1.0);
      expect(stretcher.calculateRate(5.0, Infinity)).toBe(1.0);
    });

    it('scales by hostPlaybackRate even when durations are invalid', () => {
      expect(stretcher.calculateRate(0, 5.0, 1.5)).toBeCloseTo(1.5, 5);
      expect(stretcher.calculateRate(NaN, 5.0, 2.0)).toBeCloseTo(2.0, 5);
    });
  });
});
