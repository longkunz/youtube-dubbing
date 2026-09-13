import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defaultFetch } from '../src/core/default-fetch';
import { BackendTranslationClient } from '../src/core/translation/backend-client';
import { pingBackendConnection } from '../src/storage/settings';
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

  it('BackendTranslationClient works without explicit fetchFn', async () => {
    inner = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ id: 's1', text: 'Xin chào' }],
      }),
    });

    const client = new BackendTranslationClient({
      baseUrl: 'http://127.0.0.1:8787',
      apiKey: 'k',
    });
    const [seg] = await client.translateSegments([makeSegment('s1')], { targetLanguage: 'vi' });
    expect(seg.translatedText).toBe('Xin chào');
  });

  it('pingBackendConnection works with the default fetch', async () => {
    inner = async (url: string) => {
      if (url.includes('/v1/health')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, tts: 'zerotts' }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    };
    const res = await pingBackendConnection('http://127.0.0.1:8787', 'key-123');
    expect(res.ok).toBe(true);
  });
});
