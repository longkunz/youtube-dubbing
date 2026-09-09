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
import { getSettings } from '@/storage/settings';
import type { Transcript, Segment } from '@/types/domain';
import type { HudInstance } from './mount';

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
 * Retrieve YouTube player response containing captionTracks.
 * Checks DOM <script> tags first, falls back to fetching watch page HTML.
 */
export async function getPlayerResponse(videoId: string): Promise<any> {
  // 1. Try window.ytInitialPlayerResponse if accessible in same scope
  if (typeof window !== 'undefined' && (window as any).ytInitialPlayerResponse) {
    return (window as any).ytInitialPlayerResponse;
  }

  // 2. Search DOM script tags
  if (typeof document !== 'undefined') {
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent;
      if (text && text.includes('ytInitialPlayerResponse')) {
        const match = /ytInitialPlayerResponse\s*=\s*({.+?});/s.exec(text);
        if (match && match[1]) {
          try {
            return JSON.parse(match[1]);
          } catch {}
        }
      }
    }
  }

  // 3. Fetch watch page HTML
  try {
    const fetcher = new TranscriptFetcher();
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    if (res.ok) {
      const html = await res.text();
      const pr = fetcher.extractPlayerResponseFromHtml(html);
      if (pr) return pr;
    }
  } catch (err) {
    console.warn('[AetherDub] Failed to fetch watch page HTML for player response:', err);
  }

  return null;
}

/**
 * Delegate translation to Background Service Worker via message passing
 * to bypass host page CSP & CORS restrictions.
 */
export async function translateViaBackground(
  transcript: Transcript,
  targetLanguage: string
): Promise<Transcript> {
  const settings = await getSettings();

  return new Promise<Transcript>((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return reject(new Error('chrome.runtime.sendMessage unavailable'));
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Translation request timed out after 30s'));
      }
    }, 30000);

    chrome.runtime.sendMessage(
      {
        action: 'TRANSLATE_SEGMENTS',
        segments: transcript.segments,
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
        resolve({
          ...transcript,
          targetLanguage,
          segments: res.segments as Segment[],
        });
      }
    );
  });
}

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

  // Already initialized for this video
  if (state.activeVideoId === videoId && state.orchestrator) {
    instance.updateOrchestrator?.(state.orchestrator);
    return state.orchestrator;
  }

  // Prevent concurrent in-flight pipeline launches for the same video
  if (state.isInitializing && state.activeVideoId === videoId) {
    return null;
  }

  // Clean up any stale orchestrator
  stopDubbingPipeline();
  state.activeVideoId = videoId;
  state.isInitializing = true;

  console.log('[AetherDub] Starting dubbing pipeline for video:', videoId);

  try {
    // 1. Fetch transcript
    const fetcher = new TranscriptFetcher();
    const playerResponse = await getPlayerResponse(videoId);

    let rawTranscript: Transcript;
    try {
      rawTranscript = await fetcher.fetchTranscript(videoId, {
        playerResponse,
        preferredLang: 'en',
      });
    } catch (err: any) {
      console.warn('[AetherDub] No captions available:', err?.message || err);
      instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
      return null;
    }

    if (!rawTranscript || rawTranscript.segments.length === 0) {
      console.warn('[AetherDub] Transcript has 0 segments');
      instance.updateProps?.({ hasCaptions: false, isNoCaptions: true });
      return null;
    }

    // 2. Check SegmentCache for existing translation
    const cache = new SegmentCache();
    const targetLanguage = 'vi';
    let translatedTranscript = await cache.getTranscript(videoId, targetLanguage);

    if (!translatedTranscript) {
      console.log('[AetherDub] Translating transcript to', targetLanguage);
      translatedTranscript = await translateViaBackground(rawTranscript, targetLanguage);
      try {
        await cache.saveTranscript(translatedTranscript);
      } catch (cacheErr) {
        console.warn('[AetherDub] Failed to cache transcript in IndexedDB:', cacheErr);
      }
    } else {
      console.log('[AetherDub] Reusing cached transcript from IndexedDB (0ms latency)');
    }

    // 3. Initialize DubbingOrchestrator with BackgroundDubbingTtsClient
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

    state.orchestrator = orchestrator;

    // 4. Update HUD
    instance.updateOrchestrator?.(orchestrator);
    instance.updateProps?.({ hasCaptions: true, isNoCaptions: false });

    // 5. Bind Video Element events
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

    // If video is currently playing, trigger immediate sync & lookahead synthesis
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
