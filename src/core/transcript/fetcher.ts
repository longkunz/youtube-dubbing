import { CaptionTrack, PlayerResponseCaptions, Segment, Transcript } from '../../types/domain';
import { parseTimedTextJson, parseTimedTextXml } from './parser';
import { SentenceMerger } from './merger';

export interface TranscriptFetcherOptions {
  fetchFn?: typeof fetch;
  merger?: SentenceMerger;
  /**
   * Backoff delays (ms) between retries when timedtext answers 429/5xx.
   * Default [1000, 2000] → up to 3 attempts per URL. Override with short
   * delays in tests.
   */
  retryDelaysMs?: number[];
}

/**
 * Marker present in YouTube timedtext baseUrls that are gated behind a
 * Proof-of-Origin Token (BOTGUARD). Since mid-2025 YouTube returns HTTP 200
 * with an EMPTY body for these URLs unless the request carries a valid
 * `pot` query parameter minted by the player JS for that specific video.
 * A naive fetch therefore looks like "no captions" even while CC is
 * visibly rendered in the player.
 */
export const POT_GATED_URL_MARKER = 'exp=xpe';

export function isPotTokenError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /pot\b|proof-of-origin|exp=xpe/i.test(message);
}

function createPotTokenRequiredError(videoId: string): Error {
  return new Error(
    `POT token required for video ${videoId} (timedtext URL is gated behind exp=xpe). ` +
      `Captions exist but YouTube returned an empty body without a valid Proof-of-Origin token. ` +
      `Use a player-minted caption URL (movie_player.getAudioTrack().captionTracks) instead of the static baseUrl.`
  );
}

/**
 * Normalize a timedtext URL before fetching.
 *
 * Player-minted URLs from `getAudioTrack().captionTracks` typically carry
 * `pot` but no `fmt`/`c`. Per asbplayer#978, POT-gated timedtext endpoints
 * return HTTP 200 with an EMPTY body unless the request also carries the
 * web client identity (`c=WEB`) and an explicit format. Our parser handles
 * json3 (`events[].segs[].utf8`) and legacy XML (`<text start dur>`), so we
 * request `fmt=json3` when the caller did not choose a format.
 * Existing params are never overwritten.
 */
export function normalizeTimedTextUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'https://www.youtube.com');
    if (!url.searchParams.has('fmt')) {
      url.searchParams.set('fmt', 'json3');
    }
    if (!url.searchParams.has('c')) {
      url.searchParams.set('c', 'WEB');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export interface FetchTranscriptOptions {
  trackUrl?: string;
  captionTracks?: CaptionTrack[];
  playerResponse?: PlayerResponseCaptions;
  preferredLang?: string;
}

/**
 * TranscriptFetcher
 * Retrieves timedtext captions for YouTube videos via YouTube's timedtext API
 * and player response caption tracks.
 */
export class TranscriptFetcher {
  private readonly fetchFn: typeof fetch;
  private readonly merger: SentenceMerger;
  private readonly retryDelaysMs: number[];

  constructor(options: TranscriptFetcherOptions = {}) {
    this.fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined as any);
    this.merger = options.merger ?? new SentenceMerger();
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 2000];
  }

  /**
   * Check whether a player response object contains at least one caption track.
   * Useful as a quick existence check before attempting to fetch.
   */
  public hasCaptionTracks(playerResponse: PlayerResponseCaptions | any): boolean {
    if (!playerResponse || typeof playerResponse !== 'object') return false;
    const renderer =
      playerResponse.captions?.playerCaptionsTracklistRenderer ||
      playerResponse.playerCaptionsTracklistRenderer;
    const rawTracks = renderer?.captionTracks;
    return Array.isArray(rawTracks) && rawTracks.length > 0;
  }

  /**
   * Extract caption tracks from a YouTube player response object.
   * Handles both `baseUrl` (playerResponse shape) and `url` (getAudioTrack shape).
   */
  public extractCaptionTracks(playerResponse: PlayerResponseCaptions | any): CaptionTrack[] {
    if (!playerResponse || typeof playerResponse !== 'object') {
      return [];
    }

    const renderer =
      playerResponse.captions?.playerCaptionsTracklistRenderer ||
      playerResponse.playerCaptionsTracklistRenderer;
    const rawTracks = renderer?.captionTracks;

    if (!Array.isArray(rawTracks) || rawTracks.length === 0) {
      return [];
    }

    return rawTracks.map((track) => {
      const name = track.name?.simpleText || track.name?.runs?.map((r: any) => r.text).join('') || '';
      return {
        // Support both `baseUrl` (standard playerResponse) and `url` (getAudioTrack shape)
        baseUrl: track.baseUrl ?? track.url,
        languageCode: track.languageCode,
        name,
        kind: track.kind === 'asr' ? 'asr' : undefined,
        isTranslatable: track.isTranslatable ?? false
      };
    });
  }

  /**
   * Extract player response JSON from raw YouTube watch page HTML.
   * Uses a balanced-brace scanner instead of a greedy/lazy regex to correctly
   * handle deeply nested JSON objects (a simple regex like `{.+?}` stops at the
   * first closing brace inside nested structures and returns malformed JSON).
   */
  public extractPlayerResponseFromHtml(html: string): PlayerResponseCaptions | null {
    if (!html || typeof html !== 'string') return null;

    // Find where the JSON object begins
    const keyMatch = /ytInitialPlayerResponse\s*=\s*\{/.exec(html);
    if (!keyMatch) return null;

    const startIndex = keyMatch.index + keyMatch[0].length - 1; // position of opening '{'
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIndex; i < html.length; i++) {
      const ch = html[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') { depth++; continue; }
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(startIndex, i + 1));
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }

  /**
   * Select the best caption track for the given preferred language.
   * Prioritizes author-uploaded manual CC (kind !== 'asr') over auto-generated CC (kind === 'asr').
   * Only considers tracks that have a fetchable URL (baseUrl is truthy).
   */
  public selectBestCaptionTrack(tracks: CaptionTrack[], preferredLang: string = 'en'): CaptionTrack | undefined {
    if (!tracks || tracks.length === 0) {
      return undefined;
    }

    // Only use tracks that have a URL we can actually fetch
    const fetchable = tracks.filter((t) => !!t.baseUrl);
    // If no track has a baseUrl, fall back to any track (caller may fill in URL later)
    const candidates = fetchable.length > 0 ? fetchable : tracks;

    const normalizedLang = preferredLang.toLowerCase().slice(0, 2);

    // 1. Exact match language, manual CC
    const exactManual = candidates.find(
      (t) => t.languageCode?.toLowerCase().startsWith(normalizedLang) && t.kind !== 'asr'
    );
    if (exactManual) return exactManual;

    // 2. Exact match language, auto-generated CC (asr)
    const exactAsr = candidates.find(
      (t) => t.languageCode?.toLowerCase().startsWith(normalizedLang) && t.kind === 'asr'
    );
    if (exactAsr) return exactAsr;

    // 3. Any manual CC
    const anyManual = candidates.find((t) => t.kind !== 'asr');
    if (anyManual) return anyManual;

    // 4. First available track
    return candidates[0];
  }

  /**
   * Fetch a single caption URL and return the raw text, or null if empty/failed.
   */
  private async tryFetchCaption(url: string): Promise<string | null> {
    try {
      const res = await this.fetchWithRetry(url);
      if (!res || !res.ok) return null;
      const text = await res.text();
      return text.trim() ? text : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch with exponential backoff on rate limiting (429) and transient
   * server errors (5xx). YouTube throttles timedtext per IP/session, so a
   * burst of caption requests (e.g. pipeline retry + multi-track fallback)
   * can answer 429 even with a valid POT. Honors the server's Retry-After
   * hint when present, otherwise falls back to configured delays.
   * Returns the last response (possibly !ok) or null on network exception.
   */
  private async fetchWithRetry(url: string, delays: number[] = this.retryDelaysMs): Promise<Response | null> {
    const maxAttempts = delays.length + 1;
    let lastRes: Response | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.fetchFn(url, { credentials: 'include' } as any);
        if (res.ok) return res;
        lastRes = res;
        const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
        if (!retryable || attempt === maxAttempts) return res;
        await this.sleep(this.retryDelayMs(res, attempt, delays));
      } catch {
        if (attempt === maxAttempts) return null;
        await this.sleep(delays[attempt - 1]);
      }
    }
    return lastRes;
  }

  private retryDelayMs(res: Response, attempt: number, delays: number[] = this.retryDelaysMs): number {
    try {
      const header = res.headers?.get?.('retry-after');
      if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 60) {
          return seconds * 1000;
        }
      }
    } catch {
      // fall through to configured delay
    }
    return delays[attempt - 1];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fetch and parse timedtext captions into a consolidated Transcript with merged sentences.
   *
   * Track fallback chain:
   *   1. If explicit `trackUrl` is provided, use it directly.
   *   2. Resolve tracks from `captionTracks` (preferring those with a baseUrl).
   *      If captionTracks entries lack baseUrls, fall through to `playerResponse`.
   *   3. Select best track via language preference; retry best on transient
   *      failure, then single-attempt fallback candidates (no retry storm).
   *   4. Plain `/api/timedtext?lang=…` fallback; retry with `kind=asr` if empty.
   */
  public async fetchTranscript(
    videoId: string,
    options: FetchTranscriptOptions = {}
  ): Promise<Transcript> {
    const preferredLang = options.preferredLang || 'en';

    // ── Branch A: explicit URL provided ──────────────────────────────────────
    if (options.trackUrl) {
      return this.fetchFromUrl(videoId, options.trackUrl, undefined, preferredLang);
    }

    // ── Resolve candidate tracks ──────────────────────────────────────────────
    let domTracks = options.captionTracks;
    const prTracks = options.playerResponse
      ? this.extractCaptionTracks(options.playerResponse)
      : undefined;

    // If domTracks are provided but none has a baseUrl, they're "presence hints"
    // only (e.g. getOption('captions','tracklist') shape). Fall through to prTracks.
    const domHasUrls = domTracks && domTracks.some((t) => !!t.baseUrl);

    let tracks: CaptionTrack[] | undefined;
    if (domHasUrls) {
      tracks = domTracks;
    } else if (prTracks && prTracks.length > 0) {
      tracks = prTracks;
    } else if (domTracks !== undefined && domTracks.length === 0) {
      // Caller explicitly passed an empty array — no captions
      throw new Error(`No caption tracks found for video ${videoId}`);
    }

    // ── Branch B: tracks resolved ────────────────────────────────────────────
    if (tracks && tracks.length > 0) {
      const fetchable = tracks.filter((t) => !!t.baseUrl);
      if (fetchable.length === 0) {
        // Tracks exist but have no URL — likely POT-gated; surface a clear error
        throw new Error(`No caption tracks found for video ${videoId}`);
      }

      // Build a priority-ordered candidate list
      const best = this.selectBestCaptionTrack(fetchable, preferredLang);
      const ordered = best
        ? [best, ...fetchable.filter((t) => t !== best)]
        : fetchable;

      const failures: string[] = [];
      // Only the best track gets retries: if the whole endpoint is throttled
      // (429), hammering fallback tracks with retries only extends the ban.
      // Fallback candidates get a single attempt each.
      for (let i = 0; i < ordered.length; i++) {
        const track = ordered[i];
        const url = normalizeTimedTextUrl(track.baseUrl!);
        const delays = i === 0 ? this.retryDelaysMs : [];

        // Detect POT-gated URLs upfront so we emit a specific error
        if (url.includes(POT_GATED_URL_MARKER)) {
          const res = await this.fetchWithRetry(url, delays);
          if (!res || !res.ok) {
            failures.push(`${track.languageCode || '?'}:http-${res ? (res as any).status : 'error'}`);
            continue; // try next track
          }
          const text = await res.text();
          if (!text.trim()) {
            failures.push(`${track.languageCode || '?'}:empty`);
            // If this is the only candidate, throw the POT error
            if (ordered.length === 1 || ordered.indexOf(track) === ordered.length - 1) {
              throw createPotTokenRequiredError(videoId);
            }
            continue; // try next
          }
          return this.parseAndReturn(text, videoId, url, track, preferredLang);
        }

        const res = await this.fetchWithRetry(url, delays);
        if (!res || !res.ok) {
          failures.push(`${track.languageCode || '?'}:http-${res ? (res as any).status : 'error'}`);
          continue; // try next track
        }
        const text = await res.text();
        if (!text.trim()) {
          failures.push(`${track.languageCode || '?'}:empty`);
          continue; // try next track
        }
        return this.parseAndReturn(text, videoId, url, track, preferredLang);
      }

      const detail = failures.length > 0 ? ` (${failures.join(', ')})` : '';
      throw new Error(`Failed to fetch timedtext captions: all ${ordered.length} candidate track(s) returned empty or failed for video ${videoId}${detail}`);
    }

    // ── Branch C: no tracks — plain fallback endpoint ────────────────────────
    const fallbackBase = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${preferredLang}&fmt=json3`;

    const text = await this.tryFetchCaption(fallbackBase);
    if (text) {
      return this.parseAndReturn(text, videoId, fallbackBase, undefined, preferredLang);
    }

    // Retry with kind=asr (auto-generated captions need this parameter)
    const replaced = fallbackBase.replace('fmt=json3', 'fmt=json3&kind=asr');
    const asrUrl = replaced !== fallbackBase ? replaced : `${fallbackBase}&kind=asr`;
    const asrText = await this.tryFetchCaption(asrUrl);
    if (asrText) {
      return this.parseAndReturn(asrText, videoId, asrUrl, undefined, preferredLang);
    }

    throw new Error(`Empty caption response received for video ${videoId}`);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchFromUrl(
    videoId: string,
    url: string,
    track: CaptionTrack | undefined,
    preferredLang: string
  ): Promise<Transcript> {
    const normalizedUrl = normalizeTimedTextUrl(url);
    const res = await this.fetchWithRetry(normalizedUrl);
    if (!res || !res.ok) {
      throw new Error(`Failed to fetch timedtext captions: ${res ? `${(res as any).status} ${(res as any).statusText}` : 'network error'}`);
    }
    const rawText = await res.text();
    if (!rawText.trim()) {
      throw new Error(`Empty caption response received for video ${videoId}`);
    }
    return this.parseAndReturn(rawText, videoId, normalizedUrl, track, preferredLang);
  }

  private parseAndReturn(
    rawText: string,
    videoId: string,
    url: string,
    track: CaptionTrack | undefined,
    preferredLang: string
  ): Transcript {
    const trimmed = rawText.trim();
    let rawSegments: Segment[];
    if (trimmed.startsWith('<')) {
      rawSegments = parseTimedTextXml(trimmed);
    } else {
      rawSegments = parseTimedTextJson(trimmed);
    }

    const mergedSegments = this.merger.merge(rawSegments);
    const sourceLanguage = track?.languageCode || preferredLang;
    const isAutoGenerated = track?.kind === 'asr' || url.includes('kind=asr');

    return {
      videoId,
      sourceLanguage,
      segments: mergedSegments,
      isAutoGenerated,
    };
  }
}
