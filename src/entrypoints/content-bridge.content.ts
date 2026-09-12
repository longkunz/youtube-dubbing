import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * AetherDub MAIN-World Bridge
 *
 * Runs in the page's MAIN world (same JS context as YouTube) — the only place
 * where extension code can read YouTube's page-scoped globals and player APIs.
 *
 * Bridges two data sources to DOM attributes readable from isolated world:
 *
 *  ① data-aetherdub-pr   — ytInitialPlayerResponse (static, set early)
 *  ② data-aetherdub-at   — movie_player.getAudioTrack().captionTracks
 *                          These contain runtime-minted, POT-bearing URLs that
 *                          actually work, unlike the static playerResponse URLs
 *                          which YouTube gates behind exp=xpe since mid-2025.
 *
 * Dispatch `aetherdub:player-response-ready` when either source is updated so
 * the isolated-world coordinator can react immediately instead of polling.
 */
export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',

  main() {
    const PR_ATTR = 'data-aetherdub-pr';
    const AT_ATTR = 'data-aetherdub-at';
    const EVENT = 'aetherdub:player-response-ready';

    function dispatchReady(videoId: string): void {
      document.dispatchEvent(new CustomEvent(EVENT, { detail: { videoId } }));
    }

    // ── ① Bridge ytInitialPlayerResponse ────────────────────────────────────
    function bridgePlayerResponse(): void {
      try {
        const pr = (window as any).ytInitialPlayerResponse;
        if (!pr?.videoDetails?.videoId) return;

        document.documentElement.setAttribute(PR_ATTR, JSON.stringify(pr));
        dispatchReady(pr.videoDetails.videoId);
      } catch {
        // Never break the page
      }
    }

    // ── ② Bridge audio-track caption URLs (POT-bearing) ──────────────────────
    //
    // movie_player.getAudioTrack().captionTracks contains runtime-signed URLs
    // with a `pot=` parameter that YouTube now requires for timedtext requests.
    // The player is not ready immediately at document_idle; we poll briefly.
    let audioTrackInterval: ReturnType<typeof setInterval> | null = null;
    let audioTrackAttempts = 0;
    const MAX_AT_ATTEMPTS = 40; // 40 × 250 ms = 10 s

    function tryBridgeAudioTrack(): void {
      try {
        const player = (document.getElementById('movie_player') as any);
        const captionTracks: any[] = player?.getAudioTrack?.()?.captionTracks;
        if (!Array.isArray(captionTracks) || captionTracks.length === 0) return;

        // Resolve the current video ID
        const videoId: string =
          (window as any).ytInitialPlayerResponse?.videoDetails?.videoId ||
          new URLSearchParams(location.search).get('v') ||
          '';

        const serialisable = captionTracks.map((t: any) => ({
          url: t.url ?? t.baseUrl ?? '',
          languageCode: t.languageCode ?? '',
          kind: t.kind === 'asr' ? 'asr' : undefined,
          name: t.name?.simpleText ?? t.displayName ?? t.languageName ?? '',
          isTranslatable: t.isTranslatable,
        })).filter((t: any) => t.url && t.languageCode);

        if (serialisable.length === 0) return;

        // The player exposes caption tracks BEFORE BotGuard mints the POT:
        // early URLs carry `exp=xpe` but no `pot=` and fetch as HTTP 200 with
        // an empty body (same lesson as asbplayer#978 P2). Publish
        // progressively so isolated world has the language list early, but
        // keep polling until a POT-bearing URL arrives — only then stop.
        const hasPot = serialisable.some((t: any) => t.url.includes('pot='));
        const payload = JSON.stringify({ videoId, tracks: serialisable, hasPot });
        const prev = document.documentElement.getAttribute(AT_ATTR);
        if (prev !== payload) {
          document.documentElement.setAttribute(AT_ATTR, payload);
          if (videoId) dispatchReady(videoId);
        }

        if (hasPot && audioTrackInterval !== null) {
          clearInterval(audioTrackInterval);
          audioTrackInterval = null;
        }
      } catch {
        // Player not ready yet — keep polling
      }
    }

    function startAudioTrackPolling(): void {
      audioTrackAttempts = 0;
      if (audioTrackInterval !== null) clearInterval(audioTrackInterval);

      // Try immediately first
      tryBridgeAudioTrack();

      audioTrackInterval = setInterval(() => {
        audioTrackAttempts++;
        tryBridgeAudioTrack();
        if (audioTrackAttempts >= MAX_AT_ATTEMPTS && audioTrackInterval !== null) {
          clearInterval(audioTrackInterval);
          audioTrackInterval = null;
        }
      }, 250);
    }

    // ── Run on page load ─────────────────────────────────────────────────────
    bridgePlayerResponse();
    startAudioTrackPolling();

    // ── Re-run on YouTube SPA navigation ─────────────────────────────────────
    function onNavigate(): void {
      // Clear stale audio-track data so isolated world doesn't reuse it
      document.documentElement.removeAttribute(AT_ATTR);
      bridgePlayerResponse();
      startAudioTrackPolling();
    }

    window.addEventListener('yt-navigate-finish', onNavigate);
    window.addEventListener('yt-page-data-updated', bridgePlayerResponse);
  },
});
