import { describe, it, expect, beforeEach } from 'vitest';
import { SlidingWindow } from '../src/core/orchestrator/sliding-window';
import type { Segment } from '../src/types/domain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSegment(id: string, startTime: number, endTime: number): Segment {
  return {
    id,
    startTime,
    endTime,
    duration: endTime - startTime,
    sourceText: `Text for ${id}`,
    translatedText: `Dịch cho ${id}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlidingWindow', () => {
  let sampleSegments: Segment[];

  beforeEach(() => {
    sampleSegments = [
      makeSegment('s0', 0, 5),
      makeSegment('s1', 10, 15),
      makeSegment('s2', 25, 30),
      makeSegment('s3', 45, 50),
      makeSegment('s4', 60, 65),
      makeSegment('s5', 75, 80),
      makeSegment('s6', 100, 105),
      makeSegment('s7', 120, 125),
    ];
  });

  describe('in-window detection', () => {
    it('detects segments in default 60s lookahead window', () => {
      const window = new SlidingWindow(); // default 60s
      // at currentTime = 0: window is [0, 60]. Segments: s0 (0), s1 (10), s2 (25), s3 (45), s4 (60)
      const toSynth = window.getSegmentsToSynthesize(0, sampleSegments);
      expect(toSynth.map(s => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    });

    it('detects segments in custom 30s lookahead window', () => {
      const window = new SlidingWindow(30);
      // at currentTime = 0: window is [0, 30]. Segments: s0 (0), s1 (10), s2 (25)
      const toSynth = window.getSegmentsToSynthesize(0, sampleSegments);
      expect(toSynth.map(s => s.id)).toEqual(['s0', 's1', 's2']);
    });

    it('excludes segments whose startTime is before currentTime', () => {
      const window = new SlidingWindow(30);
      // at currentTime = 15: window is [15, 45].
      // s0 (0) and s1 (10) are in the past -> excluded
      // s2 (25) and s3 (45) are in window
      const toSynth = window.getSegmentsToSynthesize(15, sampleSegments);
      expect(toSynth.map(s => s.id)).toEqual(['s2', 's3']);
    });

    it('excludes segments whose startTime is beyond currentTime + lookahead', () => {
      const window = new SlidingWindow(30);
      // at currentTime = 10: window is [10, 40].
      // s3 (45), s4 (60), etc. are too far ahead -> excluded
      const toSynth = window.getSegmentsToSynthesize(10, sampleSegments);
      expect(toSynth.map(s => s.id)).toEqual(['s1', 's2']);
    });

    it('handles exact boundary conditions at currentTime and windowEnd', () => {
      const window = new SlidingWindow(60);
      const segments: Segment[] = [
        makeSegment('boundary-start', 10, 15),
        makeSegment('boundary-end', 70, 75),
        makeSegment('outside-past', 9.99, 14),
        makeSegment('outside-future', 70.01, 75),
      ];

      const toSynth = window.getSegmentsToSynthesize(10, segments);
      expect(toSynth.map(s => s.id)).toEqual(['boundary-start', 'boundary-end']);
    });

    it('returns empty array if no segments match current window', () => {
      const window = new SlidingWindow(10);
      const toSynth = window.getSegmentsToSynthesize(200, sampleSegments);
      expect(toSynth).toEqual([]);
    });
  });

  describe('already-synthesized exclusion', () => {
    it('excludes segments once marked synthesized', () => {
      const window = new SlidingWindow(60);
      // First check at t = 0
      const initial = window.getSegmentsToSynthesize(0, sampleSegments);
      expect(initial.map(s => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);

      // Mark s0 and s1 as synthesized
      window.markSynthesized('s0');
      window.markSynthesized('s1');

      // Subsequent query should exclude s0 and s1
      const remaining = window.getSegmentsToSynthesize(0, sampleSegments);
      expect(remaining.map(s => s.id)).toEqual(['s2', 's3', 's4']);
    });

    it('does not return any segments if all in-window segments are synthesized', () => {
      const window = new SlidingWindow(30);
      const toSynth = window.getSegmentsToSynthesize(0, sampleSegments);
      for (const seg of toSynth) {
        window.markSynthesized(seg.id);
      }

      expect(window.getSegmentsToSynthesize(0, sampleSegments)).toEqual([]);
    });

    it('returns newly entered segments as playback advances while ignoring synthesized ones', () => {
      const window = new SlidingWindow(30);
      // At t = 0 [0, 30] -> s0, s1, s2
      const firstBatch = window.getSegmentsToSynthesize(0, sampleSegments);
      for (const seg of firstBatch) {
        window.markSynthesized(seg.id);
      }

      // Time advances to t = 20: window is [20, 50].
      // s2 (25) is in window but already synthesized
      // s3 (45) is in window and NOT synthesized
      const secondBatch = window.getSegmentsToSynthesize(20, sampleSegments);
      expect(secondBatch.map(s => s.id)).toEqual(['s3']);
    });

    it('allows a segment to be re-queried after unmarkSynthesized', () => {
      const window = new SlidingWindow(60);
      window.markSynthesized('s0');
      expect(window.hasSynthesized('s0')).toBe(true);
      window.unmarkSynthesized('s0');
      expect(window.hasSynthesized('s0')).toBe(false);
      const toSynth = window.getSegmentsToSynthesize(0, sampleSegments);
      expect(toSynth.map(s => s.id)).toContain('s0');
    });
  });

  describe('recenter() and seeking', () => {
    it('clears synthesized tracking so new-window segments can be requested', () => {
      const window = new SlidingWindow(60);
      // Mark s0..s4 as synthesized at t = 0
      const at0 = window.getSegmentsToSynthesize(0, sampleSegments);
      for (const seg of at0) {
        window.markSynthesized(seg.id);
      }
      expect(window.getSegmentsToSynthesize(0, sampleSegments)).toEqual([]);

      // User seeks to t = 90
      window.recenter(90);

      // In window [90, 150]: s6 (100) and s7 (120)
      const at90 = window.getSegmentsToSynthesize(90, sampleSegments);
      expect(at90.map(s => s.id)).toEqual(['s6', 's7']);
    });

    it('allows previously synthesized segments to be re-requested after seeking back', () => {
      const window = new SlidingWindow(60);
      // Synthesize at t = 0
      const at0 = window.getSegmentsToSynthesize(0, sampleSegments);
      for (const seg of at0) {
        window.markSynthesized(seg.id);
      }

      // Seek forward to 80, then seek back to 0
      window.recenter(80);
      window.recenter(0);

      // Now s0..s4 can be requested again because recenter cleared the tracking
      const reRequested = window.getSegmentsToSynthesize(0, sampleSegments);
      expect(reRequested.map(s => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    });
  });

  describe('reset()', () => {
    it('resets tracking completely', () => {
      const window = new SlidingWindow(60);
      window.markSynthesized('s0');
      window.markSynthesized('s1');

      window.reset();

      const afterReset = window.getSegmentsToSynthesize(0, sampleSegments);
      expect(afterReset.map(s => s.id)).toContain('s0');
      expect(afterReset.map(s => s.id)).toContain('s1');
    });
  });
});
