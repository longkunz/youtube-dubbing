/**
 * OrchestratorCoordinator
 *
 * Coordinates the full YouTube dubbing pipeline on watch pages:
 * 1. Detects video ID & retrieves YouTube player caption metadata.
 * 2. Fetches and merges timedtext transcript segments.
 * 3. Checks SegmentCache or delegates translation to Background Service Worker.
 * 4. Initializes DubbingOrchestratorImpl with BackgroundDubbingTtsClient.
 * 5. Binds HTMLVideoElement lifecycle events (timeupdate, seeking, play, pause).
 * 6. Reactively updates the in-player Cyber Cockpit Shadow DOM HUD.
 */

import { isPotTokenError, TranscriptFetcher } from '@/core/transcript/fetcher';
import { translatedLookaheadReady } from '@/core/transcript/lookahead';
import { isYoutubeTranslationOnlyFailure } from '@/core/transcript/youtube-caption-translation';
import { DubbingOrchestratorImpl } from '@/core/orchestrator/dubbing-orchestrator';
import { BackgroundDubbingTtsClient } from '@/core/tts/background-tts-client';
import { extractUnsignedAudioUrl, GroqWhisperClient } from '@/core/stt';
import { sendExtensionMessage } from '@/core/extension-runtime';
import { createTranslationClient } from '@/core/translation/factory';
import { SegmentCache } from '@/storage/segment-cache';
import {
  DEFAULT_GEMINI_MODEL,
  getSettings,
  YOUTUBE_CAPTION_TRANSLATION,
  type UserSettings,
} from '@/storage/settings';
import type { Transcript, Segment, CaptionTrack } from '@/types/domain';
import type { HudInstance } from './mount';
import { getActiveSubtitleInstance, type SubtitleOverlayInstance } from './subtitle-mount';

/**
 * Derive the cockpit Engine badge from user settings so the HUD reflects
 * the configured translation provider instead of a hardcoded label.
 */
export function resolveEngineLabel(settings?: Partial<UserSettings> | null): string {
  if (settings?.translationProvider === 'self-hosted') {
    return 'SELF-HOST';
  }
  if (settings?.translationProvider === YOUTUBE_CAPTION_TRANSLATION) {
    return 'YOUTUBE-CC';
  }
  if (settings?.translationProvider === 'openai-compatible') {
    const model = settings.openaiModel?.trim();
    return model ? model.toUpperCase() : 'OPENAI';
  }
  const geminiModel = settings?.geminiModel?.trim();
  return (geminiModel || DEFAULT_GEMINI_MODEL).toUpperCase();
}

/**
 * Circuit breaker for YouTube timedtext rate limiting (HTTP 429).
 *
 * 429s are issued per IP/session, not per video — hammering retries only
 * extends the throttle (and can starve the player's own caption requests,
 * visibly breaking native CC). When every candidate track fails with 429,
 * the video enters cooldown and subsequent pipeline runs skip fetching
 * entirely until it expires.
 */
export const TIMEDTEXT_THROTTLE_COOLDOWN_MS = 5 * 60 * 1000;

const throttledVideos = new Map<string, number>();

export function markVideoThrottled(videoId: string, nowMs: number = Date.now()): void {
  if (videoId) throttledVideos.set(videoId, nowMs);
}

export function isVideoThrottled(videoId: string, nowMs: number = Date.now()): boolean {
  const since = throttledVideos.get(videoId);
  if (since === undefined) return false;
  if (nowMs - since >= TIMEDTEXT_THROTTLE_COOLDOWN_MS) {
    throttledVideos.delete(videoId);
    return false;
  }
  return true;
}

export function clearVideoThrottleForTesting(): void {
  throttledVideos.clear();
}

/** True when a fetch failure means "throttled", not "no captions". */
export function isThrottleError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /http-429|429.*too many|too many.*429/i.test(message);
}

export interface CoordinatorState {
  activeVideoId: string | null;
  activeTargetLanguage: string | null;
  orchestrator: DubbingOrchestratorImpl | null;
  cleanupListeners: (() => void) | null;
  isInitializing: boolean;
  translationAbort: AbortController | null;
}

const state: CoordinatorState = {
  activeVideoId: null,
  activeTargetLanguage: null,
  orchestrator: null,
  cleanupListeners: null,
  isInitializing: false,
  translationAbort: null,
};

export function getCoordinatorState(): CoordinatorState {
  return state;
}

/**
 * Extract YouTube video ID from URL search params or /shorts/ path.
 */
export function extractVideoId(urlStr?: string): string | null {
  try {
    const loc = urlStr ? new URL(urlStr) : (typeof window !== 'undefined' ? window.location : null);
    if (!loc) return null;

    const params = new URLSearchParams(loc.search);
    const v = params.get('v');
    if (v) return v;

    const shortsMatch = loc.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
  } catch {}
  return null;
}

/**
 * Extract caption tracks directly from YouTube's in-DOM movie_player instance.
 *
 * NOTE: getOption('captions', 'tracklist') only returns language metadata
 * — no baseUrl. Useful as existence proof but not for fetching.
 * NOTE: This method is NOT accessible from isolated world (player methods are
 * defined in MAIN world). Use readBridgedAudioTracks() for production use.
 */
export function getTracksFromMoviePlayer(): CaptionTrack[] {
  if (typeof document === 'undefined') return [];
  try {
    const player = document.getElementById('movie_player') as any;
    if (player && typeof player.getOption === 'function') {
      const tracklist = player.getOption('captions', 'tracklist');
      if (Array.isArray(tracklist) && tracklist.length > 0) {
        return tracklist.map((t: any) => ({
          baseUrl: t.baseUrl ?? t.url ?? '',
          languageCode: t.languageCode,
          name: typeof t.name === 'string' ? t.name : (t.name?.simpleText || t.displayName || t.languageName || ''),
          kind: t.kind === 'asr' ? 'asr' : undefined,
          isTranslatable: t.isTranslatable,
        }));
      }
    }
  } catch {}
  return [];
}

/**
 * Extract POT-bearing caption URLs from the initialized player's audio track.
 *
 * NOTE: player.getAudioTrack() is a MAIN-world method — NOT accessible from
 * isolated world in production. This function works in test environments and
 * MAIN world scripts only. Use readBridgedAudioTracks() from isolated world.
 */
export function getTracksFromPlayerAudioTrack(): CaptionTrack[] {
  if (typeof document === 'undefined') return [];
  try {
    const player = document.getElementById('movie_player') as any;
    const captionTracks = player?.getAudioTrack?.()?.captionTracks;
    if (Array.isArray(captionTracks) && captionTracks.length > 0) {
      const mapped = captionTracks
        .map((t: any) => ({
          baseUrl: t?.url ?? t?.baseUrl ?? '',
          languageCode: t?.languageCode,
          name:
            t?.name?.simpleText ||
            (Array.isArray(t?.name?.runs) ? t.name.runs.map((r: any) => r.text).join('') : '') ||
            t?.displayName ||
            t?.languageName ||
            '',
          kind: t?.kind === 'asr' ? 'asr' : undefined,
          isTranslatable: t?.isTranslatable,
        }))
        .filter((t: any) => typeof t.baseUrl === 'string' && t.baseUrl.length > 0 && typeof t.languageCode === 'string');
      // Prefer URLs that already carry a minted Proof-of-Origin token.
      return sortPotFirst(mapped);
    }
  } catch {}
  return [];
}

/**
 * True when a caption track URL already carries a minted Proof-of-Origin
 * token. Tracks without `pot=` but with `exp=xpe` fetch as HTTP 200 with an
 * empty body — they prove captions EXIST but are not yet downloadable.
 */
export function trackHasPot(track: CaptionTrack): boolean {
  return typeof track.baseUrl === 'string' && track.baseUrl.includes('pot=');
}

/**
 * Sort helper: POT-bearing URLs first (they are the only downloadable ones).
 */
export function sortPotFirst(tracks: CaptionTrack[]): CaptionTrack[] {
  return [...tracks].sort((a, b) => {
    const aPot = trackHasPot(a) ? 0 : 1;
    const bPot = trackHasPot(b) ? 0 : 1;
    return aPot - bPot;
  });
}

/**
 * Static ytInitialPlayerResponse timedtext URLs are also exp=xpe gated.
 * If the bridge already proved captions exist but POT is not minted yet,
 * fetching those static URLs only burns 429 budget on empty bodies.
 */
export function shouldSkipStaticPlayerResponseFallback(tracks: CaptionTrack[]): boolean {
  if (!tracks.length) return false;
  return tracks.every((track) => {
    const url = track.baseUrl ?? '';
    return url.includes('exp=xpe') && !trackHasPot(track);
  });
}

/**
 * Read POT-bearing audio track caption URLs from the DOM attribute written by
 * content-bridge.ts (MAIN world). Safe to call from isolated world.
 *
 * Returns [] if the bridge hasn't populated the attribute yet or if the data
 * is for a different video. Returned tracks are POT-first sorted.
 */
export function readBridgedAudioTracks(videoId: string): CaptionTrack[] {
  if (typeof document === 'undefined') return [];
  try {
    const json = document.documentElement.getAttribute('data-aetherdub-at');
    if (!json) return [];
    const data = JSON.parse(json);
    if (!data?.tracks || !Array.isArray(data.tracks)) return [];
    // Ensure bridged data is for this video
    if (videoId && data.videoId && data.videoId !== videoId) return [];
    const tracks = data.tracks.map((t: any) => ({
      baseUrl: t.url ?? t.baseUrl ?? '',
      languageCode: t.languageCode ?? '',
      kind: t.kind === 'asr' ? 'asr' : undefined,
      name: t.name ?? '',
      isTranslatable: t.isTranslatable,
    })).filter((t: CaptionTrack) => !!t.baseUrl && !!t.languageCode);
    return sortPotFirst(tracks);
  } catch {
    return [];
  }
}

/**
 * Wait for the MAIN-world bridge (content-bridge.ts) to populate the
 * data-aetherdub-at attribute with POT-bearing caption tracks. Polls up to
 * timeoutMs before giving up.
 *
 * The player exposes caption tracks BEFORE BotGuard mints the POT, so tracks
 * without `pot=` are NOT accepted immediately — we keep waiting for the
 * POT-bearing version (same lesson as asbplayer#978 P2). On timeout we
 * return best-effort (POT-first) so the caller can still report "captions
 * exist but download failed" instead of "no captions".
 */
export async function waitForAudioCaptionTracks(
  videoId: string,
  timeoutMs: number = 8000,
  pollIntervalMs: number = 250
): Promise<CaptionTrack[]> {
  const deadline = Date.now() + timeoutMs;
  let bestEffort: CaptionTrack[] = [];
  for (;;) {
    // Primary: read from bridge attribute (works from isolated world)
    const bridged = readBridgedAudioTracks(videoId);
    if (bridged.length > 0) {
      bestEffort = bridged;
      if (bridged.some(trackHasPot)) return bridged;
    } else {
      // Fallback: direct call (only works in MAIN world / test environment)
      const direct = getTracksFromPlayerAudioTrack();
      if (direct.length > 0) {
        if (!videoId) {
          if (direct.some(trackHasPot)) return direct;
          bestEffort = direct;
        } else {
          try {
            const forVideo = direct.filter((t) => {
              const v = new URL(t.baseUrl, 'https://www.youtube.com').searchParams.get('v');
              return !v || v === videoId;
            });
            if (forVideo.length > 0) {
              bestEffort = forVideo;
              if (forVideo.some(trackHasPot)) return forVideo;
            }
          } catch {
            bestEffort = direct;
            if (direct.some(trackHasPot)) return direct;
          }
        }
      }
    }

    if (Date.now() >= deadline) return bestEffort;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export interface ActiveCaptionState {
  /** Player reports a selected caption track via getOption('captions', 'track'). */
  trackActive: boolean;
  /** CC toolbar button shows aria-pressed="true". */
  buttonPressed: boolean;
  /** At least one rendered caption cue is present in the DOM. */
  visibleCues: boolean;
  /** Language of the active track, when exposed by the player. */
  activeLanguageCode?: string;
  /** True when ANY of the above signals indicates CC is on. */
  ccEvidence: boolean;
}

/**
 * Detect whether closed captions are currently enabled/visible in the player.
 * When CC is demonstrably on, a download failure is a fetch/POT problem, not
 * a missing-caption problem.
 */
export function getActiveCaptionState(): ActiveCaptionState {
  const ccState: ActiveCaptionState = {
    trackActive: false,
    buttonPressed: false,
    visibleCues: false,
    activeLanguageCode: undefined,
    ccEvidence: false,
  };
  if (typeof document === 'undefined') return ccState;

  try {
    const player = document.getElementById('movie_player') as any;
    const track = player?.getOption?.('captions', 'track');
    if (track && typeof track === 'object' && Object.keys(track).length > 0) {
      ccState.trackActive = true;
      if (typeof track.languageCode === 'string' && track.languageCode.length > 0) {
        ccState.activeLanguageCode = track.languageCode;
      }
    }
  } catch {}

  try {
    const button = document.querySelector('.ytp-subtitles-button');
    ccState.buttonPressed = button?.getAttribute?.('aria-pressed') === 'true';
  } catch {}

  try {
    ccState.visibleCues = !!document.querySelector('.ytp-caption-segment');
  } catch {}

  ccState.ccEvidence = ccState.trackActive || ccState.buttonPressed || ccState.visibleCues;
  return ccState;
}

// ── Player Response Bridge ────────────────────────────────────────────────────

/**
 * Wait for content-bridge.ts (MAIN world) to write the player response to the
 * data-aetherdub-pr DOM attribute. Polls up to maxWaitMs.
 */
async function readBridgedPlayerResponse(videoId: string, maxWaitMs = 1500): Promise<any> {
  const ATTR = 'data-aetherdub-pr';
  const poll = 50;

  for (let elapsed = 0; elapsed <= maxWaitMs; elapsed += poll) {
    const json = document.documentElement.getAttribute(ATTR);
    if (json) {
      try {
        const pr = JSON.parse(json);
        if (!videoId || pr?.videoDetails?.videoId === videoId) {
          return pr;
        }
      } catch {}
    }
    if (elapsed < maxWaitMs) {
      await new Promise<void>((r) => setTimeout(r, poll));
    }
  }
  return null;
}

/**
 * Manually refresh the data-aetherdub-pr DOM attribute from
 * window.ytInitialPlayerResponse. In production this is done automatically
 * by content-bridge.ts (MAIN world); this exported version lets unit tests
 * trigger the bridge behaviour without a real MAIN world script.
 */
export function bridgePlayerResponseToDOM(videoId?: string): void {
  if (typeof document === 'undefined') return;
  try {
    const pr = (typeof window !== 'undefined') ? (window as any).ytInitialPlayerResponse : undefined;
    if (!pr || !pr.videoDetails) return;
    if (videoId && pr.videoDetails.videoId !== videoId) return;
    document.documentElement.setAttribute('data-aetherdub-pr', JSON.stringify(pr));
  } catch {}
}

/**
 * Retrieve YouTube player response containing captionTracks.
 *
 * Primary: DOM attribute written by content-bridge.ts running in MAIN world.
 * Fallback: Fetch watch page HTML + balanced-brace extraction.
 */
export async function getPlayerResponse(videoId: string): Promise<any> {
  if (typeof document !== 'undefined') {
    const pr = await readBridgedPlayerResponse(videoId);
    if (pr) {
      console.log('[AetherDub] Got player response from MAIN-world bridge');
      return pr;
    }
    console.warn('[AetherDub] MAIN-world bridge did not populate data-aetherdub-pr within timeout');
  }

  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: 'include',
    });
    if (res.ok) {
      const html = await res.text();
      const fetcher = new TranscriptFetcher();
      const pr = fetcher.extractPlayerResponseFromHtml(html);
      if (pr) {
        console.log('[AetherDub] Got player response from HTML fetch fallback');
        return pr;
      }
    }
  } catch (err) {
    console.warn('[AetherDub] Failed to fetch watch page HTML for player response:', err);
  }

  return null;
}

// ── Translation Bridge ────────────────────────────────────────────────────────

export const TRANSLATE_BATCH_SIZE = 8;
export const TRANSLATE_BATCH_TIMEOUT_MS = 90000;
export const TRANSLATE_LOOKAHEAD_SECONDS = 60;

export interface TranslateViaBackgroundOptions {
  /** Segments per background message (default 8). Smaller = faster first Dub Track. */
  batchSize?: number;
  /** Per-batch timeout in ms (default 90000). */
  batchTimeoutMs?: number;
  /**
   * Fired after each successful batch with the segments translated so far
   * (merged onto the original transcript order). Lets the pipeline start
   * TTS after batch 1 instead of waiting for the whole video.
   */
  onBatch?: (
    translatedSoFar: Segment[],
    batchNo: number,
    batchCount: number,
  ) => void | Promise<void>;
  signal?: AbortSignal;
}

async function translateSegmentsInProcess(
  segments: Segment[],
  targetLanguage: string,
  settings: unknown,
): Promise<Segment[]> {
  const client = createTranslationClient(settings as Partial<UserSettings> | undefined);
  return client.translateSegments(segments, { targetLanguage });
}

async function sendTranslateBatch(
  segments: Segment[],
  targetLanguage: string,
  settings: unknown,
  batchTimeoutMs: number
): Promise<Segment[]> {
  try {
    const res = await sendExtensionMessage<{ success?: boolean; segments?: Segment[]; error?: string }>(
      {
        action: 'TRANSLATE_SEGMENTS',
        segments,
        targetLanguage,
        settings,
      },
      batchTimeoutMs,
    );
    if (!res?.success || !res.segments) {
      throw new Error(res?.error || 'Translation failed in background');
    }
    return res.segments;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/unavailable|Receiving end does not exist|Extension context invalidated/i.test(message)) {
      throw err;
    }
    console.warn('[AetherDub] Background messaging failed; translating in content script:', message);
    return translateSegmentsInProcess(segments, targetLanguage, settings);
  }
}

/**
 * Delegate translation to Background Service Worker via message passing
 * to bypass host page CSP & CORS restrictions.
 *
 * Sends segments in sequential batches (default 15/message) instead of one
 * giant request: a full transcript in a single message can exceed the
 * 90s round-trip (slow proxy/model), which previously surfaced as
 * "Translation request timed out after 30s" with no partial progress.
 */
function mergeTranslatedOntoOriginal(original: Segment[], translated: Segment[]): Segment[] {
  const byId = new Map(translated.map((segment) => [segment.id, segment]));
  return original.map((segment) => {
    const hit = byId.get(segment.id);
    return hit ? { ...segment, ...hit } : segment;
  });
}

export async function translateViaBackground(
  transcript: Transcript,
  targetLanguage: string,
  options: TranslateViaBackgroundOptions = {}
): Promise<Transcript> {
  const settings = await getSettings();
  const batchSize = Math.max(1, options.batchSize ?? TRANSLATE_BATCH_SIZE);
  const batchTimeoutMs = options.batchTimeoutMs ?? TRANSLATE_BATCH_TIMEOUT_MS;
  const segments = transcript.segments;
  const translated: Segment[] = [];
  const batchCount = Math.max(1, Math.ceil(segments.length / batchSize));
  let lastError: unknown;

  for (let i = 0; i < segments.length; i += batchSize) {
    if (options.signal?.aborted) {
      break;
    }
    const batch = segments.slice(i, i + batchSize);
    const batchNo = Math.floor(i / batchSize) + 1;
    console.log(`[AetherDub] Translating batch ${batchNo}/${batchCount} (${batch.length} segments)`);
    try {
      const done = await sendTranslateBatch(batch, targetLanguage, settings, batchTimeoutMs);
      translated.push(...done);
      const soFar = mergeTranslatedOntoOriginal(segments, translated);
      await options.onBatch?.(soFar, batchNo, batchCount);
    } catch (err) {
      lastError = err;
      console.warn(
        `[AetherDub] Translation batch ${batchNo}/${batchCount} failed; keeping ${translated.length} translated segment(s):`,
        err,
      );
    }
  }

  if (translated.length === 0) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Translation failed in background');
  }

  return {
    ...transcript,
    targetLanguage,
    segments: mergeTranslatedOntoOriginal(segments, translated),
  };
}

/**
 * Whisper STT fallback (Groq BYOK) used only after caption fetch failed.
 * Requires an unsigned audio URL in playerResponse.streamingData.
 */
export async function tryWhisperTranscriptFallback(
  videoId: string,
  playerResponse?: unknown,
): Promise<Transcript | null> {
  const settings = await getSettings().catch(() => null);
  const groqApiKey = settings?.groqApiKey?.trim();
  if (!groqApiKey) {
    console.warn('[AetherDub] Whisper fallback skipped: no Groq API key');
    return null;
  }

  let pr = playerResponse;
  if (!pr) {
    pr = await getPlayerResponse(videoId);
  }
  const audioUrl = extractUnsignedAudioUrl(pr);
  if (!audioUrl) {
    console.warn('[AetherDub] Whisper fallback skipped: no unsigned audio URL (ciphered or missing)');
    return null;
  }

  try {
    const segments = await transcribeAudioViaBackground(audioUrl, groqApiKey);
    if (!segments.length) return null;
    console.log(`[AetherDub] Whisper fallback produced ${segments.length} segments`);
    return {
      videoId,
      sourceLanguage: 'und',
      segments,
      isAutoGenerated: true,
    };
  } catch (err) {
    console.warn('[AetherDub] Whisper fallback failed:', err);
    return null;
  }
}

function transcribeAudioViaBackground(audioUrl: string, groqApiKey: string): Promise<Segment[]> {
  return sendExtensionMessage<{ success?: boolean; segments?: Segment[]; error?: string }>(
    { action: 'TRANSCRIBE_AUDIO', audioUrl, groqApiKey },
    120_000,
  ).then((res) => {
    if (!res?.success || !res.segments) {
      throw new Error(res?.error || 'Whisper transcription failed');
    }
    return res.segments;
  });
}

/** @internal Test seam — transcribe a blob with Groq without the background worker. */
export async function transcribeBlobWithGroq(
  audio: Blob,
  apiKey: string,
  fetchFn?: typeof fetch,
): Promise<Segment[]> {
  const client = new GroqWhisperClient({ apiKey, fetchFn });
  return client.transcribeBlob(audio);
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Stop and destroy active orchestrator and remove video event listeners.
 */
export function stopDubbingPipeline(): void {
  if (state.cleanupListeners) {
    state.cleanupListeners();
    state.cleanupListeners = null;
  }
  if (state.orchestrator) {
    state.orchestrator.destroy();
    state.orchestrator = null;
  }
  state.translationAbort?.abort();
  state.translationAbort = null;
  state.activeVideoId = null;
  state.activeTargetLanguage = null;

  if (!subOnlyState.activeVideoId) {
    const subInstance = getActiveSubtitleInstance();
    subInstance?.setSegment(null);
  }
}

/**
 * Start or re-align the dubbing pipeline for the current video.
 *
 * Caption track priority:
 *  1. POT-bearing URLs from MAIN-world bridge (data-aetherdub-at) — most
 *     reliable; bridge polls player.getAudioTrack() for up to 10 s.
 *  2. Static URLs from ytInitialPlayerResponse (data-aetherdub-pr) — may be
 *     exp=xpe gated but used as fallback when audio track not yet available.
 */
export async function startDubbingPipeline(
  instance: HudInstance,
  targetVideoElement?: HTMLVideoElement,
  requestedTargetLanguage: string = 'vi',
): Promise<DubbingOrchestratorImpl | null> {
  const videoId = extractVideoId();
  if (!videoId) {
    return null;
  }

  const video =
    targetVideoElement ||
    (document.querySelector('video.html5-main-video') as HTMLVideoElement | null) ||
    (document.querySelector('video') as HTMLVideoElement | null);

  if (!video) {
    return null;
  }

  const targetLanguage = requestedTargetLanguage.trim() || 'vi';

  // Already initialized for this video + language — reuse the running orchestrator
  if (
    state.activeVideoId === videoId &&
    state.activeTargetLanguage === targetLanguage &&
    state.orchestrator
  ) {
    instance.updateOrchestrator?.(state.orchestrator);
    return state.orchestrator;
  }

  // Circuit breaker: this video was recently throttled (HTTP 429). Skip
  // fetching until cooldown expires — retries only extend YouTube's throttle.
  if (isVideoThrottled(videoId)) {
    console.warn(
      `[AetherDub] Skipping caption fetch for video ${videoId}: throttled recently (HTTP 429 cooldown). ` +
        `Try again in a few minutes or switch networks.`
    );
    instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
    return null;
  }

  // Prevent concurrent in-flight launches for the same video
  if (state.isInitializing && state.activeVideoId === videoId) {
    return null;
  }

  // If previous attempt failed (no orchestrator, not initializing), allow retry.
  // This happens when the bridge event fires after the first attempt gave up.

  // Clean up any stale orchestrator
  stopDubbingPipeline();
  state.activeVideoId = videoId;
  state.isInitializing = true;

  console.log('[AetherDub] Starting dubbing pipeline for video:', videoId);

  try {
    // Sync the cockpit Engine badge with the configured translation provider.
    let settings: UserSettings | null = null;
    try {
      settings = await getSettings();
      instance.updateProps?.({ engineLabel: resolveEngineLabel(settings) });
    } catch {
      // Non-fatal: HUD keeps its default badge.
    }
    const translationProvider = settings?.translationProvider ?? 'gemini';

    const fetcher = new TranscriptFetcher();
    const cache = new SegmentCache();

    // ── 0. Cache-first: a fully translated transcript needs ZERO timedtext
    // requests and ZERO translation tokens. Previously the raw captions were
    // fetched on every page load even for cached videos — pure throttle fuel.
    let translatedTranscript = await cache
      .getTranscript(videoId, targetLanguage, translationProvider)
      .catch(() => null);
    if (translatedTranscript && translatedTranscript.segments.length > 0) {
      if (translatedTranscript.segments.some((s) => s.duration > 15)) {
        console.log('[AetherDub] Invalidating stale cached transcript with oversized segments (>15s)');
        translatedTranscript = null;
      } else {
        console.log('[AetherDub] Reusing cached transcript from IndexedDB (0 timedtext requests, 0ms latency)');
      }
    } else {
      translatedTranscript = null;
    }

    // ── 1. Resolve caption tracks ──────────────────────────────────────────
    // Try POT-bearing audio track URLs first (bridge polls up to 8 s).
    // Fall back to static playerResponse URLs if audio track not available.
    let captionTracks: CaptionTrack[] | undefined;
    let playerResponse: any;

    if (!translatedTranscript) {
      const audioTracks = await waitForAudioCaptionTracks(videoId, 8000);
      if (audioTracks.length > 0) {
        const potCount = audioTracks.filter(trackHasPot).length;
        console.log(`[AetherDub] Using ${audioTracks.length} audio track URL(s) from bridge (${potCount} with pot)`);
        if (potCount === 0) {
          console.warn('[AetherDub] Bridge tracks carry no POT yet — waiting extra for mint, skipping static playerResponse fallback');
          const extra = await waitForAudioCaptionTracks(videoId, 4000);
          captionTracks = extra.length > 0 ? extra : audioTracks;
        } else {
          captionTracks = audioTracks;
        }
      }

      if (!captionTracks?.some(trackHasPot) && !shouldSkipStaticPlayerResponseFallback(captionTracks ?? [])) {
        console.warn('[AetherDub] Audio track bridge timeout — falling back to playerResponse');
        playerResponse = await getPlayerResponse(videoId);
        console.log('[AetherDub] Player response found:', !!playerResponse,
          '| captions:', !!(playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
            playerResponse?.playerCaptionsTracklistRenderer?.captionTracks));
      }

      const preferredLang = getActiveCaptionState().activeLanguageCode || 'en';

      if (translationProvider === YOUTUBE_CAPTION_TRANSLATION) {
        try {
          translatedTranscript = await fetcher.fetchYoutubeCaptionTranslation(videoId, {
            playerResponse,
            captionTracks,
            preferredLang,
            targetLanguage,
          });
          if (!translatedTranscript.segments.length) {
            translatedTranscript = null;
            throw new Error(`Empty caption response received for video ${videoId}`);
          }
          try {
            await cache.saveTranscript(translatedTranscript, translationProvider);
          } catch (cacheErr) {
            console.warn('[AetherDub] Failed to cache YouTube Caption Translation transcript:', cacheErr);
          }
        } catch (err: unknown) {
          if (isThrottleError(err)) {
            markVideoThrottled(videoId);
            console.warn(
              `[AetherDub] Timedtext throttled (HTTP 429) for video ${videoId} — cooling down for ${TIMEDTEXT_THROTTLE_COOLDOWN_MS / 60000} min.`,
            );
          } else {
            console.warn('[AetherDub] YouTube Caption Translation failed:', err);
          }

          const allowWhisper =
            !isYoutubeTranslationOnlyFailure(err) &&
            !isThrottleError(err);

          if (allowWhisper) {
            await tryWhisperTranscriptFallback(videoId, playerResponse);
          }

          instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
          return null;
        }
      }

      // ── 2. Fetch transcript (LLM providers only) ─────────────────────────
      let rawTranscript: Transcript | null = null;
      if (!translatedTranscript) {
      try {
        rawTranscript = await fetcher.fetchTranscript(videoId, {
          playerResponse,
          captionTracks,
          preferredLang,
        });
      } catch (err: unknown) {
        if (isThrottleError(err)) {
          markVideoThrottled(videoId);
          console.warn(
            `[AetherDub] Timedtext throttled (HTTP 429) for video ${videoId} — cooling down for ${TIMEDTEXT_THROTTLE_COOLDOWN_MS / 60000} min. ` +
              `Further attempts will be skipped until then.`
          );
        } else if (isPotTokenError(err) || getActiveCaptionState().ccEvidence) {
          console.warn('[AetherDub] Caption fetch failed with POT/CC evidence — retrying POT mint:', err);
          const retryTracks = await waitForAudioCaptionTracks(videoId, 4000);
          if (retryTracks.some(trackHasPot)) {
            try {
              rawTranscript = await fetcher.fetchTranscript(videoId, {
                captionTracks: retryTracks,
                preferredLang,
              });
            } catch (retryErr: unknown) {
              console.warn('[AetherDub] POT retry failed:', retryErr);
            }
          }
        } else {
          console.warn('[AetherDub] No captions available:', err);
        }

        if (!rawTranscript) {
          rawTranscript = await tryWhisperTranscriptFallback(videoId, playerResponse);
        }

        if (!rawTranscript) {
          instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
          return null;
        }
      }

      if (!rawTranscript || rawTranscript.segments.length === 0) {
        console.warn('[AetherDub] Transcript has 0 segments');
        instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
        return null;
      }

      const sourceTranscript: Transcript = rawTranscript;

      // ── 3. Translate (stream first batch so TTS can start) + cache when complete
      console.log('[AetherDub] Translating transcript to', targetLanguage);
      state.translationAbort?.abort();
      state.translationAbort = new AbortController();
      const translationSignal = state.translationAbort.signal;

      const ttsClient = new BackgroundDubbingTtsClient();
      const orchestrator = new DubbingOrchestratorImpl(video, {
        ttsClient,
        defaultVoice: 'vi-VN-HoaiMyNeural',
        femaleVoice: 'vi-VN-HoaiMyNeural',
        maleVoice: 'vi-VN-NamMinhNeural',
        diarizationEnabled: false,
      });

      let playbackReleased = false;
      const releasePlayback = async (partial: Transcript): Promise<void> => {
        if (translationSignal.aborted) return;
        if (playbackReleased) {
          orchestrator.mergeTranslatedSegments(partial.segments);
          orchestrator.handleTimeUpdate(video.currentTime);
          return;
        }
        playbackReleased = true;
        await orchestrator.init(videoId, partial, {
          targetLanguage,
          duckLevel: 0.2,
          lookaheadSeconds: TRANSLATE_LOOKAHEAD_SECONDS,
          diarizationEnabled: false,
        });
        if (orchestrator.primeInitialLookahead) {
          try {
            await orchestrator.primeInitialLookahead(video.currentTime);
          } catch (primeErr) {
            console.warn('[AetherDub] Lookahead priming warning:', primeErr);
          }
        }
        state.orchestrator = orchestrator;
        state.activeTargetLanguage = targetLanguage;
        instance.updateOrchestrator?.(orchestrator);
        instance.updateProps?.({ hasCaptions: true, isNoCaptions: false });

        const onTimeUpdate = () => orchestrator.handleTimeUpdate(video.currentTime);
        const onSeek = () => orchestrator.handleSeek(video.currentTime);
        const onPlay = () => orchestrator.handlePlay();
        const onPause = () => orchestrator.handlePause();
        const onRateChange = () => orchestrator.handleRateChange(video.playbackRate);

        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('seeking', onSeek);
        video.addEventListener('seeked', onSeek);
        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('ratechange', onRateChange);

        state.cleanupListeners = () => {
          video.removeEventListener('timeupdate', onTimeUpdate);
          video.removeEventListener('seeking', onSeek);
          video.removeEventListener('seeked', onSeek);
          video.removeEventListener('play', onPlay);
          video.removeEventListener('pause', onPause);
          video.removeEventListener('ratechange', onRateChange);
        };

        if (!video.paused) {
          orchestrator.handlePlay();
          orchestrator.handleTimeUpdate(video.currentTime);
        }
        console.log('[AetherDub] Dubbing pipeline initialized after first translated batch for', videoId);
      };

      let settleFirst: (value: DubbingOrchestratorImpl | null) => void;
      let firstSettled = false;
      const firstBatchReady = new Promise<DubbingOrchestratorImpl | null>((resolve) => {
        settleFirst = resolve;
      });
      const settleFirstOnce = (value: DubbingOrchestratorImpl | null) => {
        if (firstSettled) return;
        firstSettled = true;
        settleFirst(value);
      };

      void translateViaBackground(sourceTranscript, targetLanguage, {
        signal: translationSignal,
        onBatch: async (soFar) => {
          const partial: Transcript = {
            ...sourceTranscript,
            targetLanguage,
            segments: soFar,
          };
          if (
            !playbackReleased &&
            !translatedLookaheadReady(soFar, video.currentTime, TRANSLATE_LOOKAHEAD_SECONDS)
          ) {
            return;
          }
          await releasePlayback(partial);
          settleFirstOnce(orchestrator);
        },
      })
        .then(async (full) => {
          translatedTranscript = full;
          const complete = full.segments.every((segment) => Boolean(segment.translatedText));
          if (complete) {
            try {
              await cache.saveTranscript(full, translationProvider);
            } catch (cacheErr) {
              console.warn('[AetherDub] Failed to cache transcript in IndexedDB:', cacheErr);
            }
          } else {
            console.warn(
              '[AetherDub] Translation finished with gaps; not caching incomplete transcript',
            );
          }
          if (!playbackReleased) {
            await releasePlayback(full);
          } else {
            orchestrator.mergeTranslatedSegments(full.segments);
            orchestrator.handleTimeUpdate(video.currentTime);
          }
          settleFirstOnce(state.orchestrator);
        })
        .catch((err) => {
          console.error('[AetherDub] Translation stream failed:', err);
          settleFirstOnce(state.orchestrator);
        });

      const ready = await firstBatchReady;
      if (!ready) {
        instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
        return null;
      }
      return ready;
      }
    }

    // ── Cache-hit path: initialize immediately ────────────────────────────
    const ttsClient = new BackgroundDubbingTtsClient();
    const orchestrator = new DubbingOrchestratorImpl(video, {
      ttsClient,
      defaultVoice: 'vi-VN-HoaiMyNeural',
      femaleVoice: 'vi-VN-HoaiMyNeural',
      maleVoice: 'vi-VN-NamMinhNeural',
      diarizationEnabled: false,
    });

    await orchestrator.init(videoId, translatedTranscript, {
      targetLanguage,
      duckLevel: 0.2,
      lookaheadSeconds: 60,
      diarizationEnabled: false,
    });

    if (orchestrator.primeInitialLookahead) {
      try {
        await orchestrator.primeInitialLookahead(video.currentTime);
      } catch (primeErr) {
        console.warn('[AetherDub] Lookahead priming warning:', primeErr);
      }
    }

    state.orchestrator = orchestrator;
    state.activeTargetLanguage = targetLanguage;

    instance.updateOrchestrator?.(orchestrator);
    instance.updateProps?.({ hasCaptions: true, isNoCaptions: false });

    const onTimeUpdate = () => orchestrator.handleTimeUpdate(video.currentTime);
    const onSeek = () => orchestrator.handleSeek(video.currentTime);
    const onPlay = () => orchestrator.handlePlay();
    const onPause = () => orchestrator.handlePause();
    const onRateChange = () => orchestrator.handleRateChange(video.playbackRate);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeking', onSeek);
    video.addEventListener('seeked', onSeek);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ratechange', onRateChange);

    state.cleanupListeners = () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeking', onSeek);
      video.removeEventListener('seeked', onSeek);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ratechange', onRateChange);
    };

    if (!video.paused) {
      orchestrator.handlePlay();
      orchestrator.handleTimeUpdate(video.currentTime);
    }

    console.log('[AetherDub] Dubbing pipeline initialized and active for', videoId);
    return orchestrator;
  } catch (err: any) {
    console.error('[AetherDub] Dubbing pipeline initialization failed:', err);
    return null;
  } finally {
    state.isInitializing = false;
  }
}

// ── On-Demand Activation ─────────────────────────────────────────────────────

/**
 * Callbacks the HUD provides so activateDubbing can update UI state without
 * coupling to React internals.
 */
export interface ActivationHudCallbacks {
  /** Show/hide the Preparation Overlay and set its mode */
  setPreparationMode: (mode: 'preparing' | 'autoplay-blocked' | null) => void;
  /** Mark the pipeline as enabled (dubbing is active) */
  setEnabled: (enabled: boolean) => void;
  /** Show an error notification in the HUD */
  setError: (msg: string | null) => void;
}

/** Result returned from activateDubbing so callers know the outcome. */
export type ActivationResult =
  | 'cache-hit'
  | 'success'
  | 'cancelled'
  | 'error';

/** Overall watchdog budget per ADR-0008 §6. */
export const ACTIVATION_WATCHDOG_MS = 60_000;

/**
 * activateDubbing — user-triggered On-Demand Activation (ADR-0008).
 *
 * Zero-jank cache-hit fast path (no pause) + pause-and-buffer for cache miss.
 * Armed with AbortSignal for immediate cancellation at any point.
 */
export async function activateDubbing(
  video: HTMLVideoElement,
  instance: HudInstance,
  hud: ActivationHudCallbacks,
  signal: AbortSignal,
  videoId?: string,
  /** @internal Injectable for testing only — defaults to startDubbingPipeline */
  _pipelineFn?: typeof startDubbingPipeline,
  requestedTargetLanguage: string = 'vi',
): Promise<ActivationResult> {
  const pipelineFn = _pipelineFn ?? startDubbingPipeline;
  const vid = videoId ?? extractVideoId();
  if (!vid) {
    hud.setError('No video ID found');
    return 'error';
  }

  const targetLanguage = requestedTargetLanguage.trim() || 'vi';
  const cache = new SegmentCache();

  // ── 0. Cache fast-path ─────────────────────────────────────────────────────
  const settings = await getSettings().catch(() => null);
  const translationProvider = settings?.translationProvider ?? 'gemini';
  const cachedTranscript = await cache
    .getTranscript(vid, targetLanguage, translationProvider)
    .catch(() => null);
  const cacheHit = !!(cachedTranscript && cachedTranscript.segments.length > 0);

  if (cacheHit) {
    console.log('[AetherDub] Cache hit — activating dubbing without pause');
    try {
      await _initOrchestrator(video, instance, cachedTranscript!, vid, targetLanguage);
      hud.setEnabled(true);
      hud.setPreparationMode(null);
      hud.setError(null);
      return 'cache-hit';
    } catch (err) {
      console.error('[AetherDub] Orchestrator init failed on cache hit:', err);
      hud.setEnabled(false);
      hud.setError('Orchestrator initialization failed');
      return 'error';
    }
  }

  // ── 1. Pause + overlay for cache-miss ─────────────────────────────────────
  const wasPaused = video.paused;
  if (!wasPaused) video.pause();
  hud.setPreparationMode('preparing');

  let resumed = false;
  const resumeVideo = () => {
    if (resumed) return;
    resumed = true;
    hud.setPreparationMode(null);
    if (!wasPaused) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          hud.setPreparationMode('autoplay-blocked');
        });
      }
    }
  };

  const abortHandler = () => { resumeVideo(); };
  signal.addEventListener('abort', abortHandler, { once: true });

  const watchdogId = setTimeout(() => {
    console.warn('[AetherDub] Activation watchdog expired (60 s)');
  }, ACTIVATION_WATCHDOG_MS);

  try {
    if (signal.aborted) {
      clearTimeout(watchdogId);
      return 'cancelled';
    }

    const orchestrator = await pipelineFn(instance, video, targetLanguage);

    if (signal.aborted) {
      clearTimeout(watchdogId);
      resumeVideo();
      return 'cancelled';
    }

    clearTimeout(watchdogId);

    if (!orchestrator) {
      resumeVideo();
      hud.setEnabled(false);
      hud.setError('Could not load captions for this video');
      return 'error';
    }

    hud.setEnabled(true);
    hud.setError(null);
    hud.setPreparationMode(null);

    if (!wasPaused) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          hud.setPreparationMode('autoplay-blocked');
        });
      }
    }

    return 'success';
  } catch (err) {
    clearTimeout(watchdogId);
    if (signal.aborted) {
      resumeVideo();
      return 'cancelled';
    }
    console.error('[AetherDub] activateDubbing error:', err);
    resumeVideo();
    hud.setEnabled(false);
    hud.setError('Dubbing preparation failed. Please try again.');
    return 'error';
  } finally {
    signal.removeEventListener('abort', abortHandler);
  }
}

/**
 * deactivateDubbing — smooth tear-down when user toggles dubbing OFF.
 * Does not pause the host video. Per ADR-0008.
 */
export function deactivateDubbing(
  hud: ActivationHudCallbacks,
  abortCurrentActivation?: () => void,
  /** @internal Injectable for testing only — defaults to stopDubbingPipeline */
  _stopFn?: typeof stopDubbingPipeline,
): void {
  abortCurrentActivation?.();
  (_stopFn ?? stopDubbingPipeline)();
  hud.setPreparationMode(null);
  hud.setEnabled(false);
}

async function _initOrchestrator(
  video: HTMLVideoElement,
  instance: HudInstance,
  transcript: Transcript,
  videoId: string,
  targetLanguage: string,
): Promise<DubbingOrchestratorImpl> {
  const { BackgroundDubbingTtsClient } = await import('@/core/tts/background-tts-client');
  const ttsClient = new BackgroundDubbingTtsClient();
  const orchestrator = new DubbingOrchestratorImpl(video, {
    ttsClient,
    defaultVoice: 'vi-VN-HoaiMyNeural',
    femaleVoice: 'vi-VN-HoaiMyNeural',
    maleVoice: 'vi-VN-NamMinhNeural',
    diarizationEnabled: false,
  });

  await orchestrator.init(videoId, transcript, {
    targetLanguage,
    duckLevel: 0.2,
    lookaheadSeconds: 60,
    diarizationEnabled: false,
  });
  state.activeVideoId = videoId;
  state.activeTargetLanguage = targetLanguage;

  if (orchestrator.primeInitialLookahead) {
    try {
      await orchestrator.primeInitialLookahead(video.currentTime);
    } catch (primeErr) {
      console.warn('[AetherDub] Lookahead priming warning:', primeErr);
    }
  }

  state.orchestrator = orchestrator;
  instance.updateOrchestrator?.(orchestrator);
  instance.updateProps?.({ hasCaptions: true, isNoCaptions: false });

  const syncDubbingSubtitles = () => {
    const seg = findActiveSegment(transcript.segments, video.currentTime);
    getActiveSubtitleInstance()?.setSegment(seg);
  };

  const onTimeUpdate = () => {
    orchestrator.handleTimeUpdate(video.currentTime);
    syncDubbingSubtitles();
  };
  const onSeek = () => {
    orchestrator.handleSeek(video.currentTime);
    syncDubbingSubtitles();
  };
  const onPlay = () => {
    orchestrator.handlePlay();
    syncDubbingSubtitles();
  };
  const onPause = () => orchestrator.handlePause();
  const onRateChange = () => orchestrator.handleRateChange(video.playbackRate);

  const subInstance = getActiveSubtitleInstance();
  subInstance?.setVisible(true);
  syncDubbingSubtitles();

  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('seeking', onSeek);
  video.addEventListener('seeked', onSeek);
  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('ratechange', onRateChange);

  state.cleanupListeners = () => {
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('seeking', onSeek);
    video.removeEventListener('seeked', onSeek);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('ratechange', onRateChange);
    if (!subOnlyState.activeVideoId) {
      getActiveSubtitleInstance()?.setSegment(null);
    }
  };

  if (!video.paused) {
    orchestrator.handlePlay();
    orchestrator.handleTimeUpdate(video.currentTime);
    syncDubbingSubtitles();
  }

  return orchestrator;
}

// ── Sub-Only Mode (Parallel Captions Without TTS, Issue #18 / ADR-0012) ──────

export interface SubOnlyState {
  activeVideoId: string | null;
  activeTargetLanguage: string | null;
  transcript: Transcript | null;
  cleanupListeners: (() => void) | null;
  translationAbort: AbortController | null;
  subtitleInstance?: SubtitleOverlayInstance | null;
}

const subOnlyState: SubOnlyState = {
  activeVideoId: null,
  activeTargetLanguage: null,
  transcript: null,
  cleanupListeners: null,
  translationAbort: null,
  subtitleInstance: null,
};

export function getSubOnlyState(): SubOnlyState {
  return subOnlyState;
}

export function stopSubOnlyPipeline(): void {
  if (subOnlyState.cleanupListeners) {
    subOnlyState.cleanupListeners();
    subOnlyState.cleanupListeners = null;
  }
  subOnlyState.translationAbort?.abort();
  subOnlyState.translationAbort = null;
  subOnlyState.transcript = null;
  subOnlyState.activeVideoId = null;
  subOnlyState.activeTargetLanguage = null;

  const subInstance = subOnlyState.subtitleInstance ?? getActiveSubtitleInstance();
  subInstance?.setVisible(false);
  subInstance?.setSegment(null);
  subOnlyState.subtitleInstance = null;
}

/**
 * Fast binary search to find the active segment corresponding to currentTime in O(log N).
 * Preserves deterministic boundary resolution: if currentTime >= startTime && currentTime <= endTime,
 * returns the segment. If contiguous, returns the first segment matching the boundary.
 */
export function findActiveSegment(segments: Segment[], currentTime: number): Segment | null {
  if (!segments || segments.length === 0) return null;

  let low = 0;
  let high = segments.length - 1;
  let candidateIndex = -1;

  // Find the earliest segment where endTime >= currentTime
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].endTime >= currentTime) {
      candidateIndex = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (candidateIndex !== -1) {
    const s = segments[candidateIndex];
    if (currentTime >= s.startTime && currentTime <= s.endTime) {
      return s;
    }
  }

  return null;
}

function bindSubOnlyListeners(
  video: HTMLVideoElement,
  transcript: Transcript,
  subInstance?: SubtitleOverlayInstance | null,
  instance?: HudInstance | null,
): void {
  if (subOnlyState.cleanupListeners) {
    subOnlyState.cleanupListeners();
    subOnlyState.cleanupListeners = null;
  }

  subOnlyState.transcript = transcript;

  const onSync = () => {
    const time = video.currentTime;
    const seg = findActiveSegment(transcript.segments, time);
    subInstance?.setSegment(seg);
    instance?.updateProps?.({ activeSegment: seg });
  };

  video.addEventListener('timeupdate', onSync);
  video.addEventListener('seeking', onSync);
  video.addEventListener('seeked', onSync);

  subOnlyState.cleanupListeners = () => {
    video.removeEventListener('timeupdate', onSync);
    video.removeEventListener('seeking', onSync);
    video.removeEventListener('seeked', onSync);
  };

  onSync();
}

/**
 * Fetch native captions and translate them without engaging Whisper fallback or TTS.
 */
async function fetchSubOnlyTranscript(
  videoId: string,
  targetLanguage: string,
  signal?: AbortSignal,
): Promise<Transcript | null> {
  if (signal?.aborted) return null;

  const settings = await getSettings().catch(() => null);
  if (signal?.aborted) return null;

  const translationProvider = settings?.translationProvider ?? 'self-hosted';
  const fetcher = new TranscriptFetcher();

  let captionTracks: CaptionTrack[] | undefined;
  let playerResponse: any;

  try {
    const bridged = readBridgedAudioTracks(videoId);
    if (bridged.length > 0) {
      captionTracks = bridged;
    } else if (
      typeof document !== 'undefined' &&
      document.documentElement.hasAttribute('data-aetherdub-at')
    ) {
      captionTracks = await waitForAudioCaptionTracks(videoId, 2000).catch(() => []);
    }
    if (signal?.aborted) return null;
    if (!captionTracks?.length) {
      playerResponse = await getPlayerResponse(videoId).catch(() => null);
    }
  } catch {
    // Proceed to fetch attempts
  }

  if (signal?.aborted) return null;

  const preferredLang = getActiveCaptionState().activeLanguageCode || 'en';

  if (translationProvider === YOUTUBE_CAPTION_TRANSLATION) {
    try {
      const translated = await fetcher.fetchYoutubeCaptionTranslation(videoId, {
        playerResponse,
        captionTracks,
        preferredLang,
        targetLanguage,
      });
      if (signal?.aborted) return null;
      if (translated && translated.segments.length > 0) {
        return translated;
      }
      return null;
    } catch {
      // Sub-Only mode MUST NOT invoke Whisper fallback!
      return null;
    }
  }

  if (signal?.aborted) return null;

  let rawTranscript: Transcript | null = null;
  try {
    rawTranscript = await fetcher.fetchTranscript(videoId, {
      playerResponse,
      captionTracks,
      preferredLang,
    });
  } catch {
    // Sub-Only mode MUST NOT invoke Whisper fallback!
    return null;
  }

  if (signal?.aborted || !rawTranscript || !rawTranscript.segments.length) {
    return null;
  }

  try {
    const full = await translateViaBackground(rawTranscript, targetLanguage, {
      signal,
    });
    if (signal?.aborted) return null;
    return full;
  } catch (err) {
    if (signal?.aborted) return null;
    console.warn('[AetherDub] Sub-Only translation failed:', err);
    return null;
  }
}

/**
 * activateSubOnly — activate Parallel Caption Overlay without speech synthesis (Sub-Only Mode).
 *
 * TTS synthesis and audio ducking are completely bypassed.
 * Does not pause the host video, providing near-instantaneous subtitle presentation.
 * If the video lacks native captions, ceases without calling Groq Whisper.
 */
export async function activateSubOnly(
  video: HTMLVideoElement,
  instance?: HudInstance | null,
  hud?: ActivationHudCallbacks | null,
  signal?: AbortSignal,
  videoId?: string,
  requestedTargetLanguage: string = 'vi',
  options?: {
    subtitleInstance?: SubtitleOverlayInstance | null;
    _pipelineFn?: (
      instance: HudInstance | null | undefined,
      video: HTMLVideoElement,
      targetLanguage: string,
      signal?: AbortSignal,
    ) => Promise<Transcript | null>;
  },
): Promise<ActivationResult> {
  const vid = videoId ?? extractVideoId();
  if (!vid) {
    hud?.setError('No video ID found');
    return 'error';
  }

  const targetLanguage = requestedTargetLanguage.trim() || 'vi';
  const subInstance = options?.subtitleInstance ?? getActiveSubtitleInstance();
  subOnlyState.subtitleInstance = subInstance;

  // Link caller abortSignal with internal subOnlyState.translationAbort
  subOnlyState.translationAbort?.abort();
  const subAbortController = new AbortController();
  subOnlyState.translationAbort = subAbortController;

  const handleCallerAbort = () => {
    subAbortController.abort();
  };
  if (signal) {
    if (signal.aborted) {
      subAbortController.abort();
    } else {
      signal.addEventListener('abort', handleCallerAbort, { once: true });
    }
  }
  const effectiveSignal = subAbortController.signal;

  // 1. Cache hit check
  const cache = new SegmentCache();
  const settings = await getSettings().catch(() => null);
  const translationProvider = settings?.translationProvider ?? 'self-hosted';
  const cachedTranscript = await cache
    .getTranscript(vid, targetLanguage, translationProvider)
    .catch(() => null);

  if (effectiveSignal.aborted) {
    signal?.removeEventListener('abort', handleCallerAbort);
    return 'cancelled';
  }

  const cacheHit = !!(cachedTranscript && cachedTranscript.segments.length > 0);

  if (cacheHit) {
    bindSubOnlyListeners(video, cachedTranscript!, subInstance, instance);
    subInstance?.setVisible(true);
    instance?.updateProps?.({ hasCaptions: true, isNoCaptions: false, isSubtitlesEnabled: true });
    hud?.setEnabled(true);
    hud?.setPreparationMode(null);
    hud?.setError(null);
    subOnlyState.activeVideoId = vid;
    subOnlyState.activeTargetLanguage = targetLanguage;
    signal?.removeEventListener('abort', handleCallerAbort);
    return 'cache-hit';
  }

  // 2. Cache miss: do NOT pause video (instantaneous activation without buffering)
  hud?.setPreparationMode(null);

  if (effectiveSignal.aborted) {
    signal?.removeEventListener('abort', handleCallerAbort);
    return 'cancelled';
  }

  try {
    let transcript: Transcript | null = null;

    if (options?._pipelineFn) {
      transcript = await options._pipelineFn(instance, video, targetLanguage, effectiveSignal);
    } else {
      transcript = await fetchSubOnlyTranscript(vid, targetLanguage, effectiveSignal);
    }

    if (effectiveSignal.aborted) {
      signal?.removeEventListener('abort', handleCallerAbort);
      return 'cancelled';
    }

    if (!transcript || !transcript.segments.length) {
      subInstance?.setVisible(false);
      instance?.updateProps?.({ hasCaptions: false, isNoCaptions: true });
      hud?.setEnabled(false);
      hud?.setError('Could not load captions for this video');
      signal?.removeEventListener('abort', handleCallerAbort);
      return 'error';
    }

    bindSubOnlyListeners(video, transcript, subInstance, instance);
    subInstance?.setVisible(true);
    instance?.updateProps?.({ hasCaptions: true, isNoCaptions: false, isSubtitlesEnabled: true });
    hud?.setEnabled(true);
    hud?.setPreparationMode(null);
    hud?.setError(null);
    subOnlyState.activeVideoId = vid;
    subOnlyState.activeTargetLanguage = targetLanguage;

    const complete = transcript.segments.every((s) => Boolean(s.translatedText));
    if (complete) {
      Promise.resolve(cache.saveTranscript(transcript, translationProvider)).catch(() => {});
    }

    signal?.removeEventListener('abort', handleCallerAbort);
    return 'success';
  } catch (err) {
    signal?.removeEventListener('abort', handleCallerAbort);
    if (effectiveSignal.aborted) {
      return 'cancelled';
    }
    console.error('[AetherDub] activateSubOnly error:', err);
    subInstance?.setVisible(false);
    instance?.updateProps?.({ hasCaptions: false, isNoCaptions: true });
    hud?.setEnabled(false);
    hud?.setError('Could not load captions for this video');
    return 'error';
  }
}

