import { describe, it, expect, vi } from 'vitest';
import { createBackendTtsRouter } from '../src/core/tts/backend-tts-router';
import { DEFAULT_HOAI_MY_VOICE } from '../src/core/tts/voices';

vi.mock('../src/core/extension-runtime', () => ({
  sendExtensionMessage: vi.fn(),
}));

function mp3Response() {
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x01]);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer,
    headers: { get: () => 'audio/mpeg' },
  };
}

describe('createBackendTtsRouter', () => {
  it('posts /v1/tts and returns base64 mp3', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mp3Response());
    const router = createBackendTtsRouter({
      fetchFn,
      getSettings: async () => ({
        backendUrl: 'http://127.0.0.1:8787',
        backendApiKey: 'k',
        ttsProvider: 'backend',
      }),
    });
    const result = await router.synthesize('Xin chào', DEFAULT_HOAI_MY_VOICE);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected backend TTS success');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.audioBase64).toBeTruthy();
    expect(String(fetchFn.mock.calls[0][0])).toBe('http://127.0.0.1:8787/v1/tts');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
  });

  it('does not call the backend or trip the breaker for empty text', async () => {
    const fetchFn = vi.fn();
    const router = createBackendTtsRouter({
      fetchFn,
      getSettings: async () => ({
        backendUrl: 'http://127.0.0.1:8787',
        backendApiKey: 'k',
        ttsProvider: 'backend',
      }),
    });
    const result = await router.synthesize('   ', DEFAULT_HOAI_MY_VOICE);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected empty-text skip');
    expect(result.error).toMatch(/empty/i);
    expect(fetchFn).not.toHaveBeenCalled();
    fetchFn.mockResolvedValueOnce(mp3Response());
    const next = await router.synthesize('Xin chào', DEFAULT_HOAI_MY_VOICE);
    expect(next.success).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns WEB_SPEECH_REQUIRED when ttsProvider is web-speech', async () => {
    const fetchFn = vi.fn();
    const router = createBackendTtsRouter({
      fetchFn,
      getSettings: async () => ({
        backendUrl: 'http://127.0.0.1:8787',
        backendApiKey: 'k',
        ttsProvider: 'web-speech',
      }),
    });
    const result = await router.synthesize('Hi', DEFAULT_HOAI_MY_VOICE);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected web-speech short-circuit');
    expect(result.code).toBe('WEB_SPEECH_REQUIRED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('opens breaker after 3 consecutive failures and stops fetching', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('down'));
    const router = createBackendTtsRouter({
      fetchFn,
      getSettings: async () => ({
        backendUrl: 'http://127.0.0.1:8787',
        backendApiKey: 'k',
        ttsProvider: 'backend',
      }),
    });
    for (let i = 0; i < 3; i++) {
      const result = await router.synthesize('Hi', DEFAULT_HOAI_MY_VOICE);
      if (result.success) throw new Error('expected breaker failure');
      expect(result.code).toBe('BACKEND_TTS_UNAVAILABLE');
    }
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const fourth = await router.synthesize('Hi', DEFAULT_HOAI_MY_VOICE);
    if (fourth.success) throw new Error('expected open-breaker failure');
    expect(fourth.code).toBe('BACKEND_TTS_UNAVAILABLE');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    router.resetBreaker();
    fetchFn.mockResolvedValueOnce(mp3Response());
    const recovered = await router.synthesize('Hi', DEFAULT_HOAI_MY_VOICE);
    expect(recovered.success).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});

describe('BackgroundDubbingTtsClient (no in-page Edge fallback)', () => {
  it('throws BACKEND_TTS_UNAVAILABLE instead of constructing EdgeTtsClient', async () => {
    const { sendExtensionMessage } = await import('../src/core/extension-runtime');
    vi.mocked(sendExtensionMessage).mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    const { BackgroundDubbingTtsClient } = await import('../src/core/tts/background-tts-client');
    const client = new BackgroundDubbingTtsClient();
    await expect(client.synthesize('Hi')).rejects.toThrow(/Receiving end does not exist/);
  });

  it('surfaces router BACKEND_TTS_UNAVAILABLE failures without fake audio', async () => {
    const { sendExtensionMessage } = await import('../src/core/extension-runtime');
    vi.mocked(sendExtensionMessage).mockResolvedValueOnce({
      success: false,
      code: 'BACKEND_TTS_UNAVAILABLE',
      error: 'Backend TTS breaker open after 3 consecutive failures',
    });
    const { BackgroundDubbingTtsClient } = await import('../src/core/tts/background-tts-client');
    const client = new BackgroundDubbingTtsClient();
    await expect(client.synthesize('Hi')).rejects.toThrow(/breaker open/);
  });

  it('speaks via Web Speech on WEB_SPEECH_REQUIRED and does not return an audio blob', async () => {
    const { sendExtensionMessage } = await import('../src/core/extension-runtime');
    vi.mocked(sendExtensionMessage).mockResolvedValueOnce({
      success: false,
      code: 'WEB_SPEECH_REQUIRED',
      error: 'Web Speech TTS selected; synthesize in page',
    });
    const speak = vi.fn().mockResolvedValue(undefined);
    const { BackgroundDubbingTtsClient } = await import('../src/core/tts/background-tts-client');
    const client = new BackgroundDubbingTtsClient({
      webSpeech: { speak },
    });
    await expect(client.synthesize('Xin chào')).rejects.toThrow(/WEB_SPEECH_REQUIRED|Web Speech/);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0]).toBe('Xin chào');
  });
});
