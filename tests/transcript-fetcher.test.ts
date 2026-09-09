import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptFetcher } from '../src/core/transcript/fetcher';
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
});
