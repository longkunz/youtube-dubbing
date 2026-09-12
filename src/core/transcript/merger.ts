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

    const normalize = (text?: string): string => (text || '').replace(/\s+/g, ' ').trim();
    const joinText = (left?: string, right?: string): string => {
      const a = normalize(left);
      const b = normalize(right);
      if (!a) return b;
      if (!b) return a;
      return `${a} ${b}`.replace(/\s+/g, ' ').trim();
    };
    const spoken = (s: Segment): string => normalize(s.sourceText) || normalize(s.translatedText);

    const cloneCue = (s: Segment): Segment => {
      const sourceText = normalize(s.sourceText);
      const translatedText = normalize(s.translatedText);
      return {
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        duration: s.duration,
        sourceText,
        ...(translatedText ? { translatedText } : {}),
      };
    };

    // Keep cues that have source or already-translated text (YouTube Caption Translation).
    const sorted = segments
      .filter((s) => spoken(s).length > 0)
      .sort((a, b) => a.startTime - b.startTime)
      .map(cloneCue);

    if (sorted.length === 0) {
      return [];
    }

    const merged: Segment[] = [];

    let current: Segment = cloneCue(sorted[0]);

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      const gap = next.startTime - current.endTime;
      const cleanNextSpoken = spoken(next);

      if (!cleanNextSpoken) {
        continue;
      }

      const potentialDuration = Math.max(current.endTime, next.endTime) - current.startTime;
      const potentialWords = countWords(spoken(current)) + countWords(cleanNextSpoken);

      const canMerge =
        gap < this.gapThreshold &&
        !this.endsWithSentencePunctuation(spoken(current)) &&
        potentialDuration <= this.maxDuration &&
        potentialWords <= this.maxWords;

      if (canMerge) {
        const endTime = Math.max(current.endTime, next.endTime);
        const duration = Number((endTime - current.startTime).toFixed(3));
        const translatedText = joinText(current.translatedText, next.translatedText);

        current = {
          ...current,
          endTime,
          duration,
          sourceText: joinText(current.sourceText, next.sourceText),
          ...(translatedText ? { translatedText } : {}),
        };
      } else {
        merged.push(current);
        current = cloneCue(next);
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
