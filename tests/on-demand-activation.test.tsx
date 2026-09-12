import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { tryMount, resetActiveInstanceForTesting } from '@/entrypoints/content/index';
import {
  activateDubbing,
  deactivateDubbing,
  startDubbingPipeline,
  stopDubbingPipeline,
  type ActivationHudCallbacks,
} from '@/entrypoints/content/orchestrator-coordinator';
import { SegmentCache } from '@/storage/segment-cache';
import type { HudInstance } from '@/entrypoints/content/mount';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/storage/segment-cache');

// Partial mock — only mock startDubbingPipeline/stopDubbingPipeline
// so that activateDubbing (the real impl) is still tested from the same module.
// activateDubbing uses _pipelineFn injection so we pass the mock directly
// rather than relying on ESM module binding.
vi.mock('@/entrypoints/content/orchestrator-coordinator', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/entrypoints/content/orchestrator-coordinator')>();
  return {
    ...original,
    startDubbingPipeline: vi.fn().mockResolvedValue(null),
    stopDubbingPipeline: vi.fn(),
  };
});

function makeVideo(paused = false): HTMLVideoElement {
  let _paused = paused;
  const v = document.createElement('video');
  Object.defineProperty(v, 'paused', { get: () => _paused, configurable: true });
  v.pause = vi.fn().mockImplementation(() => { _paused = true; });
  v.play = vi.fn().mockImplementation(() => { _paused = false; return Promise.resolve(); });
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

// ── Slice 1: Passive Mount ─────────────────────────────────────────────────────

describe('On-Demand Activation — Passive Mount Lifecycle', () => {
  let playerContainer: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    playerContainer = document.createElement('div');
    playerContainer.className = 'ytp-right-controls';
    document.body.appendChild(playerContainer);
  });

  afterEach(async () => {
    await act(async () => { resetActiveInstanceForTesting(); });
    document.body.innerHTML = '';
  });

  it('mounts the HUD in dormant/off state without invoking startDubbingPipeline', async () => {
    let instance: ReturnType<typeof tryMount> = null;
    await act(async () => { instance = tryMount(); });

    expect(instance).not.toBeNull();
    expect(instance!.isMounted()).toBe(true);
    expect(startDubbingPipeline).not.toHaveBeenCalled();
  });

  it('does not invoke startDubbingPipeline on aetherdub:player-response-ready event', async () => {
    await act(async () => { tryMount(); });

    await act(async () => {
      document.dispatchEvent(new CustomEvent('aetherdub:player-response-ready'));
    });

    expect(startDubbingPipeline).not.toHaveBeenCalled();
  });

  it('shows NEURAL DUB pill label when newly mounted', async () => {
    await act(async () => { tryMount(); });
    const shadowRoot = playerContainer.querySelector('[data-aetherdub-host]')?.shadowRoot;
    expect(shadowRoot).not.toBeNull();
    const pillLabel = shadowRoot!.querySelector('.pill-label');
    expect(pillLabel?.textContent).toMatch(/NEURAL DUB/i);
  });
});

// ── Slice 2: activateDubbing — Cache Hit ──────────────────────────────────────

describe('activateDubbing — Cache Hit Fast Path', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does NOT call video.pause() or show overlay on cache hit; does NOT call pipeline', async () => {
    vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue({
      videoId: 'vid1',
      targetLanguage: 'vi',
      segments: [{ id: '1', startTime: 0, endTime: 2, duration: 2, sourceText: 'Hi', translatedText: 'Xin chào' }],
    });

    const mockPipeline = vi.fn().mockResolvedValue(null);
    const video = makeVideo(false);
    const { callbacks, instance } = makeHud();
    const ac = new AbortController();

    const result = await activateDubbing(video, instance, callbacks, ac.signal, 'vid1', mockPipeline);

    // Cache hit — must NOT invoke pipeline
    expect(mockPipeline).not.toHaveBeenCalled();
    // Must NOT pause
    expect(video.pause).not.toHaveBeenCalled();
    // Must NOT show overlay
    expect(callbacks.setPreparationMode).not.toHaveBeenCalledWith('preparing');
    // Must mark as enabled
    expect(callbacks.setEnabled).toHaveBeenCalledWith(true);
    expect(result).toBe('cache-hit');
  });

  it('looks up SegmentCache using the requested target language', { timeout: 15_000 }, async () => {
    const getTranscript = vi.fn().mockResolvedValue({
      videoId: 'vid1',
      targetLanguage: 'ja',
      segments: [{ id: '1', startTime: 0, endTime: 2, duration: 2, sourceText: 'Hi', translatedText: 'こんにちは' }],
    });
    vi.mocked(SegmentCache).prototype.getTranscript = getTranscript;

    const mockPipeline = vi.fn().mockResolvedValue(null);
    const video = makeVideo(false);
    const { callbacks, instance } = makeHud();
    const ac = new AbortController();

    const result = await activateDubbing(
      video,
      instance,
      callbacks,
      ac.signal,
      'vid1',
      mockPipeline,
      'ja',
    );

    expect(getTranscript).toHaveBeenCalledWith('vid1', 'ja', 'gemini');
    expect(mockPipeline).not.toHaveBeenCalled();
    expect(result).toBe('cache-hit');
  });
});

// ── Slice 3: activateDubbing — Cache Miss (Pause & Buffer) ────────────────────

describe('activateDubbing — Cache Miss Pause-and-Buffer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('pauses the video and shows PreparationOverlay on cache miss', async () => {
    vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);

    const mockOrchestrator = { destroy: vi.fn(), handlePlay: vi.fn(), handleTimeUpdate: vi.fn() };
    const mockPipeline = vi.fn().mockResolvedValue(mockOrchestrator);

    const video = makeVideo(false); // playing
    const { callbacks, instance } = makeHud();
    const ac = new AbortController();

    await activateDubbing(video, instance, callbacks, ac.signal, 'vid1', mockPipeline, 'es');

    expect(mockPipeline).toHaveBeenCalledWith(instance, video, 'es');
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(callbacks.setPreparationMode).toHaveBeenCalledWith('preparing');
    expect(callbacks.setEnabled).toHaveBeenCalledWith(true);
    expect(callbacks.setError).toHaveBeenCalledWith(null);
  });

  it('resumes video with video.play() after successful pipeline', async () => {
    vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);

    const mockOrchestrator = { destroy: vi.fn(), handlePlay: vi.fn(), handleTimeUpdate: vi.fn() };
    const mockPipeline = vi.fn().mockResolvedValue(mockOrchestrator);

    const video = makeVideo(false);
    const { callbacks, instance } = makeHud();
    const ac = new AbortController();

    const result = await activateDubbing(video, instance, callbacks, ac.signal, 'vid1', mockPipeline);

    expect(video.play).toHaveBeenCalledTimes(1);
    expect(result).toBe('success');
  });

  it('resumes video and sets error when pipeline fails (no captions)', async () => {
    vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);
    const mockPipeline = vi.fn().mockResolvedValue(null); // pipeline failed

    const video = makeVideo(false);
    const { callbacks, instance } = makeHud();
    const ac = new AbortController();

    const result = await activateDubbing(video, instance, callbacks, ac.signal, 'vid1', mockPipeline);

    expect(video.play).toHaveBeenCalledTimes(1); // must resume on failure
    expect(callbacks.setEnabled).toHaveBeenCalledWith(false);
    expect(callbacks.setError).toHaveBeenCalledWith(expect.stringContaining('captions'));
    expect(result).toBe('error');
  });

  it('handles autoplay-blocked by setting overlay to autoplay-blocked mode', async () => {
    vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);

    const mockOrchestrator = { destroy: vi.fn(), handlePlay: vi.fn(), handleTimeUpdate: vi.fn() };
    const mockPipeline = vi.fn().mockResolvedValue(mockOrchestrator);

    const video = makeVideo(false);
    // video.play() rejects — Chrome autoplay policy
    video.play = vi.fn().mockRejectedValue(new DOMException('Autoplay blocked', 'NotAllowedError'));

    const { callbacks, instance } = makeHud();
    const ac = new AbortController();

    await activateDubbing(video, instance, callbacks, ac.signal, 'vid1', mockPipeline);

    // Flush the rejected .catch() microtask
    await Promise.resolve();
    await Promise.resolve();

    expect(callbacks.setPreparationMode).toHaveBeenCalledWith('autoplay-blocked');
  });

  it('does NOT pause video if it was already paused when dubbing is activated', async () => {
    vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);
    const mockOrchestrator = { destroy: vi.fn(), handlePlay: vi.fn(), handleTimeUpdate: vi.fn() };
    const mockPipeline = vi.fn().mockResolvedValue(mockOrchestrator);

    const video = makeVideo(true); // already paused
    const { callbacks, instance } = makeHud();
    const ac = new AbortController();

    await activateDubbing(video, instance, callbacks, ac.signal, 'vid1', mockPipeline);

    // Should NOT have paused (it was already paused) and NOT call play on success
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(callbacks.setEnabled).toHaveBeenCalledWith(true);
  });
});

// ── Slice 4: Cancellation via AbortController ─────────────────────────────────

describe('activateDubbing — Cancellation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('aborts mid-pipeline and resumes video when signal is aborted', async () => {
    vi.mocked(SegmentCache).prototype.getTranscript = vi.fn().mockResolvedValue(null);

    // mockPipeline hangs until we call resolve
    let resolveStartPipeline!: (v: any) => void;
    const pipelineStarted = new Promise<void>((resolve) => {
      vi.fn().mockImplementation(() => {
        resolve(); // signal that the pipeline has started
        return new Promise((res) => { resolveStartPipeline = res; });
      });
    });

    // Create the mock inline so resolveStartPipeline is captured synchronously
    const mockPipeline = vi.fn().mockImplementation(
      () => new Promise((res) => { resolveStartPipeline = res; })
    );

    const video = makeVideo(false);
    const { callbacks, instance } = makeHud();
    const ac = new AbortController();

    const activationPromise = activateDubbing(video, instance, callbacks, ac.signal, 'vid1', mockPipeline);

    // Wait for the mockPipeline to be called and resolveStartPipeline to be set
    await vi.waitFor(() => {
      expect(mockPipeline).toHaveBeenCalledTimes(1);
    });

    // Now abort and then resolve the pending pipeline
    ac.abort();
    resolveStartPipeline(null);

    const result = await activationPromise;

    expect(result).toBe('cancelled');
    expect(video.play).toHaveBeenCalledTimes(1); // must resume on cancel
    expect(callbacks.setEnabled).not.toHaveBeenCalledWith(true);
  });
});

// ── Slice 5: deactivateDubbing ────────────────────────────────────────────────

describe('deactivateDubbing — Teardown Without Pausing Video', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls abort fn, calls stopDubbingPipeline, resets HUD state', () => {
    const { callbacks } = makeHud();
    const abortFn = vi.fn();
    const mockStop = vi.fn();

    deactivateDubbing(callbacks, abortFn, mockStop);

    expect(abortFn).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(callbacks.setEnabled).toHaveBeenCalledWith(false);
    expect(callbacks.setPreparationMode).toHaveBeenCalledWith(null);
  });

  it('works without an abort function (no-op)', () => {
    const { callbacks } = makeHud();
    const mockStop = vi.fn();

    // Should not throw
    expect(() => deactivateDubbing(callbacks, undefined, mockStop)).not.toThrow();
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(callbacks.setEnabled).toHaveBeenCalledWith(false);
  });
});
