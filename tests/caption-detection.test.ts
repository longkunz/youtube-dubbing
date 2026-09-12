import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getTracksFromPlayerAudioTrack,
  getActiveCaptionState,
  bridgePlayerResponseToDOM,
  readBridgedAudioTracks,
  waitForAudioCaptionTracks,
  trackHasPot,
  sortPotFirst,
  shouldSkipStaticPlayerResponseFallback,
  resolveEngineLabel,
  tryWhisperTranscriptFallback,
  isThrottleError,
  isVideoThrottled,
  markVideoThrottled,
  clearVideoThrottleForTesting,
  TIMEDTEXT_THROTTLE_COOLDOWN_MS,
  translateViaBackground,
  TRANSLATE_BATCH_SIZE,
  TRANSLATE_BATCH_TIMEOUT_MS,
} from '../src/entrypoints/content/orchestrator-coordinator';
import { resetSettingsForTesting, saveSettings } from '../src/storage/settings';

function mountMoviePlayer(api: Record<string, any>): HTMLElement {
  document.body.innerHTML = '';
  const player = document.createElement('div');
  player.id = 'movie_player';
  Object.assign(player as any, api);
  document.body.appendChild(player);
  return player;
}

describe('Caption detection (CC-visible regression)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-aetherdub-pr');
    vi.useRealTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-aetherdub-pr');
  });

  describe('getTracksFromPlayerAudioTrack', () => {
    it('returns POT-bearing caption URLs exposed by the initialized player audio track', () => {
      mountMoviePlayer({
        getAudioTrack: () => ({
          captionTracks: [
            {
              url: 'https://www.youtube.com/api/timedtext?v=vid1&lang=en&pot=TOKEN123',
              languageCode: 'en',
              name: { simpleText: 'English' },
            },
          ],
        }),
      });

      const tracks = getTracksFromPlayerAudioTrack();
      expect(tracks).toHaveLength(1);
      expect(tracks[0].baseUrl).toContain('pot=TOKEN123');
      expect(tracks[0].languageCode).toBe('en');
    });

    it('returns empty array when the player is not ready yet', () => {
      mountMoviePlayer({});
      expect(getTracksFromPlayerAudioTrack()).toEqual([]);
    });

    it('returns empty array when no movie_player element exists', () => {
      expect(getTracksFromPlayerAudioTrack()).toEqual([]);
    });
  });

  describe('getActiveCaptionState', () => {
    it('detects CC turned on via the subtitles button pressed state', () => {
      mountMoviePlayer({
        getOption: () => ({}),
      });
      const btn = document.createElement('button');
      btn.className = 'ytp-subtitles-button';
      btn.setAttribute('aria-pressed', 'true');
      document.body.appendChild(btn);

      const state = getActiveCaptionState();
      expect(state.buttonPressed).toBe(true);
      expect(state.ccEvidence).toBe(true);
    });

    it('detects currently rendered caption cues in the DOM', () => {
      mountMoviePlayer({
        getOption: () => ({}),
      });
      const cue = document.createElement('span');
      cue.className = 'ytp-caption-segment';
      cue.textContent = 'hello world';
      document.body.appendChild(cue);

      const state = getActiveCaptionState();
      expect(state.visibleCues).toBe(true);
      expect(state.ccEvidence).toBe(true);
    });

    it('reads the active caption track language from the player', () => {
      mountMoviePlayer({
        getOption: (module: string, opt: string) => {
          if (module === 'captions' && opt === 'track') {
            return { languageCode: 'vi' };
          }
          return {};
        },
      });

      const state = getActiveCaptionState();
      expect(state.trackActive).toBe(true);
      expect(state.activeLanguageCode).toBe('vi');
      expect(state.ccEvidence).toBe(true);
    });

    it('reports no CC evidence on a bare watch page', () => {
      mountMoviePlayer({
        getOption: () => ({}),
      });
      const state = getActiveCaptionState();
      expect(state.ccEvidence).toBe(false);
    });
  });

  describe('bridgePlayerResponseToDOM', () => {
    it('refreshes the bridged response when navigating to a different video (no stale cache)', () => {
      (window as any).ytInitialPlayerResponse = {
        videoDetails: { videoId: 'video-B' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
      };
      document.documentElement.setAttribute(
        'data-aetherdub-pr',
        JSON.stringify({ videoDetails: { videoId: 'video-A' } })
      );

      bridgePlayerResponseToDOM('video-B');

      const raw = document.documentElement.getAttribute('data-aetherdub-pr');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)?.videoDetails?.videoId).toBe('video-B');

      delete (window as any).ytInitialPlayerResponse;
    });
  });

  describe('POT-gated bridge tracks (asbplayer#978 P2: tracks appear before POT)', () => {
    const AT_ATTR = 'data-aetherdub-at';

    beforeEach(() => {
      document.documentElement.removeAttribute(AT_ATTR);
    });

    afterEach(() => {
      document.documentElement.removeAttribute(AT_ATTR);
    });

    function setBridgeTracks(videoId: string, tracks: any[]): void {
      document.documentElement.setAttribute(AT_ATTR, JSON.stringify({ videoId, tracks }));
    }

    it('trackHasPot detects minted vs pre-POT URLs', () => {
      expect(trackHasPot({ baseUrl: 'https://x/api/timedtext?v=v&exp=xpe&lang=en&pot=T', languageCode: 'en' })).toBe(true);
      expect(trackHasPot({ baseUrl: 'https://x/api/timedtext?v=v&exp=xpe&lang=en', languageCode: 'en' })).toBe(false);
    });

    it('readBridgedAudioTracks sorts POT-bearing tracks first', () => {
      setBridgeTracks('vid-pot', [
        { url: 'https://x/api/timedtext?v=vid-pot&exp=xpe&lang=en', languageCode: 'en' },
        { url: 'https://x/api/timedtext?v=vid-pot&exp=xpe&lang=vi&pot=T', languageCode: 'vi' },
      ]);

      const tracks = readBridgedAudioTracks('vid-pot');
      expect(tracks).toHaveLength(2);
      expect(tracks[0].languageCode).toBe('vi');
      expect(tracks[0].baseUrl).toContain('pot=T');
    });

    it('waitForAudioCaptionTracks waits for the POT-bearing version instead of returning pre-POT URLs', async () => {
      // Bridge publishes pre-POT tracks first (old behavior returned these immediately → empty fetch).
      setBridgeTracks('vid-wait', [
        { url: 'https://x/api/timedtext?v=vid-wait&exp=xpe&lang=en', languageCode: 'en' },
      ]);

      const pending = waitForAudioCaptionTracks('vid-wait', 2000, 50);

      // Player mints POT shortly after: bridge updates the attribute.
      await new Promise((r) => setTimeout(r, 100));
      setBridgeTracks('vid-wait', [
        { url: 'https://x/api/timedtext?v=vid-wait&exp=xpe&lang=en&pot=FRESH', languageCode: 'en' },
      ]);

      const tracks = await pending;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].baseUrl).toContain('pot=FRESH');
    });

    it('waitForAudioCaptionTracks returns best-effort pre-POT tracks on timeout (proves captions exist)', async () => {
      setBridgeTracks('vid-timeout', [
        { url: 'https://x/api/timedtext?v=vid-timeout&exp=xpe&lang=en', languageCode: 'en' },
      ]);

      const tracks = await waitForAudioCaptionTracks('vid-timeout', 150, 50);
      expect(tracks).toHaveLength(1);
      expect(tracks[0].languageCode).toBe('en');
    });

    it('sortPotFirst keeps language order among equally-gated tracks', () => {
      const tracks = sortPotFirst([
        { baseUrl: 'https://x/a?lang=en&pot=1', languageCode: 'en' },
        { baseUrl: 'https://x/a?lang=vi&pot=2', languageCode: 'vi' },
      ]);
      expect(tracks.map((t) => t.languageCode)).toEqual(['en', 'vi']);
    });

    it('skips static playerResponse fallback when only pre-POT gated tracks exist', () => {
      expect(
        shouldSkipStaticPlayerResponseFallback([
          { baseUrl: 'https://x/api/timedtext?v=v&exp=xpe&lang=en', languageCode: 'en' },
        ]),
      ).toBe(true);
      expect(
        shouldSkipStaticPlayerResponseFallback([
          { baseUrl: 'https://x/api/timedtext?v=v&exp=xpe&lang=en&pot=T', languageCode: 'en' },
        ]),
      ).toBe(false);
      expect(shouldSkipStaticPlayerResponseFallback([])).toBe(false);
    });
  });

  describe('resolveEngineLabel (cockpit Engine badge follows settings)', () => {
    it('returns the configured Gemini model, defaulting to gemini-3.8-flash', () => {
      expect(resolveEngineLabel({ translationProvider: 'gemini', geminiModel: 'gemini-3.5-flash' } as any)).toBe('GEMINI-3.5-FLASH');
      expect(resolveEngineLabel({ translationProvider: 'gemini' } as any)).toBe('GEMINI-3.8-FLASH');
      expect(resolveEngineLabel(undefined)).toBe('GEMINI-3.8-FLASH');
      expect(resolveEngineLabel(null)).toBe('GEMINI-3.8-FLASH');
    });

    it('returns the uppercased model for openai-compatible provider', () => {
      expect(
        resolveEngineLabel({ translationProvider: 'openai-compatible', openaiModel: 'gpt-4o-mini' } as any)
      ).toBe('GPT-4O-MINI');
      expect(resolveEngineLabel({ translationProvider: 'openai-compatible' } as any)).toBe('OPENAI');
    });

    it('returns YOUTUBE-CC for YouTube Caption Translation', () => {
      expect(
        resolveEngineLabel({ translationProvider: 'youtube-caption-translation' } as any),
      ).toBe('YOUTUBE-CC');
    });

    it('returns SELF-HOST for the self-hosted provider', () => {
      expect(resolveEngineLabel({ translationProvider: 'self-hosted' } as any)).toBe('SELF-HOST');
    });
  });

  describe('timedtext throttle circuit breaker (HTTP 429)', () => {
    beforeEach(() => {
      clearVideoThrottleForTesting();
    });

    it('detects throttle errors from per-track failure details', () => {
      expect(
        isThrottleError(new Error('Failed to fetch timedtext captions: all 2 candidate track(s) returned empty or failed for video 7qzgAkDN0q0 (en:http-429, en:http-429)'))
      ).toBe(true);
      expect(isThrottleError(new Error('POT token required for video abc'))).toBe(false);
      expect(isThrottleError(new Error('No caption tracks found for video abc'))).toBe(false);
    });

    it('marks a video throttled and releases it after cooldown', () => {
      expect(isVideoThrottled('vid-429')).toBe(false);
      markVideoThrottled('vid-429', 1_000_000);
      expect(isVideoThrottled('vid-429', 1_000_000 + 60_000)).toBe(true);
      expect(isVideoThrottled('vid-429', 1_000_000 + TIMEDTEXT_THROTTLE_COOLDOWN_MS)).toBe(false);
      // Expired entries are cleaned up
      expect(isVideoThrottled('vid-429', 1_000_000 + TIMEDTEXT_THROTTLE_COOLDOWN_MS + 1)).toBe(false);
    });

    it('tracks videos independently', () => {
      markVideoThrottled('vid-a', 500);
      expect(isVideoThrottled('vid-a', 600)).toBe(true);
      expect(isVideoThrottled('vid-b', 600)).toBe(false);
    });
  });

  describe('translateViaBackground batching (90s timeout regression)', () => {
    const realChrome = (globalThis as any).chrome;
    let sendMessage: ReturnType<typeof vi.fn>;

    function makeSegments(n: number): any[] {
      return Array.from({ length: n }, (_, i) => ({
        id: `seg-${i + 1}`,
        startTime: i * 5,
        endTime: i * 5 + 4,
        duration: 4,
        sourceText: `Line ${i + 1}`,
      }));
    }

    beforeEach(() => {
      vi.useRealTimers();
      sendMessage = vi.fn((msg: any, cb: (res: any) => void) => {
        cb({
          success: true,
          segments: msg.segments.map((s: any) => ({ ...s, translatedText: `VI:${s.id}` })),
        });
      });
      (globalThis as any).chrome = { runtime: { sendMessage } };
    });

    afterEach(() => {
      (globalThis as any).chrome = realChrome;
    });

    it('uses a 90s per-batch timeout by default', () => {
      expect(TRANSLATE_BATCH_TIMEOUT_MS).toBe(90_000);
    });

    it('uses 8 segments per batch by default so the first Dub Track window can start sooner', () => {
      expect(TRANSLATE_BATCH_SIZE).toBe(8);
    });

    it('sends small transcripts in a single message', async () => {
      const result = await translateViaBackground(
        { videoId: 'v1', sourceLanguage: 'en', segments: makeSegments(6) } as any,
        'vi'
      );
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(result.targetLanguage).toBe('vi');
      expect(result.segments).toHaveLength(6);
      expect(result.segments[0].translatedText).toBe('VI:seg-1');
    });

    it('splits large transcripts into sequential batches preserving order', async () => {
      const result = await translateViaBackground(
        { videoId: 'v1', sourceLanguage: 'en', segments: makeSegments(20) } as any,
        'vi'
      );
      expect(sendMessage).toHaveBeenCalledTimes(3);
      expect(sendMessage.mock.calls[0][0].segments).toHaveLength(8);
      expect(sendMessage.mock.calls[1][0].segments).toHaveLength(8);
      expect(sendMessage.mock.calls[2][0].segments).toHaveLength(4);
      expect(result.segments).toHaveLength(20);
      expect(result.segments.map((s: any) => s.id)).toEqual(makeSegments(20).map((s) => s.id));
      expect(result.segments[19].translatedText).toBe('VI:seg-20');
    });

    it('notifies onBatch after the first batch before later batches finish', async () => {
      sendMessage.mockImplementation((msg: any, cb: (res: any) => void) => {
        const reply = {
          success: true,
          segments: msg.segments.map((s: any) => ({ ...s, translatedText: `VI:${s.id}` })),
        };
        if (sendMessage.mock.calls.length === 1) {
          cb(reply);
        } else {
          setTimeout(() => cb(reply), 80);
        }
      });

      const onBatch = vi.fn();
      const pending = translateViaBackground(
        { videoId: 'v1', sourceLanguage: 'en', segments: makeSegments(16) } as any,
        'vi',
        { onBatch },
      );

      await vi.waitFor(() => expect(onBatch).toHaveBeenCalled());
      expect(onBatch.mock.calls[0][1]).toBe(1);
      expect(onBatch.mock.calls[0][0]).toHaveLength(16);
      expect(onBatch.mock.calls[0][0][0].translatedText).toBe('VI:seg-1');
      expect(onBatch.mock.calls[0][0][7].translatedText).toBe('VI:seg-8');
      expect(onBatch.mock.calls[0][0][8].translatedText).toBeUndefined();

      const result = await pending;
      expect(onBatch).toHaveBeenCalledTimes(2);
      expect(result.segments).toHaveLength(16);
    });

    it('keeps earlier batches when a later batch times out', async () => {
      sendMessage.mockImplementation((msg: any, cb: (res: any) => void) => {
        if (sendMessage.mock.calls.length === 1) {
          cb({
            success: true,
            segments: msg.segments.map((s: any) => ({ ...s, translatedText: `VI:${s.id}` })),
          });
          return;
        }
        // later batches never reply → timeout
      });

      const result = await translateViaBackground(
        { videoId: 'v1', sourceLanguage: 'en', segments: makeSegments(16) } as any,
        'vi',
        { batchTimeoutMs: 40 },
      );

      expect(result.segments).toHaveLength(16);
      expect(result.segments[0].translatedText).toBe('VI:seg-1');
      expect(result.segments[7].translatedText).toBe('VI:seg-8');
      expect(result.segments[8].translatedText).toBeUndefined();
    });

    it('translates in-process when chrome.runtime.sendMessage is unavailable', async () => {
      (globalThis as any).chrome = undefined;
      await saveSettings({ geminiApiKey: 'k-test', translationProvider: 'gemini' });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      translations: [
                        { id: 'seg-1', translatedText: 'Xin chào' },
                        { id: 'seg-2', translatedText: 'Thế giới' },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      });
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = fetchMock;

      try {
        const result = await translateViaBackground(
          { videoId: 'v1', sourceLanguage: 'en', segments: makeSegments(2) } as any,
          'vi',
        );
        expect(fetchMock).toHaveBeenCalled();
        expect(result.segments[0].translatedText).toBe('Xin chào');
        expect(result.segments[1].translatedText).toBe('Thế giới');
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    it('rejects when a batch fails in the background', async () => {
      sendMessage.mockImplementationOnce((_msg: any, cb: (res: any) => void) => {
        cb({ success: false, error: 'proxy exploded' });
      });
      await expect(
        translateViaBackground(
          { videoId: 'v1', sourceLanguage: 'en', segments: makeSegments(3) } as any,
          'vi'
        )
      ).rejects.toThrow(/proxy exploded/);
    });

    it('times out per batch instead of hanging forever', async () => {
      sendMessage.mockImplementation(() => {
        // Never calls back
      });
      await expect(
        translateViaBackground(
          { videoId: 'v1', sourceLanguage: 'en', segments: makeSegments(2) } as any,
          'vi',
          { batchTimeoutMs: 50 }
        )
      ).rejects.toThrow(/timed out/);
    });
  });

  describe('Whisper STT fallback (captions failed)', () => {
    beforeEach(async () => {
      await resetSettingsForTesting();
    });

    it('does not call Groq when the API key is missing', async () => {
      const result = await tryWhisperTranscriptFallback('vid-stt', {
        streamingData: {
          adaptiveFormats: [{ mimeType: 'audio/mp4', url: 'https://googlevideo.com/a' }],
        },
      });
      expect(result).toBeNull();
    });

    it('does not call Groq when the audio URL is ciphered', async () => {
      await saveSettings({ groqApiKey: 'gsk_test' });
      const result = await tryWhisperTranscriptFallback('vid-stt', {
        streamingData: {
          adaptiveFormats: [{ mimeType: 'audio/webm', signatureCipher: 's=ABC' }],
        },
      });
      expect(result).toBeNull();
    });
  });
});
