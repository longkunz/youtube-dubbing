import { Segment } from '../../types/domain';

export interface SentenceMergerOptions {
  /**
   * Maximum silence gap (in seconds) between fragments to merge into a single sentence.
   * Default is 0.4s based on YouTube caption fragmentation heuristics.
   */
  gapThreshold?: number;
  /**
   * Maximum duration (in seconds) for a merged sentence segment.
   * Prevents YouTube auto-generated captions without terminal punctuation
   * from merging into giant multi-minute blocks.
   * Default: 10.0s.
   */
  maxDuration?: number;
  /**
   * Maximum word count for a merged sentence segment.
   * Default: 25 words.
   */
  maxWords?: number;
}

const DEFAULT_GAP_THRESHOLD = 0.4;
const DEFAULT_MAX_DURATION = 10.0;
const DEFAULT_MAX_WORDS = 25;
const TERMINAL_PUNCTUATION_REGEX = /[.!?…]["'”’]?$/;

function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * SentenceMerger
 * Consolidates fragmented YouTube caption chunks into complete grammatical sentences.
 * Chunks separated by silence gaps < 0.4s are merged into cohesive sentence units
 * while preserving overall timeline boundaries (startTime of first chunk, endTime of last chunk).
 */
export class SentenceMerger {
  private readonly gapThreshold: number;
  private readonly maxDuration: number;
  private readonly maxWords: number;

  constructor(options: SentenceMergerOptions = {}) {
    this.gapThreshold = options.gapThreshold ?? DEFAULT_GAP_THRESHOLD;
    this.maxDuration = options.maxDuration ?? DEFAULT_MAX_DURATION;
    this.maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;
  }

  /**
   * Check if text ends with sentence-ending punctuation (. ! ? …)
   */
  private endsWithSentencePunctuation(text: string): boolean {
    return TERMINAL_PUNCTUATION_REGEX.test(text.trim());
  }

  /**
   * Merge consecutive caption segments
   */
  public merge(segments: Segment[]): Segment[] {
    if (!segments || segments.length === 0) {
      return [];
    }

    // Work on a copy with non-empty text, sorted by startTime
    const sorted = segments
      .filter((s) => s.sourceText && s.sourceText.trim().length > 0)
      .sort((a, b) => a.startTime - b.startTime);

    if (sorted.length === 0) {
      return [];
    }

    const merged: Segment[] = [];

    let current: Segment = {
      id: sorted[0].id,
      startTime: sorted[0].startTime,
      endTime: sorted[0].endTime,
      duration: sorted[0].duration,
      sourceText: sorted[0].sourceText.replace(/\s+/g, ' ').trim()
    };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      const gap = next.startTime - current.endTime;
      const cleanNextText = next.sourceText.replace(/\s+/g, ' ').trim();

      if (!cleanNextText) {
        continue;
      }

      const potentialDuration = Math.max(current.endTime, next.endTime) - current.startTime;
      const potentialWords = countWords(current.sourceText) + countWords(cleanNextText);

      // Check if we can merge:
      // 1. Gap is smaller than threshold (e.g. < 0.4s)
      // 2. Previous segment does not end with terminal punctuation
      // 3. Merged segment does not exceed maxDuration or maxWords
      const canMerge =
        gap < this.gapThreshold &&
        !this.endsWithSentencePunctuation(current.sourceText) &&
        potentialDuration <= this.maxDuration &&
        potentialWords <= this.maxWords;

      if (canMerge) {
        const combinedText = `${current.sourceText} ${cleanNextText}`.replace(/\s+/g, ' ').trim();
        const endTime = Math.max(current.endTime, next.endTime);
        const duration = Number((endTime - current.startTime).toFixed(3));

        current = {
          ...current,
          endTime,
          duration,
          sourceText: combinedText
        };
      } else {
        merged.push(current);
        current = {
          id: next.id,
          startTime: next.startTime,
          endTime: next.endTime,
          duration: next.duration,
          sourceText: cleanNextText
        };
      }
    }

    // Push final segment
    merged.push(current);

    // Normalize IDs and return
    return merged.map((seg, idx) => ({
      ...seg,
      id: `seg-${idx + 1}`
    }));
  }
}
