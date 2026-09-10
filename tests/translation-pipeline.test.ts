import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiTranslationClient, TranslationError, TranslationErrorCode } from '../src/core/translation/index';
import type { FetchFn } from '../src/core/translation/index';
import type { Transcript, Segment } from '../src/types/domain';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSegment = (overrides: Partial<Segment> & { id: string }): Segment => ({
  startTime: 0,
  endTime: 5,
  duration: 5,
  sourceText: 'Hello world',
  ...overrides,
});

const BASE_TRANSCRIPT: Transcript = {
  videoId: 'vid-001',
  sourceLanguage: 'en',
  segments: [
    makeSegment({ id: 's1', startTime: 0, endTime: 4, duration: 4, sourceText: 'Hello everyone, welcome to the channel.' }),
    makeSegment({ id: 's2', startTime: 4, endTime: 9, duration: 5, sourceText: 'Today we will be building a Chrome extension.' }),
    makeSegment({ id: 's3', startTime: 9, endTime: 14, duration: 5, sourceText: "Let's get started!" }),
  ],
};

const TRANSLATED_SEGMENTS_JSON = {
  translations: [
    { id: 's1', translatedText: 'Xin chào mọi người, chào mừng đến kênh.' },
    { id: 's2', translatedText: 'Hôm nay chúng ta sẽ xây dựng một Chrome extension.' },
    { id: 's3', translatedText: 'Hãy bắt đầu nào!' },
  ],
};

function makeOkResponse(body: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: body }],
          },
        },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// GeminiTranslationClient — constructor options
// ---------------------------------------------------------------------------

describe('GeminiTranslationClient', () => {
  let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

  beforeEach(() => {
    mockFetch = vi.fn<FetchFn>();
  });

  // -------------------------------------------------------------------------
  // Constructor / init
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('accepts explicit apiKey and does not throw', () => {
      expect(() => new GeminiTranslationClient({ apiKey: 'key-abc', fetchFn: mockFetch })).not.toThrow();
    });

    it('accepts no apiKey (will read from storage at call-time)', () => {
      expect(() => new GeminiTranslationClient({ fetchFn: mockFetch })).not.toThrow();
    });

    it('uses gemini-3.8-flash as default model', () => {
      const client = new GeminiTranslationClient({ apiKey: 'key', fetchFn: mockFetch });
      expect((client as any).model).toBe('gemini-3.8-flash');
    });

    it('accepts custom model override', () => {
      const client = new GeminiTranslationClient({ apiKey: 'key', model: 'gemini-1.5-flash', fetchFn: mockFetch });
      expect((client as any).model).toBe('gemini-1.5-flash');
    });
  });

  // -------------------------------------------------------------------------
  // translateTranscript — happy path
  // -------------------------------------------------------------------------

  describe('translateTranscript', () => {
    it('returns a Transcript with translatedText enriched on each segment', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      expect(result.videoId).toBe('vid-001');
      expect(result.sourceLanguage).toBe('en');
      expect(result.targetLanguage).toBe('vi');
      expect(result.segments).toHaveLength(3);

      expect(result.segments[0].id).toBe('s1');
      expect(result.segments[0].translatedText).toBe('Xin chào mọi người, chào mừng đến kênh.');
      expect(result.segments[1].translatedText).toBe('Hôm nay chúng ta sẽ xây dựng một Chrome extension.');
      expect(result.segments[2].translatedText).toBe('Hãy bắt đầu nào!');
    });

    it('preserves all original Segment properties (startTime, endTime, duration, sourceText)', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      const seg = result.segments[0];
      expect(seg.startTime).toBe(0);
      expect(seg.endTime).toBe(4);
      expect(seg.duration).toBe(4);
      expect(seg.sourceText).toBe('Hello everyone, welcome to the channel.');
    });

    it('strips markdown code-block fences from Gemini response', async () => {
      const fencedBody = '```json\n' + JSON.stringify(TRANSLATED_SEGMENTS_JSON) + '\n```';
      mockFetch.mockResolvedValueOnce(makeOkResponse(fencedBody));

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      expect(result.segments[0].translatedText).toBe('Xin chào mọi người, chào mừng đến kênh.');
    });

    it('defaults targetLanguage to "vi" when not specified', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      const result = await client.translateTranscript(BASE_TRANSCRIPT);

      expect(result.targetLanguage).toBe('vi');
    });

    it('calls the Gemini REST endpoint with correct URL containing the api key', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({ apiKey: 'my-secret-key', fetchFn: mockFetch });
      await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('gemini-3.8-flash');
      expect(calledUrl).toContain('my-secret-key');
      expect(calledUrl).toContain('generateContent');
    });

    it('trims whitespace from the API key and model before constructing the URL', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({
        apiKey: '  my-secret-key  ',
        model: '  gemini-3.8-flash  ',
        fetchFn: mockFetch,
      });
      await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('gemini-3.8-flash');
      expect(calledUrl).toContain('my-secret-key');
      expect(calledUrl).not.toContain('%20');
    });
  });

  // -------------------------------------------------------------------------
  // translateSegments
  // -------------------------------------------------------------------------

  describe('translateSegments', () => {
    it('translates an array of segments and returns enriched segments', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      const result = await client.translateSegments(BASE_TRANSCRIPT.segments, { targetLanguage: 'vi' });

      expect(result).toHaveLength(3);
      expect(result[0].translatedText).toBe('Xin chào mọi người, chào mừng đến kênh.');
      expect(result[2].translatedText).toBe('Hãy bắt đầu nào!');
    });

    it('preserves segments that have no translation mapping (leaves translatedText unchanged)', async () => {
      const partialResponse = {
        translations: [
          { id: 's1', translatedText: 'Xin chào' },
          // s2 is intentionally missing
          { id: 's3', translatedText: 'Bắt đầu!' },
        ],
      };
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(partialResponse)));

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      const result = await client.translateSegments(BASE_TRANSCRIPT.segments, { targetLanguage: 'vi' });

      expect(result[1].translatedText).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws TranslationError with API_KEY_MISSING when no api key is available', async () => {
      // Mock chrome.storage.local to return nothing
      const chromeMock = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({}),
          },
        },
      };
      (globalThis as any).chrome = chromeMock;

      const client = new GeminiTranslationClient({ fetchFn: mockFetch });

      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toThrow(TranslationError);
      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toMatchObject({
        code: TranslationErrorCode.API_KEY_MISSING,
      });

      delete (globalThis as any).chrome;
    });

    it('throws TranslationError with RATE_LIMITED on HTTP 429', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toMatchObject({
        code: TranslationErrorCode.RATE_LIMITED,
      });
    });

    it('throws TranslationError with AUTH_ERROR on HTTP 401', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toMatchObject({
        code: TranslationErrorCode.AUTH_ERROR,
      });
    });

    it('throws TranslationError with AUTH_ERROR on HTTP 403', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toMatchObject({
        code: TranslationErrorCode.AUTH_ERROR,
      });
    });

    it('throws TranslationError with NETWORK_ERROR on fetch rejection', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toMatchObject({
        code: TranslationErrorCode.NETWORK_ERROR,
      });
    });

    it('throws TranslationError with INVALID_RESPONSE when Gemini returns empty candidates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [] }),
      });

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toMatchObject({
        code: TranslationErrorCode.INVALID_RESPONSE,
      });
    });

    it('throws TranslationError with INVALID_RESPONSE when Gemini response is not valid JSON', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse('This is not JSON at all!'));

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toMatchObject({
        code: TranslationErrorCode.INVALID_RESPONSE,
      });
    });

    it('includes Gemini error.message in the thrown error on non-2xx responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
      });

      const client = new GeminiTranslationClient({ apiKey: 'key-test', fetchFn: mockFetch });
      await expect(client.translateTranscript(BASE_TRANSCRIPT)).rejects.toMatchObject({
        code: TranslationErrorCode.NETWORK_ERROR,
        message: expect.stringContaining('API key not valid. Please pass a valid API key.'),
      });
    });

    it('falls back to gemini-3.8-flash when gemini-2.5-flash returns HTTP 404', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              message:
                'models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent.',
            },
          }),
        })
        .mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({
        apiKey: 'key-test',
        model: 'gemini-2.5-flash',
        fetchFn: mockFetch,
      });
      const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      expect(result.segments[0].translatedText).toBe('Xin chào mọi người, chào mừng đến kênh.');
      expect(mockFetch.mock.calls[0][0] as string).toContain('gemini-2.5-flash');
      expect(mockFetch.mock.calls[1][0] as string).toContain('gemini-3.8-flash');
      expect(mockFetch.mock.calls.map((call) => String(call[0])).join(' ')).not.toContain(
        'gemini-1.5-flash',
      );
    });

    it('retries a current Flash model when a deprecated gemini-1.5-flash config returns 404', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              message:
                'models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods.',
            },
          }),
        })
        .mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({
        apiKey: 'key-test',
        model: 'gemini-1.5-flash',
        fetchFn: mockFetch,
      });
      const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      expect(result.segments[0].translatedText).toBe('Xin chào mọi người, chào mừng đến kênh.');
      expect(mockFetch.mock.calls[0][0] as string).toContain('gemini-1.5-flash');
      expect(mockFetch.mock.calls[1][0] as string).toContain('gemini-3.8-flash');
    });

    it('lists available models and retries generateContent when hardcoded fallbacks also 404', async () => {
      const notFound = (model: string) => ({
        ok: false,
        status: 404,
        json: async () => ({ error: { message: `models/${model} is not found` } }),
      });

      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes(':generateContent')) {
          if (url.includes('gemini-3.6-flash')) {
            return makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON));
          }
          return notFound('unavailable');
        }
        if (url.includes('/v1beta/models?') || /\/v1beta\/models\?key=/.test(url)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              models: [
                {
                  name: 'models/gemini-3.6-flash',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }),
          };
        }
        return notFound('unexpected');
      });

      const client = new GeminiTranslationClient({
        apiKey: 'key-test',
        model: 'gemini-2.5-flash',
        fetchFn: mockFetch,
      });
      const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      expect(result.segments[0].translatedText).toBe('Xin chào mọi người, chào mừng đến kênh.');
      const urls = mockFetch.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes('/v1beta/models?') && !url.includes('generateContent'))).toBe(
        true,
      );
      expect(urls.some((url) => url.includes('gemini-3.6-flash') && url.includes('generateContent'))).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Storage helper — reads from chrome.storage.local
  // -------------------------------------------------------------------------

  describe('storage API key resolution', () => {
    it('reads geminiApiKey from chrome.storage.local when no apiKey passed in options', async () => {
      const chromeMock = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({ geminiApiKey: 'storage-key-xyz' }),
          },
        },
      };
      (globalThis as any).chrome = chromeMock;

      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({ fetchFn: mockFetch });
      const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      expect(result.segments[0].translatedText).toBeDefined();

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('storage-key-xyz');

      delete (globalThis as any).chrome;
    });

    it('falls back to "apiKey" key in storage if "geminiApiKey" is absent', async () => {
      const chromeMock = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({ apiKey: 'fallback-key-abc' }),
          },
        },
      };
      (globalThis as any).chrome = chromeMock;

      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(TRANSLATED_SEGMENTS_JSON)));

      const client = new GeminiTranslationClient({ fetchFn: mockFetch });
      const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

      expect(result.segments[0].translatedText).toBeDefined();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('fallback-key-abc');

      delete (globalThis as any).chrome;
    });
  });
});
