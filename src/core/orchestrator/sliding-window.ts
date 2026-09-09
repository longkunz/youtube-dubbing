/**
 * SlidingWindow — manages a bounded lookahead queue for proactive TTS synthesis.
 *
 * Per ADR-0003 / CONTEXT.md: synthesizes audio for segments in
 * [currentTime, currentTime + lookaheadSeconds] ahead of the playhead.
 * On seek (recenter), the queue is cleared to discard obsolete synthesis requests.
 */

import type { Segment } from '../../types/domain';

export class SlidingWindow {
  private readonly lookaheadSeconds: number;
  private synthesizedIds: Set<string> = new Set();

  constructor(lookaheadSeconds: number = 60) {
    this.lookaheadSeconds = lookaheadSeconds;
  }

  /**
   * Returns segments that fall within the lookahead window and have not yet
   * been queued for synthesis.
   *
   * @param currentTime - Current video playback position in seconds.
   * @param segments - Full list of Transcript segments.
   * @returns Segments that need TTS synthesis.
   */
  getSegmentsToSynthesize(currentTime: number, segments: Segment[]): Segment[] {
    const windowEnd = currentTime + this.lookaheadSeconds;
    return segments.filter(seg => {
      const inWindow = seg.startTime >= currentTime && seg.startTime <= windowEnd;
      return inWindow && !this.synthesizedIds.has(seg.id);
    });
  }

  /**
   * Check whether a segment has already been marked for synthesis.
   */
  hasSynthesized(segmentId: string): boolean {
    return this.synthesizedIds.has(segmentId);
  }

  /**
   * Mark a segment as having been dispatched for synthesis.
   */
  markSynthesized(segmentId: string): void {
    this.synthesizedIds.add(segmentId);
  }

  /**
   * Re-center on a new timeline position after seeking.
   * Clears all previously queued synthesis tracking so segments in the new
   * window can be re-queued.
   */
  recenter(newTime: number): void {
    // newTime received but currently we reset all tracking on seek.
    // Future: could selectively retain segments still in new window.
    void newTime;
    this.synthesizedIds.clear();
  }

  /**
   * Reset the sliding window entirely (e.g. on destroy).
   */
  reset(): void {
    this.synthesizedIds.clear();
  }
}
