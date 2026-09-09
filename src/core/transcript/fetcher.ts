import { CaptionTrack, PlayerResponseCaptions, Segment, Transcript } from '../../types/domain';
import { parseTimedTextJson, parseTimedTextXml } from './parser';
import { SentenceMerger } from './merger';

export interface TranscriptFetcherOptions {
  fetchFn?: typeof fetch;
  merger?: SentenceMerger;
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

  constructor(options: TranscriptFetcherOptions = {}) {
    this.fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined as any);
    this.merger = options.merger ?? new SentenceMerger();
  }

  /**
   * Extract caption tracks from a YouTube player response object
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
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        name,
        kind: track.kind === 'asr' ? 'asr' : undefined,
        isTranslatable: track.isTranslatable ?? false
      };
    });
  }

  /**
   * Extract player response JSON from raw YouTube watch page HTML
   */
  public extractPlayerResponseFromHtml(html: string): PlayerResponseCaptions | null {
    if (!html || typeof html !== 'string') return null;

    const pattern = /ytInitialPlayerResponse\s*=\s*({.+?});/s;
    const match = pattern.exec(html);
    if (!match || !match[1]) return null;

    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  /**
   * Select the best caption track for the given preferred language
   * Prioritizes author-uploaded manual CC (kind !== 'asr') over auto-generated CC (kind === 'asr').
   */
  public selectBestCaptionTrack(tracks: CaptionTrack[], preferredLang: string = 'en'): CaptionTrack | undefined {
    if (!tracks || tracks.length === 0) {
      return undefined;
    }

    const normalizedLang = preferredLang.toLowerCase().slice(0, 2);

    // 1. Exact match language, manual CC
    const exactManual = tracks.find(
      (t) => t.languageCode?.toLowerCase().startsWith(normalizedLang) && t.kind !== 'asr'
    );
    if (exactManual) return exactManual;

    // 2. Exact match language, auto-generated CC (asr)
    const exactAsr = tracks.find(
      (t) => t.languageCode?.toLowerCase().startsWith(normalizedLang) && t.kind === 'asr'
    );
    if (exactAsr) return exactAsr;

    // 3. Any manual CC
    const anyManual = tracks.find((t) => t.kind !== 'asr');
    if (anyManual) return anyManual;

    // 4. First available track
    return tracks[0];
  }

  /**
   * Fetch and parse timedtext captions into a consolidated Transcript with merged sentences
   */
  public async fetchTranscript(
    videoId: string,
    options: FetchTranscriptOptions = {}
  ): Promise<Transcript> {
    const preferredLang = options.preferredLang || 'en';
    let targetUrl = options.trackUrl;
    let selectedTrack: CaptionTrack | undefined;

    if (!targetUrl) {
      let tracks = options.captionTracks;
      if (!tracks && options.playerResponse) {
        tracks = this.extractCaptionTracks(options.playerResponse);
      }

      if (tracks && tracks.length > 0) {
        selectedTrack = this.selectBestCaptionTrack(tracks, preferredLang);
        if (selectedTrack) {
          targetUrl = selectedTrack.baseUrl;
        }
      } else if (options.captionTracks !== undefined && options.captionTracks.length === 0) {
        throw new Error(`No caption tracks found for video ${videoId}`);
      } else {
        // Direct fallback endpoint
        targetUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${preferredLang}&fmt=json3`;
      }
    }

    if (!targetUrl) {
      throw new Error(`No caption tracks found for video ${videoId}`);
    }

    const res = await this.fetchFn(targetUrl, { credentials: 'include' } as any);
    if (!res.ok) {
      throw new Error(`Failed to fetch timedtext captions: ${res.status} ${res.statusText}`);
    }

    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error(`Empty caption response received for video ${videoId}`);
    }

    let rawSegments: Segment[] = [];
    if (trimmed.startsWith('<')) {
      rawSegments = parseTimedTextXml(trimmed);
    } else {
      rawSegments = parseTimedTextJson(trimmed);
    }

    // Sentence restructuring via gap < 0.4s heuristic
    const mergedSegments = this.merger.merge(rawSegments);

    const sourceLanguage = selectedTrack?.languageCode || preferredLang;
    const isAutoGenerated = selectedTrack?.kind === 'asr' || targetUrl.includes('kind=asr');

    return {
      videoId,
      sourceLanguage,
      segments: mergedSegments,
      isAutoGenerated
    };
  }
}
