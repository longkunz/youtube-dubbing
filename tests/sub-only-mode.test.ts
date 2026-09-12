import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  activateSubOnly,
  findActiveSegment,
  stopSubOnlyPipeline,
  type ActivationHudCallbacks,
} from '@/entrypoints/content/orchestrator-coordinator';
import { SegmentCache } from '@/storage/segment-cache';
import { TranscriptFetcher } from '@/core/transcript/fetcher';
import { GroqWhisperClient } from '@/core/stt';
import { BackgroundDubbingTtsClient } from '@/core/tts/background-tts-client';
import { mountHud, type HudInstance } from '@/entrypoints/content/mount';
import { tryMount, resetActiveInstanceForTesting } from '@/entrypoints/content/index';
import type { SubtitleOverlayInstance } from '@/entrypoints/content/subtitle-mount';
import type { Segment, Transcript } from '@/types/domain';
import { act } from 'react';
import { fireEvent } from '@testing-library/react';

vi.mock('@/storage/segment-cache');
vi.mock('@/core/transcript/fetcher');
vi.mock('@/core/stt');
vi.mock('@/core/tts/background-tts-client');

function makeVideo(paused = false): HTMLVideoElement {
  let _paused = paused;
  const v = document.createElement('video');
  Object.defineProperty(v, 'paused', { get: () => _paused, configurable: true });
  v.pause = vi.fn().mockImplementation(() => {
    _paused = true;
  });
  v.play = vi.fn().mockImplementation(() => {
    _paused = false;
    return Promise.resolve();
  });
  return v;
}

function makeHud(): { callbacks: ActivationHudCallbacks; instance: HudInstance } {
  const callbacks: ActivationHudCallbacks = {
    setPreparationMode: vi.fn(),
    setEnabled: vi.fn(),
    setError: vi.fn(),
  };
  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const instance: HudInstance = {
    unmount: vi.fn(),
    isMounted: vi.fn().mockReturnValue(true),
    shadowRoot,
    updateOrchestrator: vi.fn(),
    updateProps: vi.fn(),
  };
  return { callbacks, instance };
}

function makeSubtitleInstance(): SubtitleOverlayInstance {
  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  return {
    unmount: vi.fn(),
    isMounted: vi.fn().mockReturnValue(true),
    shadowRoot,
    hostEl: host,
    updateProps: vi.fn(),
    setSegment: vi.fn(),
    setVisible: vi.fn(),
  };
}

describe('Sub-Only Mode Pipeline (Issue #18 / ADR-0012)', () => {
  const sampleSegments: Segment[] = [
    {
      id: 'seg-1',
      startTime: 0,
      endTime: 5,
      duration: 5,
      sourceText: 'Welcome to this presentation.',
      translatedText: 'Chào mừng đến với bài thuyết trình này.',
    },
    {
      id: 'seg-2',
      startTime: 5,
      endTime: 10,
      duration: 5,
      sourceText: 'We will discuss autonomous AI agents.',
      translatedText: 'Chúng ta sẽ thảo luận về các tác tử AI tự trị.',
    },
    {
      id: 'seg-3',
      startTime: 15,
      endTime: 20,
      duration: 5,
      sourceText: 'Thank you for watching.',
      translatedText: 'Cảm ơn bạn đã theo dõi.',
    },
  ];

  const sampleTranscript: Transcript = {
    videoId: 'test-vid-123',
    sourceLanguage: 'en',
    targetLanguage: 'vi',
    segments: sampleSegments,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopSubOnlyPipeline();
  });

  describe('findActiveSegment fast search', () => {
    it('finds active segment during segment bounds', () => {
      expect(findActiveSegment(sampleSegments, 2.5)?.id).toBe('seg-1');
      expect(findActiveSegment(sampleSegments, 5.0)?.id).toBe('seg-1'); // boundary
      expect(findActiveSegment(sampleSegments, 7.2)?.id).toBe('seg-2');
      expect(findActiveSegment(sampleSegments, 18.0)?.id).toBe('seg-3');
    });

    it('returns null during gaps or out-of-bounds time', () => {
      expect(findActiveSegment(sampleSegments, 12.0)).toBeNull(); // gap between 10 and 15
      expect(findActiveSegment(sampleSegments, 25.0)).toBeNull(); // past end
      expect(findActiveSegment([], 2.0)).toBeNull();
    });
  });

  describe('TTS Bypass', () => {
    it('fetches captions & translates but completely skips TTS synthesis and priming', async () => {
      vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(sampleTranscript);

      const video = makeVideo(false);
      const { callbacks, instance } = makeHud();
      const subInstance = makeSubtitleInstance();
      const ac = new AbortController();

      const result = await activateSubOnly(
        video,
        instance,
        callbacks,
        ac.signal,
        'test-vid-123',
        'vi',
        { subtitleInstance: subInstance }
      );

      expect(result).toBe('cache-hit');
      // Subtitle overlay should be enabled and visible
      expect(subInstance.setVisible).toHaveBeenCalledWith(true);

      // TTS Client constructor or methods MUST NOT be called
      expect(BackgroundDubbingTtsClient).not.toHaveBeenCalled();
    });
  });

  describe('Fast Activation Without Video Pause', () => {
    it('activates near-instantaneously without calling video.pause(), even on cache miss', async () => {
      // Simulate cache miss
      vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);

      // Raw captions returned from fetcher
      const rawTranscript: Transcript = {
        videoId: 'test-vid-123',
        sourceLanguage: 'en',
        segments: sampleSegments.map((s) => ({ ...s, translatedText: undefined })),
      };

      vi.mocked(TranscriptFetcher).prototype.fetchTranscript = vi.fn().mockResolvedValue(rawTranscript);

      const video = makeVideo(false); // currently playing
      const { callbacks, instance } = makeHud();
      const subInstance = makeSubtitleInstance();
      const ac = new AbortController();

      const mockPipeline = vi.fn().mockResolvedValue(sampleTranscript);

      const result = await activateSubOnly(
        video,
        instance,
        callbacks,
        ac.signal,
        'test-vid-123',
        'vi',
        {
          subtitleInstance: subInstance,
          _pipelineFn: mockPipeline,
        }
      );

      // CRITICAL: Sub-Only mode MUST NOT pause video for speech synthesis buffering
      expect(video.pause).not.toHaveBeenCalled();
      expect(callbacks.setPreparationMode).not.toHaveBeenCalledWith('preparing');
      expect(subInstance.setVisible).toHaveBeenCalledWith(true);
      expect(result).toBe('success');
    });
  });

  describe('Captionless Video Handling Without Whisper Fallback', () => {
    it('stops without invoking Groq Whisper when native captions are unavailable', async () => {
      // Cache miss
      vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);

      // Fetcher fails (no captions)
      vi.mocked(TranscriptFetcher).prototype.fetchTranscript = vi
        .fn()
        .mockRejectedValue(new Error('No captions available'));

      const video = makeVideo(false);
      const { callbacks, instance } = makeHud();
      const subInstance = makeSubtitleInstance();
      const ac = new AbortController();

      const result = await activateSubOnly(
        video,
        instance,
        callbacks,
        ac.signal,
        'test-no-caps',
        'vi',
        { subtitleInstance: subInstance }
      );

      // Whisper fallback MUST NOT be invoked in Sub-Only Mode
      expect(GroqWhisperClient).not.toHaveBeenCalled();

      // UI state marks captions as unavailable
      expect(instance.updateProps).toHaveBeenCalledWith(
        expect.objectContaining({ hasCaptions: false, isNoCaptions: true })
      );
      expect(callbacks.setError).toHaveBeenCalledWith(expect.stringContaining('captions'));
      expect(subInstance.setVisible).toHaveBeenCalledWith(false);
      expect(result).toBe('error');
    });
  });

  describe('Scrub and Timeupdate Synchronization', () => {
    it('synchronizes active segment with video.currentTime on timeupdate and seeking', async () => {
      vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(sampleTranscript);

      const video = makeVideo(false);
      const { callbacks, instance } = makeHud();
      const subInstance = makeSubtitleInstance();
      const ac = new AbortController();

      await activateSubOnly(
        video,
        instance,
        callbacks,
        ac.signal,
        'test-vid-123',
        'vi',
        { subtitleInstance: subInstance }
      );

      // Simulate video playing at currentTime = 2.0s
      Object.defineProperty(video, 'currentTime', { value: 2.0, configurable: true });
      video.dispatchEvent(new Event('timeupdate'));

      expect(subInstance.setSegment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'seg-1' })
      );

      // Simulate seek to 7.0s
      Object.defineProperty(video, 'currentTime', { value: 7.0, configurable: true });
      video.dispatchEvent(new Event('seeking'));

      expect(subInstance.setSegment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'seg-2' })
      );

      // Simulate seek to gap at 12.0s
      Object.defineProperty(video, 'currentTime', { value: 12.0, configurable: true });
      video.dispatchEvent(new Event('timeupdate'));

      expect(subInstance.setSegment).toHaveBeenCalledWith(null);
    });
  });

  describe('Binary search boundary precision', () => {
    it('accurately resolves contiguous boundaries returning first matching segment', () => {
      // startTime boundary
      expect(findActiveSegment(sampleSegments, 0.0)?.id).toBe('seg-1');
      // shared boundary between seg-1 [0, 5] and seg-2 [5, 10]
      expect(findActiveSegment(sampleSegments, 5.0)?.id).toBe('seg-1');
      // immediately after shared boundary
      expect(findActiveSegment(sampleSegments, 5.001)?.id).toBe('seg-2');
      // end boundary of seg-2
      expect(findActiveSegment(sampleSegments, 10.0)?.id).toBe('seg-2');
      // gap between 10.001 and 14.999
      expect(findActiveSegment(sampleSegments, 10.001)).toBeNull();
      expect(findActiveSegment(sampleSegments, 14.999)).toBeNull();
      // start of seg-3
      expect(findActiveSegment(sampleSegments, 15.0)?.id).toBe('seg-3');
      // end of seg-3
      expect(findActiveSegment(sampleSegments, 20.0)?.id).toBe('seg-3');
      // past end of seg-3
      expect(findActiveSegment(sampleSegments, 20.001)).toBeNull();
      // before start of seg-1
      expect(findActiveSegment(sampleSegments, -1.0)).toBeNull();
    });

    it('handles large 100-segment arrays in O(log N) binary search correctly', () => {
      const largeSegments: Segment[] = Array.from({ length: 100 }, (_, i) => ({
        id: `seg-${i}`,
        startTime: i * 10,
        endTime: i * 10 + 8, // 8s speech, 2s gap
        duration: 8,
        sourceText: `Segment ${i}`,
        translatedText: `Đoạn ${i}`,
      }));

      // Test random accesses
      expect(findActiveSegment(largeSegments, 0)?.id).toBe('seg-0');
      expect(findActiveSegment(largeSegments, 455)?.id).toBe('seg-45'); // 450-458
      expect(findActiveSegment(largeSegments, 458)?.id).toBe('seg-45'); // boundary
      expect(findActiveSegment(largeSegments, 459)).toBeNull(); // in 2s gap (458-460)
      expect(findActiveSegment(largeSegments, 990)?.id).toBe('seg-99'); // last segment start
      expect(findActiveSegment(largeSegments, 998)?.id).toBe('seg-99'); // last segment end
      expect(findActiveSegment(largeSegments, 1000)).toBeNull(); // out of bounds
    });
  });

  describe('AbortSignal Cleanup & Cancellation', () => {
    it('returns cancelled and cancels in-flight pipeline when caller AbortSignal triggers', async () => {
      vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);

      const video = makeVideo(false);
      const { callbacks, instance } = makeHud();
      const subInstance = makeSubtitleInstance();
      const ac = new AbortController();

      // Slow pipeline that checks signal
      const delayedPipeline = vi.fn().mockImplementation(
        (_inst, _v, _lang, signal?: AbortSignal) =>
          new Promise<Transcript | null>((resolve) => {
            const timer = setTimeout(() => {
              resolve(sampleTranscript);
            }, 100);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve(null);
            });
          })
      );

      const activationPromise = activateSubOnly(
        video,
        instance,
        callbacks,
        ac.signal,
        'test-abort-vid',
        'vi',
        {
          subtitleInstance: subInstance,
          _pipelineFn: delayedPipeline,
        }
      );

      // Abort in flight
      ac.abort();

      const result = await activationPromise;
      expect(result).toBe('cancelled');
    });

    it('stopSubOnlyPipeline cleanly stops listeners and clears active video state', async () => {
      vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(sampleTranscript);

      const video = makeVideo(false);
      const { callbacks, instance } = makeHud();
      const subInstance = makeSubtitleInstance();

      await activateSubOnly(
        video,
        instance,
        callbacks,
        undefined,
        'test-cleanup-vid',
        'vi',
        { subtitleInstance: subInstance }
      );

      expect(subInstance.setVisible).toHaveBeenCalledWith(true);

      // Stop pipeline
      stopSubOnlyPipeline();

      expect(subInstance.setVisible).toHaveBeenCalledWith(false);
      expect(subInstance.setSegment).toHaveBeenCalledWith(null);

      // Subsequent timeupdate should not trigger setSegment
      (subInstance.setSegment as any).mockClear();
      video.dispatchEvent(new Event('timeupdate'));
      expect(subInstance.setSegment).not.toHaveBeenCalled();
    });
  });

  describe('Sub-Only Mode Entry/Exit in UI & Lifecycle', () => {
    let container: HTMLElement;
    let videoEl: HTMLVideoElement;

    beforeEach(() => {
      document.body.innerHTML = '';
      container = document.createElement('div');
      container.className = 'ytp-right-controls';
      document.body.appendChild(container);

      videoEl = document.createElement('video');
      videoEl.className = 'html5-main-video';
      document.body.appendChild(videoEl);
    });

    afterEach(() => {
      resetActiveInstanceForTesting();
      document.body.innerHTML = '';
    });

    it('toggles Sub-Only mode ON and OFF via dual-subtitles-toggle when dubbing is inactive', async () => {
      vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(sampleTranscript);

      let hud!: HudInstance;
      await act(async () => {
        hud = mountHud(container);
      });

      const shadowRoot = hud.shadowRoot;

      // Open cockpit
      const trigger = shadowRoot.querySelector('.hyper-pill-trigger') as HTMLElement;
      await act(async () => {
        fireEvent.click(trigger);
      });

      const subToggle = shadowRoot.querySelector('[data-testid="dual-subtitles-toggle"]') as HTMLElement;
      expect(subToggle).not.toBeNull();

      // Turn SUBS ON
      await act(async () => {
        fireEvent.click(subToggle);
      });

      // Verify sub-only listeners sync on video timeupdate
      Object.defineProperty(videoEl, 'currentTime', { value: 2.0, configurable: true });
      videoEl.dispatchEvent(new Event('timeupdate'));

      // Turn SUBS OFF
      await act(async () => {
        fireEvent.click(subToggle);
      });

      hud.unmount();
    });

    it('cleans up sub-only pipeline on tryMount when video controls unmount or videoId changes', async () => {
      vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(sampleTranscript);

      // Mount HUD via tryMount
      let inst: ReturnType<typeof tryMount> = null;
      await act(async () => {
        inst = tryMount();
      });
      expect(inst).not.toBeNull();

      // Activate sub-only
      await activateSubOnly(videoEl, inst, null, undefined, 'vid-1', 'vi');

      // 1. VideoId change cleans up sub-only pipeline
      window.history.pushState({}, '', '/watch?v=vid-2');
      await act(async () => {
        tryMount();
      });

      // 2. Controls removed (unmounted) cleans up sub-only pipeline
      container.remove();
      await act(async () => {
        tryMount();
      });
    });
  });
});
