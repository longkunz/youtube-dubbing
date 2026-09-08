import { describe, it, expect } from 'vitest';
import { SentenceMerger } from '../src/core/transcript/merger';
import { FRAGMENTED_AUTO_GENERATED_SEGMENTS } from './fixtures/caption-fixtures';
import { Segment } from '../src/types/domain';

describe('SentenceMerger', () => {
  const merger = new SentenceMerger({ gapThreshold: 0.4 });

  it('consolidates fragmented segments separated by gap < 0.4s into full sentences', () => {
    const merged = merger.merge(FRAGMENTED_AUTO_GENERATED_SEGMENTS);

    // Should consolidate:
    // Sentence 1: raw-1, raw-2, raw-3, raw-4 (all gaps <= 0.2s, ends with '.')
    // Sentence 2: raw-5 (gap 0.8s, ends with '.')
    // Sentence 3: raw-6, raw-7 (gap 0.1s, ends with '!')
    expect(merged).toHaveLength(3);

    // Sentence 1
    expect(merged[0].sourceText).toBe('The quick brown fox jumps over the lazy dog.');
    expect(merged[0].startTime).toBe(1.0);
    expect(merged[0].endTime).toBe(3.7);
    expect(merged[0].duration).toBeCloseTo(2.7);

    // Sentence 2
    expect(merged[1].sourceText).toBe('It was really fast.');
    expect(merged[1].startTime).toBe(4.5);
    expect(merged[1].endTime).toBe(5.2);
    expect(merged[1].duration).toBeCloseTo(0.7);

    // Sentence 3
    expect(merged[2].sourceText).toBe('And then it disappeared!');
    expect(merged[2].startTime).toBe(5.7);
    expect(merged[2].endTime).toBe(7.0);
    expect(merged[2].duration).toBeCloseTo(1.3);
  });

  it('splits on terminal punctuation (. ! ?) even if gap is less than 0.4s', () => {
    const segments: Segment[] = [
      { id: '1', startTime: 0.0, endTime: 1.0, duration: 1.0, sourceText: 'First sentence.' },
      { id: '2', startTime: 1.1, endTime: 2.0, duration: 0.9, sourceText: 'Second sentence?' },
      { id: '3', startTime: 2.2, endTime: 3.0, duration: 0.8, sourceText: 'Third sentence!' }
    ];

    const merged = merger.merge(segments);
    expect(merged).toHaveLength(3);
    expect(merged[0].sourceText).toBe('First sentence.');
    expect(merged[1].sourceText).toBe('Second sentence?');
    expect(merged[2].sourceText).toBe('Third sentence!');
  });

  it('handles empty segment list', () => {
    expect(merger.merge([])).toEqual([]);
  });

  it('preserves single segment intact', () => {
    const single: Segment = {
      id: 'single-1',
      startTime: 2.5,
      endTime: 5.0,
      duration: 2.5,
      sourceText: 'Just a single segment.'
    };
    const merged = merger.merge([single]);
    expect(merged).toHaveLength(1);
    expect(merged[0].startTime).toBe(2.5);
    expect(merged[0].endTime).toBe(5.0);
    expect(merged[0].sourceText).toBe('Just a single segment.');
  });

  it('cleans up extra whitespace and joins words cleanly', () => {
    const segments: Segment[] = [
      { id: '1', startTime: 0.0, endTime: 1.0, duration: 1.0, sourceText: '  spaced   text  ' },
      { id: '2', startTime: 1.1, endTime: 2.0, duration: 0.9, sourceText: ' continues here  ' }
    ];
    const merged = merger.merge(segments);
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceText).toBe('spaced text continues here');
    expect(merged[0].startTime).toBe(0.0);
    expect(merged[0].endTime).toBe(2.0);
  });

  it('supports custom gap threshold', () => {
    const strictMerger = new SentenceMerger({ gapThreshold: 0.05 });
    const segments: Segment[] = [
      { id: '1', startTime: 0.0, endTime: 1.0, duration: 1.0, sourceText: 'First' },
      { id: '2', startTime: 1.2, endTime: 2.0, duration: 0.8, sourceText: 'Second' } // gap = 0.2s > 0.05s
    ];
    const merged = strictMerger.merge(segments);
    expect(merged).toHaveLength(2);
  });

  it('filters out leading and intermediate empty segments', () => {
    const segments: Segment[] = [
      { id: '1', startTime: 0.0, endTime: 0.5, duration: 0.5, sourceText: '   ' },
      { id: '2', startTime: 0.6, endTime: 1.2, duration: 0.6, sourceText: 'Actual content.' },
      { id: '3', startTime: 1.3, endTime: 1.5, duration: 0.2, sourceText: '' }
    ];
    const merged = merger.merge(segments);
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceText).toBe('Actual content.');
    expect(merged[0].startTime).toBe(0.6);
  });
});
