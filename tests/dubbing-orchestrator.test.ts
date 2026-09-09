import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Transcript, Segment } from '../src/types/domain';
import type { OrchestratorConfig, OrchestratorState } from '../src/types/domain';
import { DubbingOrchestratorImpl } from '../src/core/orchestrator/dubbing-orchestrator';
import { PlaybackSyncEngine } from '../src/core/player/sync-engine';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSegment = (overrides: Partial<Segment> & { id: string }): Segment => ({
  startTime: 0,
  endTime: 5,
  duration: 5,
  sourceText: 'Hello',
  translatedText: 'Xin chào',
  audioBlob: new Blob(['fake-audio'], { type: 'audio/mpeg' }),
  ...overrides,
});

const BASE_TRANSCRIPT: Transcript = {
  videoId: 'vid-001',
  sourceLanguage: 'en',
  targetLanguage: 'vi',
  segments: [
    makeSegment({ id: 's1', startTime: 0, endTime: 4, duration: 4, sourceText: 'Hello', translatedText: 'Xin chào' }),
    makeSegment({ id: 's2', startTime: 5, endTime: 10, duration: 5, sourceText: 'World', translatedText: 'Thế giới' }),
    makeSegment({ id: 's3', startTime: 12, endTime: 17, duration: 5, sourceText: 'Done', translatedText: 'Xong' }),
  ],
};

const BASE_CONFIG: OrchestratorConfig = {
  targetLanguage: 'vi',
  lookaheadSeconds: 60,
  duckLevel: 0.2,
};

function makeVideoElement(): HTMLVideoElement {
  const el = document.createElement('video');
  el.volume = 1.0;
  return el;
}

// ---------------------------------------------------------------------------
// DubbingOrchestrator Tests
// ---------------------------------------------------------------------------

describe('DubbingOrchestratorImpl', () => {
  let video: HTMLVideoElement;
  let orchestrator: DubbingOrchestratorImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    video = makeVideoElement();
    orchestrator = new DubbingOrchestratorImpl(video);
  });

  afterEach(() => {
    orchestrator.destroy();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // init()
  // -------------------------------------------------------------------------

  describe('init()', () => {
    it('resolves without throwing', async () => {
      await expect(
        orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG),
      ).resolves.toBeUndefined();
    });

    it('getState() returns "idle" before init', () => {
      expect(orchestrator.getState().status).toBe('idle');
    });

    it('getState() returns "ready" after successful init', async () => {
      await orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG);
      expect(orchestrator.getState().status).toBe('ready');
    });
  });

  // -------------------------------------------------------------------------
  // handleTimeUpdate() → Audio Ducking
  // -------------------------------------------------------------------------

  describe('handleTimeUpdate() — audio ducking', () => {
    beforeEach(async () => {
      await orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG);
    });

    it('ducks video volume when currentTime enters a segment with audio', () => {
      orchestrator.handleTimeUpdate(1.0); // inside s1 [0–4]
      vi.runAllTimers();
      expect(video.volume).toBeLessThan(1.0);
    });

    it('restores video volume when currentTime exits into a silence gap', () => {
      orchestrator.handleTimeUpdate(1.0); // enter s1
      vi.runAllTimers();
      orchestrator.handleTimeUpdate(4.5); // gap between s1 and s2
      vi.runAllTimers();
      expect(video.volume).toBeGreaterThan(0.5);
    });

    it('does not duck when no segment has an audioBlob', async () => {
      const noAudioTranscript: Transcript = {
        ...BASE_TRANSCRIPT,
        segments: BASE_TRANSCRIPT.segments.map(s => ({ ...s, audioBlob: undefined })),
      };
      const orch = new DubbingOrchestratorImpl(video);
      await orch.init('vid-001', noAudioTranscript, BASE_CONFIG);

      orch.handleTimeUpdate(1.0);
      vi.runAllTimers();
      expect(video.volume).toBeCloseTo(1.0, 5);
      orch.destroy();
    });

    it('restores volume, stops sync engine, and clears activeSegmentId when entering an audio-less segment', async () => {
      const stopSpy = vi.spyOn(PlaybackSyncEngine.prototype, 'stop');
      const partialAudioTranscript: Transcript = {
        ...BASE_TRANSCRIPT,
        segments: [
          makeSegment({ id: 's1', startTime: 0, endTime: 4, duration: 4, sourceText: 'Hello', translatedText: 'Xin chào', audioBlob: new Blob(['fake-audio']) }),
          makeSegment({ id: 's2', startTime: 5, endTime: 10, duration: 5, sourceText: 'World', translatedText: 'Thế giới', audioBlob: undefined }),
        ],
      };
      const orch = new DubbingOrchestratorImpl(video);
      await orch.init('vid-001', partialAudioTranscript, BASE_CONFIG);

      // Play s1 (has audio)
      orch.handleTimeUpdate(1.0);
      vi.runAllTimers();
      expect(video.volume).toBeLessThan(1.0);
      expect(orch.getState().activeSegmentId).toBe('s1');

      stopSpy.mockClear();

      // Call handleTimeUpdate inside s2 (no audio)
      orch.handleTimeUpdate(6.0);
      vi.runAllTimers();

      // Verify sync engine is stopped, volume is restored (unducked), and _activeSegmentId is cleared
      expect(stopSpy).toHaveBeenCalled();
      expect(video.volume).toBeCloseTo(1.0, 1);
      expect(orch.getState().activeSegmentId).toBeNull();

      orch.destroy();
      stopSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Lookahead TTS diagnostics (silent-mute regression)
  // -------------------------------------------------------------------------

  describe('lookahead TTS diagnostics', () => {
    const noAudioTranscript: Transcript = {
      ...BASE_TRANSCRIPT,
      segments: BASE_TRANSCRIPT.segments.map((s) => ({ ...s, audioBlob: undefined })),
    };

    let warnSpy: ReturnType<typeof vi.spyOn>;
    let infoSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it('warns with the segment id when lookahead synthesis fails (instead of staying silent)', async () => {
      const failingClient = { synthesize: vi.fn().mockRejectedValue(new Error('Edge 403')) };
      const orch = new DubbingOrchestratorImpl(video, { ttsClient: failingClient });
      await orch.init('vid-001', structuredClone(noAudioTranscript), BASE_CONFIG);

      orch.handleTimeUpdate(1.0);
      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalled();
      });

      const [firstArg, firstDetail] = warnSpy.mock.calls[0];
      expect(String(firstArg)).toMatch(/Dub TTS synthesis failed/);
      expect(String(firstArg)).toMatch(/seg s\d/);
      expect(String(firstDetail)).toMatch(/Edge 403/);
      orch.destroy();
    });

    it('warns when synthesis resolves with an empty blob', async () => {
      const emptyClient = { synthesize: vi.fn().mockResolvedValue(new Blob([])) };
      const orch = new DubbingOrchestratorImpl(video, { ttsClient: emptyClient });
      await orch.init('vid-001', structuredClone(noAudioTranscript), BASE_CONFIG);

      orch.handleTimeUpdate(1.0);
      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalled();
      });
      expect(String(warnSpy.mock.calls[0][0])).toMatch(/Dub TTS synthesis failed/);
      expect(String(warnSpy.mock.calls[0][1])).toMatch(/empty audio/);
      orch.destroy();
    });

    it('logs an info once the first dub audio is ready', async () => {
      const okClient = {
        synthesize: vi.fn().mockResolvedValue(new Blob(['audio-bytes'], { type: 'audio/mpeg' })),
      };
      const orch = new DubbingOrchestratorImpl(video, { ttsClient: okClient });
      await orch.init('vid-001', structuredClone(noAudioTranscript), BASE_CONFIG);

      orch.handleTimeUpdate(1.0);
      await vi.waitFor(() => {
        expect(infoSpy).toHaveBeenCalled();
      });
      expect(String(infoSpy.mock.calls[0][0])).toMatch(/Dub TTS audio ready/);

      // Second success does not log again
      orch.handleTimeUpdate(6.0);
      await vi.waitFor(() => {
        expect(okClient.synthesize.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
      expect(infoSpy).toHaveBeenCalledTimes(1);
      orch.destroy();
    });

    it('limits concurrent TTS synthesis requests to MAX_CONCURRENT_TTS (2)', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const deferredResolvers: (() => void)[] = [];

      const controlledClient = {
        synthesize: vi.fn().mockImplementation(() => {
          inFlight++;
          if (inFlight > maxInFlight) maxInFlight = inFlight;
          return new Promise<Blob>((resolve) => {
            deferredResolvers.push(() => {
              inFlight--;
              resolve(new Blob(['audio'], { type: 'audio/mpeg' }));
            });
          });
        }),
      };

      const manySegmentsTranscript: Transcript = {
        ...BASE_TRANSCRIPT,
        segments: Array.from({ length: 6 }, (_, i) =>
          makeSegment({
            id: `seg-${i}`,
            startTime: i * 5,
            endTime: (i + 1) * 5,
            audioBlob: undefined,
          })
        ),
      };

      const orch = new DubbingOrchestratorImpl(video, { ttsClient: controlledClient });
      await orch.init('vid-001', manySegmentsTranscript, BASE_CONFIG);

      orch.handleTimeUpdate(0.0);
      expect(controlledClient.synthesize).toHaveBeenCalledTimes(2);
      expect(maxInFlight).toBe(2);

      // Resolve one in-flight request -> next segment should be dispatched
      deferredResolvers[0]();
      await vi.waitFor(() => {
        expect(controlledClient.synthesize).toHaveBeenCalledTimes(3);
      });
      expect(maxInFlight).toBe(2);

      orch.destroy();
    });
  });

  // -------------------------------------------------------------------------
  // handlePause() / handlePlay()
  // -------------------------------------------------------------------------

  describe('handlePause() and handlePlay()', () => {
    beforeEach(async () => {
      await orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG);
    });

    it('getState() reflects paused status after handlePause', () => {
      orchestrator.handlePause();
      expect(orchestrator.getState().status).toBe('paused');
    });

    it('getState() reflects ready status after handlePlay resumes from paused', () => {
      orchestrator.handlePause();
      orchestrator.handlePlay();
      expect(orchestrator.getState().status).toBe('ready');
    });
  });

  // -------------------------------------------------------------------------
  // handleSeek()
  // -------------------------------------------------------------------------

  describe('handleSeek()', () => {
    beforeEach(async () => {
      await orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG);
    });

    it('restores video volume immediately on seek (stops any active ducking)', () => {
      orchestrator.handleTimeUpdate(1.0); // duck
      vi.runAllTimers();
      orchestrator.handleSeek(15.0); // seek to silence
      expect(video.volume).toBeCloseTo(1.0, 1);
    });

    it('getState() is "ready" after seek (not paused)', () => {
      orchestrator.handleSeek(10.0);
      expect(orchestrator.getState().status).toBe('ready');
    });
  });

  // -------------------------------------------------------------------------
  // handleRateChange()
  // -------------------------------------------------------------------------

  describe('handleRateChange()', () => {
    beforeEach(async () => {
      await orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG);
    });

    it('stores the new playback rate in state', () => {
      orchestrator.handleRateChange(1.5);
      expect(orchestrator.getState().playbackRate).toBe(1.5);
    });

    it('handles 2.0x playback rate change without throwing', () => {
      expect(() => orchestrator.handleRateChange(2.0)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // setTargetLanguage()
  // -------------------------------------------------------------------------

  describe('setTargetLanguage()', () => {
    beforeEach(async () => {
      await orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG);
    });

    it('resolves without throwing', async () => {
      await expect(orchestrator.setTargetLanguage('en')).resolves.toBeUndefined();
    });

    it('updates getState().targetLanguage', async () => {
      await orchestrator.setTargetLanguage('ja');
      expect(orchestrator.getState().targetLanguage).toBe('ja');
    });
  });

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------

  describe('destroy()', () => {
    it('restores video volume to baseline on destroy', async () => {
      await orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG);
      orchestrator.handleTimeUpdate(1.0);
      vi.runAllTimers();
      orchestrator.destroy();
      expect(video.volume).toBeCloseTo(1.0, 1);
    });

    it('sets state to "destroyed" after destroy()', async () => {
      await orchestrator.init('vid-001', BASE_TRANSCRIPT, BASE_CONFIG);
      orchestrator.destroy();
      expect(orchestrator.getState().status).toBe('destroyed');
    });
  });
});
