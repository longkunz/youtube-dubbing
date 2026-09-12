import { describe, it, expect, vi } from 'vitest';
import { BackendTranslationClient, createTranslationClient } from '../src/core/translation/index';
import type { Segment } from '../src/types/domain';

const segments: Segment[] = [
  { id: '12', startTime: 0, endTime: 2, duration: 2, sourceText: 'Welcome back' },
  { id: '13', startTime: 2, endTime: 4, duration: 2, sourceText: 'Hello' },
];

describe('BackendTranslationClient', () => {
  it('posts cues and maps items onto translatedText by id without speakerGender', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: '13', text: 'Xin chào' },
          { id: '12', text: 'Chào mừng quay lại' },
        ],
      }),
    });
    const client = new BackendTranslationClient({
      baseUrl: 'http://127.0.0.1:8787/',
      apiKey: 'secret',
      fetchFn,
    });
    const out = await client.translateSegments(segments, { targetLanguage: 'vi' });
    expect(out[0].translatedText).toBe('Chào mừng quay lại');
    expect(out[1].translatedText).toBe('Xin chào');
    expect(out[0].speakerGender).toBeUndefined();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/v1/translate');
    expect(init.headers.Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body);
    expect(body.source).toBe('en');
    expect(body.target).toBe('vi');
    expect(body.cues).toEqual([
      { id: '12', text: 'Welcome back' },
      { id: '13', text: 'Hello' },
    ]);
  });
});

describe('createTranslationClient self-hosted', () => {
  it('does not construct Gemini when provider is self-hosted', () => {
    const fetchFn = vi.fn();
    const client = createTranslationClient(
      { translationProvider: 'self-hosted', backendUrl: 'http://127.0.0.1:8787', backendApiKey: 'k' },
      { fetchFn },
    );
    expect(client).toBeInstanceOf(BackendTranslationClient);
  });
});
