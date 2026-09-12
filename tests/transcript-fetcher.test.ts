import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptFetcher, normalizeTimedTextUrl } from '../src/core/transcript/fetcher';
import { REAL_WORLD_XML_TIMEDTEXT, REAL_WORLD_JSON3_TIMEDTEXT } from './fixtures/caption-fixtures';
import { PlayerResponseCaptions } from '../src/types/domain';

describe('TranscriptFetcher', () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  describe('extractCaptionTracks', () => {
    it('extracts caption tracks from valid playerResponse', () => {
      const playerResponse: PlayerResponseCaptions = {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=en',
              name: { simpleText: 'English' },
              languageCode: 'en',
              kind: undefined
            },
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=en&kind=asr',
              name: { simpleText: 'English (auto-generated)' },
              languageCode: 'en',
              kind: 'asr'
            }
          ]
        }
      };

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const tracks = fetcher.extractCaptionTracks(playerResponse);

      expect(tracks).toHaveLength(2);
      expect(tracks[0].baseUrl).toContain('lang=en');
      expect(tracks[0].kind).toBeUndefined();
      expect(tracks[1].kind).toBe('asr');
    });

    it('extracts caption tracks from production playerResponse with nested captions object', () => {
      const playerResponse: PlayerResponseCaptions = {
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=i2hw-Rjnqpo&lang=ar&kind=asr',
                name: { simpleText: 'Arabic (auto-generated)' },
                languageCode: 'ar',
                kind: 'asr'
              },
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=i2hw-Rjnqpo&lang=en&kind=asr',
                name: { simpleText: 'English (auto-generated)' },
                languageCode: 'en',
                kind: 'asr'
              }
            ]
          }
        }
      };

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const tracks = fetcher.extractCaptionTracks(playerResponse);

      expect(tracks).toHaveLength(2);
      expect(tracks[0].languageCode).toBe('ar');
      expect(tracks[1].languageCode).toBe('en');
    });

    it('returns empty array if no caption tracks found in playerResponse', () => {
      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      expect(fetcher.extractCaptionTracks({})).toEqual([]);
      expect(fetcher.extractCaptionTracks(null as any)).toEqual([]);
    });
  });

  describe('extractPlayerResponseFromHtml', () => {
    const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });

    it('extracts and parses ytInitialPlayerResponse from page HTML', () => {
      const html = `<html><script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc123xyz"}};var foo = 1;</script></html>`;
      const result = fetcher.extractPlayerResponseFromHtml(html);
      expect(result).toBeDefined();
      expect((result as any)?.videoDetails?.videoId).toBe('abc123xyz');
    });

    it('correctly handles deeply nested JSON objects (regression: simple regex stops at first "}")', () => {
      // This is the critical regression case — the old `/({.+?})/s` regex would stop at the first
      // closing brace inside a nested object, returning malformed JSON that fails JSON.parse.
      const deepJson = {
        videoDetails: { videoId: 'nested123', author: 'Test Channel' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { baseUrl: 'https://www.youtube.com/api/timedtext?v=nested123&lang=en', languageCode: 'en' }
            ]
          }
        }
      };
      const html = `<script>var x = 1;ytInitialPlayerResponse = ${JSON.stringify(deepJson)};var y = 2;</script>`;
      const result = fetcher.extractPlayerResponseFromHtml(html);
      expect(result).toBeDefined();
      expect((result as any)?.videoDetails?.videoId).toBe('nested123');
      expect((result as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks).toHaveLength(1);
    });

    it('handles JSON with semicolons inside string values', () => {
      const html = `<script>ytInitialPlayerResponse = {"title":"Hello; World","videoDetails":{"videoId":"semi456"}};var z=1;</script>`;
      const result = fetcher.extractPlayerResponseFromHtml(html);
      expect(result).toBeDefined();
      expect((result as any)?.videoDetails?.videoId).toBe('semi456');
    });

    it('returns null for empty or missing response', () => {
      expect(fetcher.extractPlayerResponseFromHtml('')).toBeNull();
      expect(fetcher.extractPlayerResponseFromHtml('<html>no data here</html>')).toBeNull();
      expect(fetcher.extractPlayerResponseFromHtml('ytInitialPlayerResponse = invalid json;')).toBeNull();
    });
  });

  describe('selectBestCaptionTrack', () => {
    const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });

    it('prefers author-uploaded caption track over auto-generated asr track', () => {
      const tracks = [
        { baseUrl: 'https://youtube.com/asr', languageCode: 'en', kind: 'asr' },
        { baseUrl: 'https://youtube.com/manual', languageCode: 'en', kind: undefined }
      ];

      const best = fetcher.selectBestCaptionTrack(tracks, 'en');
      expect(best?.baseUrl).toBe('https://youtube.com/manual');
      expect(best?.kind).toBeUndefined();
    });

    it('falls back to auto-generated asr track if no manual track is found', () => {
      const tracks = [
        { baseUrl: 'https://youtube.com/asr', languageCode: 'en', kind: 'asr' }
      ];

      const best = fetcher.selectBestCaptionTrack(tracks, 'en');
      expect(best?.baseUrl).toBe('https://youtube.com/asr');
      expect(best?.kind).toBe('asr');
    });

    it('matches target language if available', () => {
      const tracks = [
        { baseUrl: 'https://youtube.com/es', languageCode: 'es' },
        { baseUrl: 'https://youtube.com/en', languageCode: 'en' }
      ];

      const best = fetcher.selectBestCaptionTrack(tracks, 'es');
      expect(best?.languageCode).toBe('es');
    });

    it('falls back to first available track if preferred language is not found', () => {
      const tracks = [
        { baseUrl: 'https://youtube.com/ar', languageCode: 'ar', kind: 'asr' },
        { baseUrl: 'https://youtube.com/ja', languageCode: 'ja', kind: 'asr' }
      ];

      const best = fetcher.selectBestCaptionTrack(tracks, 'fr');
      expect(best?.languageCode).toBe('ar');
    });
  });

  describe('fetchTranscript', () => {
    it('fetches XML timedtext and returns consolidated Transcript with segments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => REAL_WORLD_XML_TIMEDTEXT
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchTranscript('video-123', {
        trackUrl: 'https://www.youtube.com/api/timedtext?v=video-123&lang=en'
      });

      expect(transcript.videoId).toBe('video-123');
      expect(transcript.sourceLanguage).toBe('en');
      expect(transcript.segments.length).toBeGreaterThan(0);
      expect(transcript.segments[0].sourceText).toContain('Hello everyone & welcome');
    });

    it('fetches JSON3 timedtext and returns consolidated Transcript', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(REAL_WORLD_JSON3_TIMEDTEXT)
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchTranscript('video-456', {
        trackUrl: 'https://www.youtube.com/api/timedtext?v=video-456&lang=en&fmt=json3'
      });

      expect(transcript.videoId).toBe('video-456');
      expect(transcript.segments.length).toBe(3); // 4 raw fragments consolidated to 3 sentences due to terminal punctuation
      expect(transcript.segments[0].sourceText).toBe('In this video, we will build a chrome extension.');
      expect(transcript.segments[1].sourceText).toBe('It supports real-time dubbing.');
      expect(transcript.segments[2].sourceText).toBe('Let\'s test it out!');
    });

    it('throws descriptive error if timedtext fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      await expect(
        fetcher.fetchTranscript('video-fail', { trackUrl: 'https://bad-url' })
      ).rejects.toThrow(/Failed to fetch timedtext captions/);
    });

    it('throws descriptive error if timedtext response is empty string', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '   '
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      await expect(
        fetcher.fetchTranscript('video-empty', { trackUrl: 'https://empty-url' })
      ).rejects.toThrow(/Empty caption response received/);
    });

    it('throws error when no caption track is available and cannot resolve tracks', async () => {
      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      await expect(
        fetcher.fetchTranscript('no-captions', { captionTracks: [] })
      ).rejects.toThrow(/No caption tracks found/);
    });
  });

  describe('CC-visible regression: tracklist without baseUrl must not mask playerResponse tracks', () => {
    it('extracts audio-track shaped caption tracks using the `url` field (player.getAudioTrack)', () => {
      const playerResponse: any = {
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=TOKEN123',
                languageCode: 'en',
                name: { simpleText: 'English' },
              },
            ],
          },
        },
      };

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const tracks = fetcher.extractCaptionTracks(playerResponse);

      expect(tracks).toHaveLength(1);
      expect(tracks[0].baseUrl).toBe('https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=TOKEN123');
      expect(tracks[0].languageCode).toBe('en');
    });

    it('reports captions as present even when tracks carry no fetchable URL', () => {
      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      expect(
        fetcher.hasCaptionTracks({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ languageCode: 'en' } as any],
            },
          },
        })
      ).toBe(true);
      expect(fetcher.hasCaptionTracks({})).toBe(false);
      expect(fetcher.hasCaptionTracks(null as any)).toBe(false);
    });

    it('falls through to playerResponse tracks when captionTracks entries have no baseUrl (movie_player tracklist shape)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => REAL_WORLD_XML_TIMEDTEXT,
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchTranscript('video-cc-open', {
        // Shape returned by movie_player.getOption('captions', 'tracklist'): no baseUrl.
        captionTracks: [{ languageCode: 'en' } as any],
        playerResponse: {
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=video-cc-open&lang=en',
                  languageCode: 'en',
                  name: { simpleText: 'English' },
                },
              ],
            },
          },
        } as PlayerResponseCaptions,
        preferredLang: 'en',
      });

      expect(transcript.segments.length).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect((mockFetch.mock.calls[0] as any[])[0]).toContain('lang=en');
    });

    it('tries the next candidate track when the best track fetch fails', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' })
        .mockResolvedValueOnce({ ok: true, text: async () => REAL_WORLD_XML_TIMEDTEXT });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchTranscript('video-fallback-track', {
        captionTracks: [
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-fallback-track&lang=en&expire=1', languageCode: 'en' },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-fallback-track&lang=vi', languageCode: 'vi' },
        ],
        preferredLang: 'en',
      });

      expect(transcript.segments.length).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('tries the next candidate track when the best track returns an empty body', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => '   ' })
        .mockResolvedValueOnce({ ok: true, text: async () => REAL_WORLD_XML_TIMEDTEXT });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchTranscript('video-empty-first', {
        captionTracks: [
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-empty-first&lang=en', languageCode: 'en' },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-empty-first&lang=vi', languageCode: 'vi' },
        ],
        preferredLang: 'en',
      });

      expect(transcript.segments.length).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws a POT-specific error when every exp=xpe gated candidate returns an empty body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '',
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch, retryDelaysMs: [] });
      await expect(
        fetcher.fetchTranscript('video-pot-all-empty', {
          captionTracks: [
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=video-pot-all-empty&exp=xpe&lang=en',
              languageCode: 'en',
            },
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=video-pot-all-empty&exp=xpe&lang=vi',
              languageCode: 'vi',
            },
          ],
          preferredLang: 'en',
        }),
      ).rejects.toThrow(/POT/i);
    });

    it('throws a POT-specific error when an exp=xpe gated track returns an empty body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '',
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      await expect(
        fetcher.fetchTranscript('video-pot-gated', {
          captionTracks: [
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=video-pot-gated&exp=xpe&lang=en',
              languageCode: 'en',
            },
          ],
          preferredLang: 'en',
        })
      ).rejects.toThrow(/POT/i);
    });

    it('reports per-track failure reasons when all candidates fail', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' })
        .mockResolvedValueOnce({ ok: true, text: async () => '   ' });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      await expect(
        fetcher.fetchTranscript('video-all-fail', {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-all-fail&lang=en', languageCode: 'en' },
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-all-fail&lang=vi', languageCode: 'vi' },
          ],
          preferredLang: 'en',
        })
      ).rejects.toThrow(/en:http-403.*vi:empty|vi:empty.*en:http-403/);
    });
  });

  describe('normalizeTimedTextUrl (asbplayer#978: POT URLs need fmt + client identity)', () => {
    it('adds fmt=json3 and c=WEB to a POT-bearing player URL lacking both', () => {
      const out = normalizeTimedTextUrl(
        'https://www.youtube.com/api/timedtext?v=30LWjhZzg50&exp=xpe&lang=en&pot=TOKEN123'
      );
      expect(out).toContain('fmt=json3');
      expect(out).toContain('c=WEB');
      expect(out).toContain('pot=TOKEN123');
      expect(out).toContain('exp=xpe');
    });

    it('preserves an explicitly chosen fmt and client param', () => {
      const out = normalizeTimedTextUrl(
        'https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=srv3&c=WEB&pot=T'
      );
      expect(out).toContain('fmt=srv3');
      expect(out).not.toContain('fmt=json3');
    });

    it('fetches the normalized URL (not the raw baseUrl) for bridge tracks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(REAL_WORLD_JSON3_TIMEDTEXT),
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      await fetcher.fetchTranscript('video-bridge', {
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=video-bridge&exp=xpe&lang=en&pot=TOKEN123',
            languageCode: 'en',
          },
        ],
        preferredLang: 'en',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchedUrl = (mockFetch.mock.calls[0] as any[])[0] as string;
      expect(fetchedUrl).toContain('fmt=json3');
      expect(fetchedUrl).toContain('c=WEB');
      expect(fetchedUrl).toContain('pot=TOKEN123');
    });
  });

  describe('rate-limit retry (http-429 regression for video 30LWjhZzg50)', () => {
    function mockResponse(status: number, body: string): any {
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 429 ? 'Too Many Requests' : `Status ${status}`,
        headers: { get: () => null },
        text: async () => body,
      };
    }

    it('retries a 429 and succeeds on the second attempt', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(429, ''))
        .mockResolvedValueOnce(mockResponse(200, JSON.stringify(REAL_WORLD_JSON3_TIMEDTEXT)));

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch, retryDelaysMs: [10, 20] });
      const transcript = await fetcher.fetchTranscript('video-429-once', {
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=video-429-once&exp=xpe&lang=en&pot=T',
            languageCode: 'en',
          },
        ],
        preferredLang: 'en',
      });

      expect(transcript.segments.length).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry a 404 (non-retryable)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, ''));

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch, retryDelaysMs: [10, 20] });
      await expect(
        fetcher.fetchTranscript('video-404', {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-404&lang=en', languageCode: 'en' },
          ],
          preferredLang: 'en',
        })
      ).rejects.toThrow(/Failed to fetch timedtext captions/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('gives up after exhausting retries and reports http-429 per track', async () => {
      mockFetch.mockResolvedValue(mockResponse(429, ''));

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch, retryDelaysMs: [10, 20] });
      await expect(
        fetcher.fetchTranscript('video-429-persistent', {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-429-persistent&lang=en', languageCode: 'en' },
          ],
          preferredLang: 'en',
        })
      ).rejects.toThrow(/en:http-429/);
      // 1 initial + 2 retries for the single candidate
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('retries only the best track; fallback candidates get a single attempt (no retry storm)', async () => {
      mockFetch
        // Best track (en): 429 persistently → 1 initial + 2 retries
        .mockResolvedValueOnce(mockResponse(429, ''))
        .mockResolvedValueOnce(mockResponse(429, ''))
        .mockResolvedValueOnce(mockResponse(429, ''))
        // Fallback track (vi): 429 once → NO retry, then… (stays failed)
        .mockResolvedValueOnce(mockResponse(429, ''))
        // Fallback track (fr): success on first try
        .mockResolvedValueOnce(mockResponse(200, JSON.stringify(REAL_WORLD_JSON3_TIMEDTEXT)));

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch, retryDelaysMs: [10, 20] });
      const transcript = await fetcher.fetchTranscript('video-retry-best-only', {
        captionTracks: [
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-retry-best-only&lang=en', languageCode: 'en' },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-retry-best-only&lang=vi', languageCode: 'vi' },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-retry-best-only&lang=fr', languageCode: 'fr' },
        ],
        preferredLang: 'en',
      });

      expect(transcript.segments.length).toBeGreaterThan(0);
      // 3 (en with retries) + 1 (vi, no retry) + 1 (fr, success) = 5, not 9
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });

  describe('YouTube Caption Translation', () => {
    function json3(cues: Array<{ startMs: number; durMs: number; text: string }>): string {
      return JSON.stringify({
        events: cues.map((c) => ({
          tStartMs: c.startMs,
          dDurationMs: c.durMs,
          segs: [{ utf8: c.text }],
        })),
      });
    }

    it('preserves pot and existing params when adding machine translation', async () => {
      const { withMachineTranslation } = await import('../src/core/transcript/youtube-caption-translation');
      const url = withMachineTranslation(
        'https://www.youtube.com/api/timedtext?v=vid&lang=en&fmt=json3&c=WEB&pot=TOKEN123',
        'vi',
      );
      expect(url).toContain('pot=TOKEN123');
      expect(url).toContain('fmt=json3');
      expect(url).toContain('c=WEB');
      expect(url).toContain('tlang=vi');
    });

    it('uses a target-language Caption Track without tlang', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => json3([{ startMs: 0, durMs: 2000, text: 'Xin chào.' }]),
      });
      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchYoutubeCaptionTranslation('vid-target', {
        targetLanguage: 'vi',
        preferredLang: 'en',
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=vid-target&lang=vi&pot=T',
            languageCode: 'vi',
          },
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=vid-target&lang=en&pot=T',
            languageCode: 'en',
            isTranslatable: true,
          },
        ],
      });

      expect(transcript.segments[0].translatedText).toMatch(/Xin chào/);
      const translatedCalls = mockFetch.mock.calls.filter((c: string[]) => String(c[0]).includes('lang=vi'));
      expect(translatedCalls.some((c: string[]) => !String(c[0]).includes('tlang='))).toBe(true);
    });

    it('machine-translates a translatable source and dual-fetches source text', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('tlang=vi')) {
          return {
            ok: true,
            text: async () => json3([{ startMs: 0, durMs: 2500, text: 'Xin chào mọi người.' }]),
          };
        }
        return {
          ok: true,
          text: async () => json3([{ startMs: 0, durMs: 2500, text: 'Hello everyone.' }]),
        };
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchYoutubeCaptionTranslation('vid-tlang', {
        targetLanguage: 'vi',
        preferredLang: 'en',
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=vid-tlang&lang=en&fmt=json3&c=WEB&pot=TOKEN123',
            languageCode: 'en',
            isTranslatable: true,
          },
        ],
      });

      expect(transcript.segments[0].translatedText).toMatch(/Xin chào/);
      expect(transcript.segments[0].sourceText).toMatch(/Hello everyone/);
      const tlangUrl = mockFetch.mock.calls.map((c: string[]) => String(c[0])).find((u: string) => u.includes('tlang=vi'));
      expect(tlangUrl).toContain('pot=TOKEN123');
      expect(tlangUrl).toContain('fmt=json3');
    });

    it('machine-translates a POT source track when isTranslatable is omitted (player audio-track shape)', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('tlang=vi')) {
          return {
            ok: true,
            text: async () => json3([{ startMs: 0, durMs: 2500, text: 'Xin chào mọi người.' }]),
          };
        }
        return {
          ok: true,
          text: async () => json3([{ startMs: 0, durMs: 2500, text: 'Hello everyone.' }]),
        };
      });

      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchYoutubeCaptionTranslation('EkA4pqXgta0', {
        targetLanguage: 'vi',
        preferredLang: 'en',
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=EkA4pqXgta0&lang=en&fmt=json3&c=WEB&pot=TOKEN123',
            languageCode: 'en',
          },
        ],
      });

      expect(transcript.segments[0].translatedText).toMatch(/Xin chào/);
      expect(mockFetch.mock.calls.some((c: string[]) => String(c[0]).includes('tlang=vi'))).toBe(true);
    });

    it('throws a YouTube Caption Translation unavailable error when no track is translatable', async () => {
      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      await expect(
        fetcher.fetchYoutubeCaptionTranslation('vid-none', {
          targetLanguage: 'vi',
          preferredLang: 'en',
          captionTracks: [
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=vid-none&lang=en&pot=T',
              languageCode: 'en',
              isTranslatable: false,
            },
          ],
        }),
      ).rejects.toThrow(/YouTube Caption Translation unavailable/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('surfaces HTTP 429 from machine translation', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => '',
      });
      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch, retryDelaysMs: [] });
      await expect(
        fetcher.fetchYoutubeCaptionTranslation('vid-429', {
          targetLanguage: 'vi',
          preferredLang: 'en',
          captionTracks: [
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=vid-429&lang=en&pot=T',
              languageCode: 'en',
              isTranslatable: true,
            },
          ],
        }),
      ).rejects.toThrow(/http-429/i);
    });

    it('keeps Dub Track text when source cues do not overlap', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('tlang=vi')) {
          return {
            ok: true,
            text: async () => json3([{ startMs: 8000, durMs: 2000, text: 'Dịch lệch.' }]),
          };
        }
        return {
          ok: true,
          text: async () => json3([{ startMs: 0, durMs: 1000, text: 'Hello.' }]),
        };
      });
      const fetcher = new TranscriptFetcher({ fetchFn: mockFetch });
      const transcript = await fetcher.fetchYoutubeCaptionTranslation('vid-gap', {
        targetLanguage: 'vi',
        preferredLang: 'en',
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=vid-gap&lang=en&pot=T',
            languageCode: 'en',
            isTranslatable: true,
          },
        ],
      });
      expect(transcript.segments[0].translatedText).toMatch(/Dịch lệch/);
      expect(transcript.segments[0].sourceText).toBe('');
    });
  });
});
