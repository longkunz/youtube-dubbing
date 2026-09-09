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

import { TranscriptFetcher } from '@/core/transcript/fetcher';
import { DubbingOrchestratorImpl } from '@/core/orchestrator/dubbing-orchestrator';
import { BackgroundDubbingTtsClient } from '@/core/tts/background-tts-client';
import { SegmentCache } from '@/storage/segment-cache';
import { getSettings, type UserSettings } from '@/storage/settings';
import type { Transcript, Segment, CaptionTrack } from '@/types/domain';
import type { HudInstance } from './mount';

/**
 * Derive the cockpit Engine badge from user settings so the HUD reflects
 * the configured translation provider instead of a hardcoded label.
 */
export function resolveEngineLabel(settings?: Partial<UserSettings> | null): string {
  if (settings?.translationProvider === 'openai-compatible') {
    const model = settings.openaiModel?.trim();
    return model ? model.toUpperCase() : 'OPENAI';
  }
  return 'GEMINI-2.0';
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
  orchestrator: DubbingOrchestratorImpl | null;
  cleanupListeners: (() => void) | null;
  isInitializing: boolean;
}

const state: CoordinatorState = {
  activeVideoId: null,
  orchestrator: null,
  cleanupListeners: null,
  isInitializing: false,
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
          isTranslatable: t.isTranslatable ?? false,
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
          isTranslatable: t?.isTranslatable ?? false,
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
      isTranslatable: t.isTranslatable ?? false,
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

export const TRANSLATE_BATCH_SIZE = 25;
export const TRANSLATE_BATCH_TIMEOUT_MS = 30000;

export interface TranslateViaBackgroundOptions {
  /** Segments per background message (default 25). Smaller = faster per reply. */
  batchSize?: number;
  /** Per-batch timeout in ms (default 30000). */
  batchTimeoutMs?: number;
}

function sendTranslateBatch(
  segments: Segment[],
  targetLanguage: string,
  settings: unknown,
  batchTimeoutMs: number
): Promise<Segment[]> {
  return new Promise<Segment[]>((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return reject(new Error('chrome.runtime.sendMessage unavailable'));
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Translation request timed out after ${batchTimeoutMs / 1000}s`));
      }
    }, batchTimeoutMs);

    chrome.runtime.sendMessage(
      {
        action: 'TRANSLATE_SEGMENTS',
        segments,
        targetLanguage,
        settings,
      },
      (res: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (chrome.runtime?.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!res || !res.success) {
          return reject(new Error(res?.error || 'Translation failed in background'));
        }
        resolve(res.segments as Segment[]);
      }
    );
  });
}

/**
 * Delegate translation to Background Service Worker via message passing
 * to bypass host page CSP & CORS restrictions.
 *
 * Sends segments in sequential batches (default 25/message) instead of one
 * giant request: a full transcript in a single message can exceed the
 * 30s round-trip (slow proxy/model), which previously surfaced as
 * "Translation request timed out after 30s" with no partial progress.
 */
export async function translateViaBackground(
  transcript: Transcript,
  targetLanguage: string,
  options: TranslateViaBackgroundOptions = {}
): Promise<Transcript> {
  const settings = await getSettings();
  const batchSize = Math.max(1, options.batchSize ?? TRANSLATE_BATCH_SIZE);
  const batchTimeoutMs = options.batchTimeoutMs ?? TRANSLATE_BATCH_TIMEOUT_MS;
  const segments = transcript.segments;

  if (segments.length <= batchSize) {
    const translated = await sendTranslateBatch(segments, targetLanguage, settings, batchTimeoutMs);
    return { ...transcript, targetLanguage, segments: translated };
  }

  const translated: Segment[] = [];
  const batchCount = Math.ceil(segments.length / batchSize);
  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const batchNo = Math.floor(i / batchSize) + 1;
    console.log(`[AetherDub] Translating batch ${batchNo}/${batchCount} (${batch.length} segments)`);
    const done = await sendTranslateBatch(batch, targetLanguage, settings, batchTimeoutMs);
    translated.push(...done);
  }
  return { ...transcript, targetLanguage, segments: translated };
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
  state.activeVideoId = null;
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
  targetVideoElement?: HTMLVideoElement
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

  // Already initialized for this video — reuse the running orchestrator
  if (state.activeVideoId === videoId && state.orchestrator) {
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
    try {
      const settings = await getSettings();
      instance.updateProps?.({ engineLabel: resolveEngineLabel(settings) });
    } catch {
      // Non-fatal: HUD keeps its default badge.
    }

    const fetcher = new TranscriptFetcher();
    const cache = new SegmentCache();
    const targetLanguage = 'vi';

    // ── 0. Cache-first: a fully translated transcript needs ZERO timedtext
    // requests and ZERO translation tokens. Previously the raw captions were
    // fetched on every page load even for cached videos — pure throttle fuel.
    let translatedTranscript = await cache.getTranscript(videoId, targetLanguage).catch(() => null);
    if (translatedTranscript && translatedTranscript.segments.length > 0) {
      console.log('[AetherDub] Reusing cached transcript from IndexedDB (0 timedtext requests, 0ms latency)');
    } else {
      translatedTranscript = null;

      // ── 1. Resolve caption tracks ──────────────────────────────────────────
      // Try POT-bearing audio track URLs first (bridge polls up to 8 s).
      // Fall back to static playerResponse URLs if audio track not available.
      let captionTracks: CaptionTrack[] | undefined;
      let playerResponse: any;

      const audioTracks = await waitForAudioCaptionTracks(videoId, 8000);
      if (audioTracks.length > 0) {
        const potCount = audioTracks.filter(trackHasPot).length;
        console.log(`[AetherDub] Using ${audioTracks.length} audio track URL(s) from bridge (${potCount} with pot)`);
        if (potCount === 0) {
          console.warn('[AetherDub] Bridge tracks carry no POT yet — fetch will likely return empty bodies (exp=xpe gate)');
        }
        captionTracks = audioTracks;
      } else {
        console.warn('[AetherDub] Audio track bridge timeout — falling back to playerResponse');
        playerResponse = await getPlayerResponse(videoId);
        console.log('[AetherDub] Player response found:', !!playerResponse,
          '| captions:', !!(playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
            playerResponse?.playerCaptionsTracklistRenderer?.captionTracks));
      }

      // ── 2. Fetch transcript ───────────────────────────────────────────────
      let rawTranscript: Transcript;
      try {
        rawTranscript = await fetcher.fetchTranscript(videoId, {
          playerResponse,
          captionTracks,
          preferredLang: 'en',
        });
      } catch (err: any) {
        if (isThrottleError(err)) {
          markVideoThrottled(videoId);
          console.warn(
            `[AetherDub] Timedtext throttled (HTTP 429) for video ${videoId} — cooling down for ${TIMEDTEXT_THROTTLE_COOLDOWN_MS / 60000} min. ` +
              `Further attempts will be skipped until then.`
          );
        } else {
          console.warn('[AetherDub] No captions available:', err?.message || err);
        }
        instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
        return null;
      }

      if (!rawTranscript || rawTranscript.segments.length === 0) {
        console.warn('[AetherDub] Transcript has 0 segments');
        instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
        return null;
      }

      // ── 3. Translate + cache ──────────────────────────────────────────────
      console.log('[AetherDub] Translating transcript to', targetLanguage);
      translatedTranscript = await translateViaBackground(rawTranscript, targetLanguage);
      try {
        await cache.saveTranscript(translatedTranscript);
      } catch (cacheErr) {
        console.warn('[AetherDub] Failed to cache transcript in IndexedDB:', cacheErr);
      }
    }

    // ── 4. Initialize DubbingOrchestrator ────────────────────────────────
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

    // ── 4b. Prime initial lookahead audio (ADR-0008) ──────────────────────
    if (orchestrator.primeInitialLookahead) {
      try {
        await orchestrator.primeInitialLookahead(video.currentTime);
      } catch (primeErr) {
        console.warn('[AetherDub] Lookahead priming warning:', primeErr);
      }
    }

    state.orchestrator = orchestrator;

    // ── 5. Update HUD ─────────────────────────────────────────────────────
    instance.updateOrchestrator?.(orchestrator);
    instance.updateProps?.({ hasCaptions: true, isNoCaptions: false });

    // ── 6. Bind video events ──────────────────────────────────────────────
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
): Promise<ActivationResult> {
  const pipelineFn = _pipelineFn ?? startDubbingPipeline;
  const vid = videoId ?? extractVideoId();
  if (!vid) {
    hud.setError('No video ID found');
    return 'error';
  }

  const targetLanguage = 'vi';
  const cache = new SegmentCache();

  // ── 0. Cache fast-path ─────────────────────────────────────────────────────
  const cachedTranscript = await cache.getTranscript(vid, targetLanguage).catch(() => null);
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

    const orchestrator = await pipelineFn(instance, video);

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

  return orchestrator;
}
