import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defaultFetch } from '../src/core/default-fetch';
import { OpenAiCompatibleTranslationClient } from '../src/core/translation/openai-client';
import { GeminiTranslationClient } from '../src/core/translation/gemini-client';
import { pingGeminiConnection, pingOpenAiConnection } from '../src/storage/settings';
import type { Segment } from '../src/types/domain';

/**
 * Regression test for: `Failed to execute 'fetch' on 'WorkerGlobalScope':
 * Illegal invocation` from the background service worker.
 *
 * Storing `globalThis.fetch` in a variable and calling it detached loses the
 * receiver, which WorkerGlobalScope rejects. This suite replaces
 * `globalThis.fetch` with a receiver-strict stub (behaving like the worker)
 * and verifies every default fetch path still works.
 */

const realFetch = globalThis.fetch;

let inner: (url: any, init?: any) => Promise<any>;

function strictFetch(this: unknown, url: any, init?: any): Promise<any> {
  if (this !== globalThis) {
    throw new TypeError(
      "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation"
    );
  }
  return inner(url, init);
}

beforeEach(() => {
  inner = async () => {
    throw new Error('test inner fetch not configured');
  };
  (globalThis as any).fetch = strictFetch;
});

afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

const makeSegment = (id: string): Segment => ({
  id,
  startTime: 0,
  endTime: 5,
  duration: 5,
  sourceText: 'Hello world',
});

describe('worker-strict fetch binding', () => {
  it('documents the simulated worker behavior: detached fetch throws', () => {
    const detached = globalThis.fetch;
    expect(() => (detached as any)('https://example.com')).toThrow(/Illegal invocation/);
  });

  it('defaultFetch preserves the receiver', async () => {
    inner = async () => ({ ok: true });
    await expect(defaultFetch('https://example.com')).resolves.toEqual({ ok: true });
  });

  it('OpenAI client works without explicit fetchFn (background TRANSLATE_SEGMENTS path)', async () => {
    inner = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                translations: [{ id: 's1', translatedText: 'Xin chào' }],
              }),
            },
          },
        ],
      }),
    });

    const client = new OpenAiCompatibleTranslationClient({
      endpoint: 'https://proxy.internal/v1',
      model: 'test-model',
      apiKey: 'sk-test',
    });
    const [seg] = await client.translateSegments([makeSegment('s1')], { targetLanguage: 'vi' });
    expect(seg.translatedText).toBe('Xin chào');
  });

  it('Gemini client works without explicit fetchFn', async () => {
    inner = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: [{ id: 's1', translatedText: 'Xin chào' }],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const client = new GeminiTranslationClient({ apiKey: 'gemini-key' });
    const [seg] = await client.translateSegments([makeSegment('s1')], { targetLanguage: 'vi' });
    expect(seg.translatedText).toBe('Xin chào');
  });

  it('pingGeminiConnection works with the default fetch', async () => {
    inner = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    });
    const res = await pingGeminiConnection('key-123');
    expect(res.ok).toBe(true);
  });

  it('pingOpenAiConnection works with the default fetch', async () => {
    inner = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const res = await pingOpenAiConnection('https://proxy.internal/v1', 'm', 'sk');
    expect(res.ok).toBe(true);
  });
});
