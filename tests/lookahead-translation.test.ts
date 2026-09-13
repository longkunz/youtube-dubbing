import { describe, it, expect } from 'vitest';
import { translatedLookaheadReady } from '../src/core/transcript/lookahead';
import type { Segment } from '../src/types/domain';

function seg(id: string, start: number, end: number, translatedText?: string): Segment {
  return {
    id,
    startTime: start,
    endTime: end,
    duration: end - start,
    sourceText: `src-${id}`,
    translatedText,
  };
}

describe('translatedLookaheadReady', () => {
  it('is false when the 60s window still has untranslated segments', () => {
    const segments = [
      seg('1', 0, 10, 'Một'),
      seg('2', 10, 20),
      seg('3', 20, 70, 'Ba'),
    ];
    expect(translatedLookaheadReady(segments, 5, 60)).toBe(false);
  });

  it('is true when every segment overlapping the lookahead has translatedText', () => {
    const segments = [
      seg('1', 0, 10, 'Một'),
      seg('2', 10, 40, 'Hai'),
      seg('3', 90, 100),
    ];
    expect(translatedLookaheadReady(segments, 5, 60)).toBe(true);
  });
});
