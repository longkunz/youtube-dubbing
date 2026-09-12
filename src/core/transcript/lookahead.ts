import type { Segment } from '../../types/domain';

/**
 * True when every Segment overlapping [currentTime, currentTime+lookahead]
 * already has translated text. Used to hold playback until CC and TTS share
 * the same lookahead window.
 */
export function translatedLookaheadReady(
  segments: Segment[],
  currentTime: number,
  lookaheadSeconds: number,
): boolean {
  const horizon = currentTime + lookaheadSeconds;
  const needed = segments.filter((segment) => segment.endTime > currentTime && segment.startTime < horizon);
  if (needed.length === 0) {
    return false;
  }
  return needed.every((segment) => Boolean(segment.translatedText?.trim()));
}
