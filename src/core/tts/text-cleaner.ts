/**
 * Text cleaner and speech detector for TTS synthesis.
 *
 * Prepares subtitle/transcript text for TTS engines (Edge TTS):
 * - Strips non-speech audio cues: [Music], [Âm nhạc], [Applause], (Laughter), etc.
 * - Strips musical note characters: ♪, ♫, 🎵, 🎶.
 * - Strips illegal XML 1.0 control characters.
 * - Detects whether text contains actual speakable characters (letters or numbers)
 *   so silence/music-only segments can be skipped without network failures.
 */

/**
 * Strips non-speech sound tags, music symbols, and illegal XML control characters.
 */
export function cleanSpeechText(text: string | null | undefined): string {
  if (!text) return '';

  return text
    // Remove sound tags in square brackets: [Music], [Âm nhạc], [Applause], [tiếng cười], etc.
    .replace(/\[[^\]]*\]/g, ' ')
    // Remove sound tags in parentheses: (Music), (Laughter), (tiếng vỗ tay), etc.
    .replace(/\([^\)]*\)/g, ' ')
    // Remove musical notes and symbols
    .replace(/[♪♫🎵🎶#_—–-]/g, ' ')
    // Remove illegal XML 1.0 control characters (except \t, \n, \r)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    // Collapse multiple whitespace characters into single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Determines whether a string contains speakable phonetic content
 * (at least one unicode letter or digit in any language).
 */
export function isSpeakableText(text: string | null | undefined): boolean {
  if (!text) return false;
  const cleaned = cleanSpeechText(text);
  // Match any Unicode letter (\p{L}) or Unicode number (\p{N})
  return /[\p{L}\p{N}]/u.test(cleaned);
}
