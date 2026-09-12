import type { CaptionTrack, Segment } from '../../types/domain';

export function languageMatches(code: string | undefined, wanted: string): boolean {
  if (!code || !wanted) return false;
  return code.toLowerCase().slice(0, 2) === wanted.toLowerCase().slice(0, 2);
}

/**
 * Append YouTube machine-translation (`tlang`) without overwriting existing
 * timedtext identity params (`pot`, `fmt`, `c`, `lang`, …).
 */
export function withMachineTranslation(rawUrl: string, targetLanguage: string): string {
  const tlang = targetLanguage.toLowerCase().slice(0, 2);
  try {
    const url = new URL(rawUrl, 'https://www.youtube.com');
    if (!url.searchParams.has('tlang')) {
      url.searchParams.set('tlang', tlang);
    }
    return url.toString();
  } catch {
    if (/[?&]tlang=/i.test(rawUrl)) return rawUrl;
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}tlang=${encodeURIComponent(tlang)}`;
  }
}

export function pickCaptionTrack(
  tracks: CaptionTrack[],
  preferredLang: string = 'en',
): CaptionTrack | undefined {
  if (!tracks || tracks.length === 0) return undefined;

  const fetchable = tracks.filter((t) => !!t.baseUrl);
  const candidates = fetchable.length > 0 ? fetchable : tracks;
  const normalizedLang = preferredLang.toLowerCase().slice(0, 2);

  const exactManual = candidates.find(
    (t) => t.languageCode?.toLowerCase().startsWith(normalizedLang) && t.kind !== 'asr',
  );
  if (exactManual) return exactManual;

  const exactAsr = candidates.find(
    (t) => t.languageCode?.toLowerCase().startsWith(normalizedLang) && t.kind === 'asr',
  );
  if (exactAsr) return exactAsr;

  const anyManual = candidates.find((t) => t.kind !== 'asr');
  if (anyManual) return anyManual;

  return candidates[0];
}

export function selectTargetLanguageTrack(
  tracks: CaptionTrack[],
  targetLanguage: string,
): CaptionTrack | undefined {
  const matches = tracks.filter(
    (t) => !!t.baseUrl && languageMatches(t.languageCode, targetLanguage),
  );
  return pickCaptionTrack(matches, targetLanguage);
}

export function selectTranslatableSourceTrack(
  tracks: CaptionTrack[],
  preferredLang: string = 'en',
): CaptionTrack | undefined {
  // Audio-track / bridge URLs often omit isTranslatable (it lives on
  // playerResponse). Missing means "try tlang"; explicit false still skips.
  const translatable = tracks.filter((t) => !!t.baseUrl && t.isTranslatable !== false);
  if (translatable.length === 0) return undefined;
  const preferred = translatable.filter((t) => languageMatches(t.languageCode, preferredLang));
  return pickCaptionTrack(preferred.length > 0 ? preferred : translatable, preferredLang);
}

function overlapSeconds(
  a: { startTime: number; endTime: number },
  b: { startTime: number; endTime: number },
): number {
  const start = Math.max(a.startTime, b.startTime);
  const end = Math.min(a.endTime, b.endTime);
  return Math.max(0, end - start);
}

/**
 * Map translated Caption Track cues onto source cues by timestamp overlap.
 * `translatedText` is the translated cue body; missing overlap leaves `sourceText` empty.
 */
export function alignTranslatedCuesWithSource(source: Segment[], translated: Segment[]): Segment[] {
  return translated.map((cue, index) => {
    let best: Segment | undefined;
    let bestOverlap = 0;
    for (const s of source) {
      const o = overlapSeconds(s, cue);
      if (o > bestOverlap) {
        bestOverlap = o;
        best = s;
      }
    }
    return {
      ...cue,
      id: cue.id || `yt-${index + 1}`,
      sourceText: best?.sourceText ?? '',
      translatedText: cue.sourceText,
    };
  });
}

export function isYoutubeCaptionTranslationUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /YouTube Caption Translation unavailable/i.test(message);
}

/** Empty timedtext / zero parsed cues — translation failed, captions still exist. */
export function isYoutubeTranslatedTimedTextEmpty(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /Empty caption response received/i.test(message);
}

/**
 * Failures after a Caption Track was selected: do not invoke Whisper.
 * Whisper remains STT-only when source captions themselves cannot be downloaded.
 */
export function isYoutubeTranslationOnlyFailure(err: unknown): boolean {
  return (
    isYoutubeCaptionTranslationUnavailable(err) ||
    isYoutubeTranslatedTimedTextEmpty(err) ||
    /http-429/i.test(err instanceof Error ? err.message : String(err ?? ''))
  );
}
