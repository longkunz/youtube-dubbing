import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTranslationClient } from '@/core/translation/factory';
import { sendExtensionMessage } from '@/core/extension-runtime';
import {
  startDubbingPipeline,
  stopDubbingPipeline,
  resolveEngineLabel,
} from '@/entrypoints/content/orchestrator-coordinator';
import type { HudInstance } from '@/entrypoints/content/mount';
import { resetSettingsForTesting, saveSettings } from '@/storage/settings';
import { SegmentCache } from '@/storage/segment-cache';

vi.mock('@/core/orchestrator/dubbing-orchestrator', () => ({
  DubbingOrchestratorImpl: class {
    init = vi.fn().mockResolvedValue(undefined);
    destroy = vi.fn();
    handlePlay = vi.fn();
    handleTimeUpdate = vi.fn();
    handleSeek = vi.fn();
    handlePause = vi.fn();
    handleRateChange = vi.fn();
    mergeTranslatedSegments = vi.fn();
    primeInitialLookahead = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/core/tts/background-tts-client', () => ({
  BackgroundDubbingTtsClient: class {},
}));

vi.mock('@/core/translation/factory', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/translation/factory')>();
  return {
    ...orig,
    createTranslationClient: vi.fn(() => ({
      translateSegments: vi.fn().mockResolvedValue([
        {
          id: 'json-seg-1',
          startTime: 0,
          endTime: 2,
          duration: 2,
          sourceText: 'Hello.',
          translatedText: 'LLM dịch',
        },
      ]),
      translateTranscript: vi.fn(),
    })),
  };
});

vi.mock('@/core/extension-runtime', () => ({
  sendExtensionMessage: vi.fn().mockRejectedValue(new Error('Receiving end does not exist')),
}));

function json3(text: string): string {
  return JSON.stringify({
    events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: text }] }],
  });
}

function makeHud(): HudInstance {
  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  return {
    unmount: vi.fn(),
    isMounted: vi.fn().mockReturnValue(true),
    shadowRoot,
    updateOrchestrator: vi.fn(),
    updateProps: vi.fn(),
  };
}

function bridgeTracks(videoId: string, tracks: Array<Record<string, unknown>>): void {
  document.documentElement.setAttribute(
    'data-aetherdub-at',
    JSON.stringify({ videoId, tracks }),
  );
}

function setWatchUrl(videoId: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL(`https://www.youtube.com/watch?v=${videoId}`),
  });
}

describe('YouTube Caption Translation pipeline', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetSettingsForTesting();
    const cache = new SegmentCache();
    await cache.purgeAll();
    cache.close();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-aetherdub-at');
    const video = document.createElement('video');
    video.className = 'html5-main-video';
    document.body.appendChild(video);

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => json3('Xin chào.'),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    stopDubbingPipeline();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-aetherdub-at');
  });

  it('skips the LLM when a target-language Caption Track exists', async () => {
    await saveSettings({ translationProvider: 'youtube-caption-translation' });
    setWatchUrl('vid-yt-target');
    bridgeTracks('vid-yt-target', [
      {
        url: 'https://www.youtube.com/api/timedtext?v=vid-yt-target&lang=vi&pot=T',
        languageCode: 'vi',
        name: 'Vietnamese',
      },
    ]);

    const hud = makeHud();
    const orch = await startDubbingPipeline(hud, document.querySelector('video') as HTMLVideoElement, 'vi');

    expect(orch).not.toBeNull();
    expect(createTranslationClient).not.toHaveBeenCalled();
    expect(sendExtensionMessage).not.toHaveBeenCalled();
    expect(hud.updateProps).toHaveBeenCalledWith(expect.objectContaining({ engineLabel: 'YOUTUBE-CC' }));
    expect(resolveEngineLabel({ translationProvider: 'youtube-caption-translation' })).toBe('YOUTUBE-CC');
  });

  it('still calls the LLM on Gemini even when a target-language Caption Track exists', async () => {
    await saveSettings({ translationProvider: 'gemini', geminiApiKey: 'AIzaSyTest' });
    setWatchUrl('vid-yt-gemini');
    bridgeTracks('vid-yt-gemini', [
      {
        url: 'https://www.youtube.com/api/timedtext?v=vid-yt-gemini&lang=vi&pot=T',
        languageCode: 'vi',
        name: 'Vietnamese',
      },
    ]);

    const hud = makeHud();
    await startDubbingPipeline(hud, document.querySelector('video') as HTMLVideoElement, 'vi');

    expect(createTranslationClient).toHaveBeenCalled();
  });

  it('machine-translates a bridged POT track that omits isTranslatable', async () => {
    await saveSettings({ translationProvider: 'youtube-caption-translation' });
    setWatchUrl('vid-yt-omit-flag');
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('tlang=vi')) {
        return { ok: true, text: async () => json3('Xin chào từ YouTube.') };
      }
      return { ok: true, text: async () => json3('Hello from YouTube.') };
    });
    bridgeTracks('vid-yt-omit-flag', [
      {
        url: 'https://www.youtube.com/api/timedtext?v=vid-yt-omit-flag&lang=en&fmt=json3&c=WEB&pot=TOKEN123',
        languageCode: 'en',
        name: 'English',
      },
    ]);

    const hud = makeHud();
    const orch = await startDubbingPipeline(hud, document.querySelector('video') as HTMLVideoElement, 'vi');

    expect(orch).not.toBeNull();
    expect(createTranslationClient).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('tlang=vi'))).toBe(true);
  });

  it('machine-translates a translatable source without LLM batches', async () => {
    await saveSettings({ translationProvider: 'youtube-caption-translation' });
    setWatchUrl('vid-yt-tlang');
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('tlang=vi')) {
        return { ok: true, text: async () => json3('Xin chào từ YouTube.') };
      }
      return { ok: true, text: async () => json3('Hello from YouTube.') };
    });
    bridgeTracks('vid-yt-tlang', [
      {
        url: 'https://www.youtube.com/api/timedtext?v=vid-yt-tlang&lang=en&fmt=json3&c=WEB&pot=TOKEN123',
        languageCode: 'en',
        isTranslatable: true,
        name: 'English',
      },
    ]);

    const hud = makeHud();
    const orch = await startDubbingPipeline(hud, document.querySelector('video') as HTMLVideoElement, 'vi');

    expect(orch).not.toBeNull();
    expect(createTranslationClient).not.toHaveBeenCalled();
    const tlangUrl = mockFetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('tlang=vi'));
    expect(tlangUrl).toContain('pot=TOKEN123');
  });

  it('fails visibly without LLM or Whisper when translation is unavailable', async () => {
    await saveSettings({
      translationProvider: 'youtube-caption-translation',
      groqApiKey: 'gsk_test',
    });
    setWatchUrl('vid-yt-none');
    bridgeTracks('vid-yt-none', [
      {
        url: 'https://www.youtube.com/api/timedtext?v=vid-yt-none&lang=en&pot=T',
        languageCode: 'en',
        isTranslatable: false,
        name: 'English',
      },
    ]);

    const hud = makeHud();
    const orch = await startDubbingPipeline(hud, document.querySelector('video') as HTMLVideoElement, 'vi');

    expect(orch).toBeNull();
    expect(createTranslationClient).not.toHaveBeenCalled();
    expect(sendExtensionMessage).not.toHaveBeenCalled();
    expect(hud.updateProps).toHaveBeenCalledWith(expect.objectContaining({ isNoCaptions: true }));
  });

  it('fails without LLM or Whisper on HTTP 429 machine translation', async () => {
    vi.useFakeTimers();
    await saveSettings({
      translationProvider: 'youtube-caption-translation',
      groqApiKey: 'gsk_test',
    });
    setWatchUrl('vid-yt-429');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => '',
    });
    bridgeTracks('vid-yt-429', [
      {
        url: 'https://www.youtube.com/api/timedtext?v=vid-yt-429&lang=en&pot=T',
        languageCode: 'en',
        isTranslatable: true,
      },
    ]);

    const hud = makeHud();
    const pending = startDubbingPipeline(hud, document.querySelector('video') as HTMLVideoElement, 'vi');
    await vi.runAllTimersAsync();
    const orch = await pending;
    vi.useRealTimers();

    expect(orch).toBeNull();
    expect(createTranslationClient).not.toHaveBeenCalled();
    expect(sendExtensionMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TRANSCRIBE_AUDIO' }),
      expect.anything(),
    );
    expect(hud.updateProps).toHaveBeenCalledWith(expect.objectContaining({ isNoCaptions: true }));
  });

  it('does not invoke Whisper when machine translation returns an empty HTTP 200 body', async () => {
    await saveSettings({
      translationProvider: 'youtube-caption-translation',
      groqApiKey: 'gsk_test',
    });
    setWatchUrl('vid-yt-empty-body');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '   ',
    });
    bridgeTracks('vid-yt-empty-body', [
      {
        url: 'https://www.youtube.com/api/timedtext?v=vid-yt-empty-body&lang=en&pot=T',
        languageCode: 'en',
        isTranslatable: true,
      },
    ]);

    const hud = makeHud();
    const orch = await startDubbingPipeline(hud, document.querySelector('video') as HTMLVideoElement, 'vi');

    expect(orch).toBeNull();
    expect(createTranslationClient).not.toHaveBeenCalled();
    expect(sendExtensionMessage).not.toHaveBeenCalled();
    expect(hud.updateProps).toHaveBeenCalledWith(expect.objectContaining({ isNoCaptions: true }));
  });

  it('does not invoke Whisper when translated timedtext parses to zero cues', async () => {
    await saveSettings({
      translationProvider: 'youtube-caption-translation',
      groqApiKey: 'gsk_test',
    });
    setWatchUrl('vid-yt-empty-cues');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ events: [] }),
    });
    bridgeTracks('vid-yt-empty-cues', [
      {
        url: 'https://www.youtube.com/api/timedtext?v=vid-yt-empty-cues&lang=en&pot=T',
        languageCode: 'en',
        isTranslatable: true,
      },
    ]);

    const hud = makeHud();
    const orch = await startDubbingPipeline(hud, document.querySelector('video') as HTMLVideoElement, 'vi');

    expect(orch).toBeNull();
    expect(createTranslationClient).not.toHaveBeenCalled();
    expect(sendExtensionMessage).not.toHaveBeenCalled();
    expect(hud.updateProps).toHaveBeenCalledWith(expect.objectContaining({ isNoCaptions: true }));
  });
});
