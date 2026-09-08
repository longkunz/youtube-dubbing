/**
 * TimeStretcher — calculates the effective Audio playback rate needed to fit
 * a synthesized Dub Track audio clip within the original Segment's timeline slot.
 *
 * Per ADR-0003 / SPEC.md User Story 7:
 *   rawRatio = audioDuration / segmentDuration
 *   stretch   = clamp(rawRatio, 1.0, 1.35)
 *   effectiveRate = stretch * hostPlaybackRate
 */
export class TimeStretcher {
  private static readonly MIN_RATE = 1.0;
  private static readonly MAX_RATE = 1.35;

  /**
   * Calculate the effective playback rate for a synthesized audio clip.
   *
   * @param audioDuration  - Duration (seconds) of the synthesized TTS audio blob.
   * @param segmentDuration - Duration (seconds) of the original video Segment.
   * @param hostPlaybackRate - Current YouTube playback rate (e.g. 1.0, 1.5, 2.0).
   *                          Defaults to 1.0.
   * @returns Effective playback rate to apply to the Dub Track audio element.
   */
  calculateRate(
    audioDuration: number,
    segmentDuration: number,
    hostPlaybackRate: number = 1.0,
  ): number {
    const safeHostRate = isFinite(hostPlaybackRate) && hostPlaybackRate > 0 ? hostPlaybackRate : 1.0;
    // Guard against NaN / Infinity when durations are 0 or negative.
    if (!isFinite(audioDuration) || audioDuration <= 0 || !isFinite(segmentDuration) || segmentDuration <= 0) {
      return TimeStretcher.MIN_RATE * safeHostRate;
    }
    const rawRatio = audioDuration / segmentDuration;
    const stretch = Math.min(
      TimeStretcher.MAX_RATE,
      Math.max(TimeStretcher.MIN_RATE, rawRatio),
    );
    return stretch * safeHostRate;
  }
}
