import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OpenAiCompatibleTranslationClient,
  normalizeEndpoint,
  createTranslationClient,
  GeminiTranslationClient,
  TranslationError,
  TranslationErrorCode,
} from '../src/core/translation/index';
import type { FetchFn } from '../src/core/translation/index';
import { pingOpenAiConnection } from '../src/storage/settings';
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
    makeSegment({ id: 's1', startTime: 0, endTime: 4, duration: 4, sourceText: 'Good morning everyone.' }),
    makeSegment({ id: 's2', startTime: 4, endTime: 8, duration: 4, sourceText: 'Welcome back to the lecture.' }),
  ],
};

function makeOpenAiSuccessResponse(contentString: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'chatcmpl-test-123',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: contentString,
          },
          finish_reason: 'stop',
        },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeEndpoint', () => {
  it('appends /chat/completions to base URL without trailing slash', () => {
    expect(normalizeEndpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('appends /chat/completions to base URL with trailing slash', () => {
    expect(normalizeEndpoint('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('preserves URL if it already ends with /chat/completions', () => {
    expect(normalizeEndpoint('https://my-proxy.internal/v1/chat/completions')).toBe(
      'https://my-proxy.internal/v1/chat/completions'
    );
  });

  it('preserves URL if it ends with /chat/completions/ (strips trailing slash)', () => {
    expect(normalizeEndpoint('https://my-proxy.internal/v1/chat/completions/')).toBe(
      'https://my-proxy.internal/v1/chat/completions'
    );
  });

  it('handles local URLs like Ollama or vLLM', () => {
    expect(normalizeEndpoint('http://localhost:11434/v1')).toBe(
      'http://localhost:11434/v1/chat/completions'
    );
  });
});

describe('OpenAiCompatibleTranslationClient', () => {
  let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

  beforeEach(() => {
    mockFetch = vi.fn<FetchFn>();
  });

  it('translates segments and maps diarization and translated text', async () => {
    const payload = JSON.stringify({
      translations: [
        { id: 's1', translatedText: 'Chào buổi sáng mọi người.', speakerGender: 'female' },
        { id: 's2', translatedText: 'Chào mừng quay trở lại bài giảng.', speakerGender: 'male' },
      ],
    });

    mockFetch.mockResolvedValueOnce(makeOpenAiSuccessResponse(payload));

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://custom-proxy.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-secret-key',
      fetchFn: mockFetch,
    });

    const results = await client.translateSegments(BASE_TRANSCRIPT.segments, { targetLanguage: 'vi' });

    expect(results).toHaveLength(2);
    expect(results[0].translatedText).toBe('Chào buổi sáng mọi người.');
    expect(results[0].speakerGender).toBe('female');
    expect(results[1].translatedText).toBe('Chào mừng quay trở lại bài giảng.');
    expect(results[1].speakerGender).toBe('male');

    // Verify fetch call details
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://custom-proxy.com/v1/chat/completions');
    expect(calledInit?.method).toBe('POST');
    expect((calledInit?.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-secret-key');
    expect((calledInit?.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const parsedBody = JSON.parse(calledInit?.body as string);
    expect(parsedBody.model).toBe('gpt-4o-mini');
    expect(parsedBody.temperature).toBe(0.3);
    expect(parsedBody.response_format).toEqual({ type: 'json_object' });
    expect(parsedBody.messages).toHaveLength(2);
  });

  it('omits Authorization header when apiKey is not provided or empty', async () => {
    const payload = JSON.stringify({
      translations: [
        { id: 's1', translatedText: 'Chào buổi sáng.', speakerGender: 'male' },
        { id: 's2', translatedText: 'Chào mừng.', speakerGender: 'female' },
      ],
    });
    mockFetch.mockResolvedValueOnce(makeOpenAiSuccessResponse(payload));

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'http://localhost:11434/v1',
      model: 'llama3',
      apiKey: '',
      fetchFn: mockFetch,
    });

    await client.translateSegments(BASE_TRANSCRIPT.segments);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0];
    const headers = (calledInit?.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBeUndefined();
  });

  it('translates full transcript preserving metadata and setting targetLanguage', async () => {
    const payload = JSON.stringify({
      translations: [
        { id: 's1', translatedText: 'Chào buổi sáng mọi người.', speakerGender: 'female' },
        { id: 's2', translatedText: 'Chào mừng quay trở lại bài giảng.', speakerGender: 'male' },
      ],
    });
    mockFetch.mockResolvedValueOnce(makeOpenAiSuccessResponse(payload));

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-123',
      fetchFn: mockFetch,
    });

    const result = await client.translateTranscript(BASE_TRANSCRIPT, { targetLanguage: 'vi' });

    expect(result.videoId).toBe('vid-001');
    expect(result.sourceLanguage).toBe('en');
    expect(result.targetLanguage).toBe('vi');
    expect(result.segments[0].translatedText).toBe('Chào buổi sáng mọi người.');
    expect(result.segments[0].speakerGender).toBe('female');
  });

  it('strips markdown code fences from response content', async () => {
    const payload = '```json\n{"translations": [{"id": "s1", "translatedText": "Đã dịch", "speakerGender": "male"}]}\n```';
    mockFetch.mockResolvedValueOnce(makeOpenAiSuccessResponse(payload));

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    const results = await client.translateSegments([BASE_TRANSCRIPT.segments[0]]);
    expect(results[0].translatedText).toBe('Đã dịch');
    expect(results[0].speakerGender).toBe('male');
  });

  it('retries once without response_format if proxy returns 400 mentioning response_format', async () => {
    // First call fails with 400 mentioning response_format
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error": {"message": "response_format is not supported by this proxy"}}',
      json: async () => ({ error: { message: "response_format is not supported by this proxy" } }),
    });

    // Second call succeeds
    const payload = JSON.stringify({
      translations: [{ id: 's1', translatedText: 'Bản dịch dự phòng', speakerGender: 'female' }],
    });
    mockFetch.mockResolvedValueOnce(makeOpenAiSuccessResponse(payload));

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'http://localhost:8080/v1',
      model: 'custom-llm',
      fetchFn: mockFetch,
    });

    const results = await client.translateSegments([BASE_TRANSCRIPT.segments[0]]);
    expect(results[0].translatedText).toBe('Bản dịch dự phòng');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify the second request had no response_format
    const [, secondInit] = mockFetch.mock.calls[1];
    const secondBody = JSON.parse(secondInit?.body as string);
    expect(secondBody.response_format).toBeUndefined();
  });

  it('throws TranslationError with RATE_LIMITED on HTTP 429', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    });

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      fetchFn: mockFetch,
    });

    await expect(client.translateSegments(BASE_TRANSCRIPT.segments)).rejects.toMatchObject({
      code: TranslationErrorCode.RATE_LIMITED,
    });
  });

  it('throws TranslationError with AUTH_ERROR on HTTP 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
      json: async () => ({ error: { message: 'Invalid API key' } }),
    });

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      fetchFn: mockFetch,
    });

    await expect(client.translateSegments(BASE_TRANSCRIPT.segments)).rejects.toMatchObject({
      code: TranslationErrorCode.AUTH_ERROR,
    });
  });

  it('throws TranslationError with INVALID_RESPONSE on malformed JSON content', async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAiSuccessResponse('Not valid JSON here'));

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      fetchFn: mockFetch,
    });

    await expect(client.translateSegments(BASE_TRANSCRIPT.segments)).rejects.toMatchObject({
      code: TranslationErrorCode.INVALID_RESPONSE,
    });
  });
});

describe('pingOpenAiConnection', () => {
  it('returns ok: false when endpoint is empty', async () => {
    const res = await pingOpenAiConnection('', 'gpt-4o-mini');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/endpoint.*required/i);
  });

  it('returns ok: false when model is empty', async () => {
    const res = await pingOpenAiConnection('https://api.openai.com/v1', '');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/model.*required/i);
  });

  it('normalizes endpoint and returns ok: true with latency on HTTP 200', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Pong' } }] }),
      };
    });

    const res = await pingOpenAiConnection(
      'https://api.openai.com/v1',
      'gpt-4o-mini',
      'test-api-key',
      mockFetch
    );

    expect(res.ok).toBe(true);
    expect(res.latencyMs).toBeGreaterThanOrEqual(20);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect((calledInit?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-api-key');

    const body = JSON.parse(calledInit?.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(5);
  });

  it('omits Authorization header when apiKey is empty in ping', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    const res = await pingOpenAiConnection(
      'http://localhost:11434/v1',
      'llama3',
      '',
      mockFetch
    );

    expect(res.ok).toBe(true);
    const [, calledInit] = mockFetch.mock.calls[0];
    const headers = (calledInit?.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBeUndefined();
  });

  it('returns ok: false with error details on HTTP error status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'Incorrect API key provided' } }),
    });

    const res = await pingOpenAiConnection(
      'https://api.openai.com/v1',
      'gpt-4o-mini',
      'bad-key',
      mockFetch
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Incorrect API key provided');
  });

  it('catches network errors gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const res = await pingOpenAiConnection(
      'http://localhost:9999/v1',
      'gpt-4o-mini',
      undefined,
      mockFetch
    );

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Connection refused/i);
  });
});

describe('createTranslationClient factory', () => {
  it('instantiates OpenAiCompatibleTranslationClient when provider is openai-compatible', () => {
    const client = createTranslationClient({
      translationProvider: 'openai-compatible',
      openaiEndpoint: 'https://proxy.example.com/v1',
      openaiModel: 'custom-model',
      openaiApiKey: 'sk-test',
    });

    expect(client).toBeInstanceOf(OpenAiCompatibleTranslationClient);
  });

  it('instantiates GeminiTranslationClient when provider is gemini', () => {
    const client = createTranslationClient({
      translationProvider: 'gemini',
      geminiApiKey: 'AIzaSyTest',
    });

    expect(client).toBeInstanceOf(GeminiTranslationClient);
  });

  it('defaults to OpenAiCompatibleTranslationClient or GeminiTranslationClient when provider unspecified', () => {
    const client = createTranslationClient({});
    expect(client).toBeDefined();
  });
});

describe('OpenAI non-JSON envelope diagnostics (proxy transparency)', () => {
  const makeSeg = (id: string) => ({
    id,
    startTime: 0,
    endTime: 5,
    duration: 5,
    sourceText: 'Hello',
  });

  function nonJsonResponse(rawBody: string, contentType = 'text/html') {
    return {
      ok: true,
      status: 200,
      headers: { get: () => contentType },
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
      clone: () => ({ text: async () => rawBody }),
    };
  }

  it('reports status, content-type and body snippet when the envelope is not JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      nonJsonResponse('<html><body>Proxy login required</body></html>')
    );
    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://proxy.internal/v1',
      model: 'm',
      apiKey: 'sk',
      fetchFn: mockFetch as any,
    });

    await expect(client.translateSegments([makeSeg('s1') as any], { targetLanguage: 'vi' })).rejects.toThrow(
      /non-JSON body.*200.*text\/html.*Proxy login required/
    );
  });

  it('reports <empty body> when the proxy returns nothing', async () => {
    const mockFetch = vi.fn().mockResolvedValue(nonJsonResponse('   '));
    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://proxy.internal/v1',
      model: 'm',
      apiKey: 'sk',
      fetchFn: mockFetch as any,
    });

    await expect(client.translateSegments([makeSeg('s1') as any], { targetLanguage: 'vi' })).rejects.toThrow(
      /<empty body>/
    );
  });

  it('accepts a direct translations payload without the OpenAI envelope', async () => {
    const direct = JSON.stringify({ translations: [{ id: 's1', translatedText: 'Xin chào' }] });
    const mockFetch = vi.fn().mockResolvedValue(nonJsonResponse(direct, 'text/plain'));
    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://proxy.internal/v1',
      model: 'm',
      apiKey: 'sk',
      fetchFn: mockFetch as any,
    });

    const [seg] = await client.translateSegments([makeSeg('s1') as any], { targetLanguage: 'vi' });
    expect(seg.translatedText).toBe('Xin chào');
  });

  it('explicitly includes stream: false in the request body', async () => {
    const payload = JSON.stringify({
      translations: [{ id: 's1', translatedText: 'Xin chào' }],
    });
    const mockFetch = vi.fn().mockResolvedValue(makeOpenAiSuccessResponse(payload));
    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://proxy.internal/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      fetchFn: mockFetch as any,
    });

    await client.translateSegments([makeSeg('s1') as any], { targetLanguage: 'vi' });

    const calledInit = mockFetch.mock.calls[0][1];
    const parsedBody = JSON.parse(calledInit.body);
    expect(parsedBody.stream).toBe(false);
  });

  it('handles OpenAI SSE streaming responses (text/event-stream)', async () => {
    const sseBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"{\\"translations\\": "}}]}\n\n',
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"[{\\"id\\": \\"s1\\", \\"translatedText\\": \\"Xin chào thế giới\\", \\"speakerGender\\": \\"female\\"}]}"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      text: async () => sseBody,
    });

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://proxy.internal/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      fetchFn: mockFetch as any,
    });

    const [seg] = await client.translateSegments([makeSeg('s1') as any], { targetLanguage: 'vi' });
    expect(seg.translatedText).toBe('Xin chào thế giới');
    expect(seg.speakerGender).toBe('female');
  });

  it('handles SSE streaming responses even when content-type header is omitted or generic', async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"{\\"translations\\": [{\\"id\\": \\"s1\\", \\"translatedText\\": \\"Chào buổi sáng\\"}]}"}}]}\n',
      'data: [DONE]\n',
    ].join('');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      text: async () => sseBody,
    });

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://proxy.internal/v1',
      model: 'gpt-4o-mini',
      fetchFn: mockFetch as any,
    });

    const [seg] = await client.translateSegments([makeSeg('s1') as any], { targetLanguage: 'vi' });
    expect(seg.translatedText).toBe('Chào buổi sáng');
  });
});
