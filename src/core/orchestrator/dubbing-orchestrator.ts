/**
 * DubbingOrchestratorImpl — the primary coordination seam for the dubbing pipeline.
 *
 * Implements the DubbingOrchestrator interface from docs/SPEC.md, coordinating:
 *  - AudioDucker  (volume lerp per ADR-0002)
 *  - TimeStretcher (rate scaling per ADR-0003 / User Story 7)
 *  - SlidingWindow (lookahead synthesis queue per ADR-0003)
 *  - PlaybackSyncEngine (Dub Track playback)
 *
 * Event handling map:
 *  handleTimeUpdate → detect segment entry/exit → duck/unduck, play/stop audio
 *  handleSeek       → stop audio, restore volume, recenter sliding window
 *  handlePause      → pause Dub Track in lockstep
 *  handlePlay       → resume Dub Track in lockstep
 *  handleRateChange → update playback rate on active audio
 *  destroy          → restore volume, stop audio, clean up
 */

import type {
  DubbingOrchestrator,
  OrchestratorConfig,
  OrchestratorState,
  OrchestratorStatus,
  Segment,
  Transcript,
  VoiceProfile,
} from '../../types/domain';
import { AudioDucker } from '../player/audio-ducker';
import { TimeStretcher } from '../player/time-stretcher';
import { PlaybackSyncEngine } from '../player/sync-engine';
import { SlidingWindow } from './sliding-window';
import { cleanSpeechText, isSpeakableText } from '../tts/text-cleaner';

export interface DubbingTtsClient {
  synthesize(text: string, options?: { voice?: string; rate?: string; pitch?: string }): Promise<Blob>;
}

export interface DubbingOrchestratorDeps {
  ttsClient?: DubbingTtsClient;
  defaultVoice?: string;
  femaleVoice?: string;
  maleVoice?: string;
  diarizationEnabled?: boolean;
}

export class DubbingOrchestratorImpl implements DubbingOrchestrator {
  private static readonly MAX_CONCURRENT_TTS = 2;
  private static readonly MAX_SEGMENT_RETRIES = 2;

  private readonly media: HTMLMediaElement;
  private ducker: AudioDucker;
  private readonly stretcher: TimeStretcher;
  private readonly syncEngine: PlaybackSyncEngine;

  private slidingWindow: SlidingWindow;
  private transcript: Transcript | null = null;
  private status: OrchestratorStatus = 'idle';
  private _targetLanguage: string = 'vi';
  private _playbackRate: number = 1.0;
  private _activeSegmentId: string | null = null;
  private lastPlayedSegmentId: string | null = null;
  private _voiceProfile: VoiceProfile | string | null = null;
  private duckLevel: number = 0.2;

  private readonly ttsClient?: DubbingTtsClient;
  private defaultVoice: string;
  private femaleVoice: string;
  private maleVoice: string;
  private diarizationEnabled: boolean;

  /** Lookahead TTS diagnostics & concurrency control. */
  private inFlightTtsCount = 0;
  private segmentFailures = new Map<string, number>();
  private retryTimers: ReturnType<typeof setTimeout>[] = [];
  private ttsFailureCount = 0;
  private ttsSuccessLogged = false;

  constructor(media: HTMLMediaElement, deps?: DubbingOrchestratorDeps) {
    this.media = media;
    this.ttsClient = deps?.ttsClient;
    this.defaultVoice = deps?.defaultVoice ?? 'vi-VN-HoaiMyNeural';
    this.femaleVoice = deps?.femaleVoice ?? 'vi-VN-HoaiMyNeural';
    this.maleVoice = deps?.maleVoice ?? 'vi-VN-NamMinhNeural';
    this.diarizationEnabled = deps?.diarizationEnabled ?? false;
    this.ducker = new AudioDucker(media);
    this.stretcher = new TimeStretcher();
    this.syncEngine = new PlaybackSyncEngine();
    this.slidingWindow = new SlidingWindow();

    // When a segment finishes playing, unduck and clear active segment.
    this.syncEngine.on('speechend', () => {
      this._activeSegmentId = null;
      this.ducker.unduck();
    });
  }

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  async init(
    _videoId: string,
    transcript: Transcript,
    config: OrchestratorConfig,
  ): Promise<void> {
    this.transcript = transcript;
    this._targetLanguage = config.targetLanguage;
    this.duckLevel = config.duckLevel ?? 0.2;
    if (config.diarizationEnabled !== undefined) {
      this.diarizationEnabled = config.diarizationEnabled;
    }
    if (config.defaultVoice) {
      this.defaultVoice = config.defaultVoice;
    }
    if (config.femaleVoice) {
      this.femaleVoice = config.femaleVoice;
    }
    if (config.maleVoice) {
      this.maleVoice = config.maleVoice;
    }
    const lookahead = config.lookaheadSeconds ?? 60;
    this.slidingWindow = new SlidingWindow(lookahead);

    // Reconstruct ducker with configured duck level.
    this.ducker.destroy();
    this.ducker = new AudioDucker(this.media, {
      duckLevel: this.duckLevel,
    });

    this.status = 'ready';
  }

  handleTimeUpdate(currentTime: number): void {
    if (!this.transcript || this.status === 'idle' || this.status === 'destroyed') return;

    const activeSegment = this.findSegmentAt(currentTime);

    if (activeSegment && activeSegment.audioBlob && activeSegment.audioBlob.size > 0) {
      // Entering a segment that has audio and hasn't been played yet for this segment passage
      if (this.lastPlayedSegmentId !== activeSegment.id) {
        this._activeSegmentId = activeSegment.id;
        this.lastPlayedSegmentId = activeSegment.id;
        const rate = this.stretcher.calculateRate(
          this.estimateAudioDuration(activeSegment.audioBlob, activeSegment.duration),
          activeSegment.duration,
          this._playbackRate,
        );
        console.log(
          `[AetherDub] Playing segment ${activeSegment.id} at ${currentTime.toFixed(2)}s (rate ${rate.toFixed(2)})`
        );
        this.syncEngine.playSegment(activeSegment, activeSegment.audioBlob, rate);
        this.ducker.duck();
      }
    } else if (
      (!activeSegment || !activeSegment.audioBlob || activeSegment.audioBlob.size === 0) &&
      this._activeSegmentId !== null
    ) {
      // Exited a segment into silence, OR entered an audio-less / non-speech segment.
      // Either way: stop Dub Track, restore volume, clear active tracking.
      this._activeSegmentId = null;
      this.syncEngine.stop();
      this.ducker.unduck();
    }

    // Pump synthesis queue (throttled to MAX_CONCURRENT_TTS)
    this.pumpSynthesisQueue();
  }

  handleSeek(newTime: number): void {
    if (this.status === 'destroyed') return;
    for (const t of this.retryTimers) clearTimeout(t);
    this.retryTimers = [];
    // Immediately stop active audio and restore volume.
    this.syncEngine.stop();
    this.ducker.destroy();
    this.ducker = new AudioDucker(this.media, {
      duckLevel: this.duckLevel,
    });
    this._activeSegmentId = null;
    this.lastPlayedSegmentId = null;
    this.slidingWindow.recenter(newTime);
    this.segmentFailures.clear();
    if (this.status !== 'paused') {
      this.status = 'ready';
    }
    this.pumpSynthesisQueue();
  }

  handleRateChange(newRate: number): void {
    if (this.status === 'destroyed') return;
    this._playbackRate = newRate;
    this.syncEngine.setPlaybackRate(newRate);
  }

  handlePlay(): void {
    if (this.status === 'destroyed') return;
    this.syncEngine.resume();
    this.status = 'ready';
    this.pumpSynthesisQueue();
  }

  handlePause(): void {
    if (this.status === 'destroyed') return;
    this.syncEngine.pause();
    this.status = 'paused';
  }

  async setTargetLanguage(languageCode: string): Promise<void> {
    this._targetLanguage = languageCode;
  }

  /**
   * Merge later translation batches into the live transcript so TTS can
   * start after batch 1 while the rest of the video is still translating.
   */
  mergeTranslatedSegments(incoming: Segment[]): void {
    if (!this.transcript || this.status === 'destroyed') return;
    const byId = new Map(incoming.map((segment) => [segment.id, segment]));
    this.transcript = {
      ...this.transcript,
      segments: this.transcript.segments.map((segment) => {
        const hit = byId.get(segment.id);
        if (!hit?.translatedText) return segment;
        return {
          ...segment,
          translatedText: hit.translatedText,
          speakerGender: hit.speakerGender ?? segment.speakerGender,
        };
      }),
    };
  }

  setVoiceProfile(profile: VoiceProfile | string): void {
    this._voiceProfile = profile;
  }

  setDuckLevel(duckLevel: number): void {
    this.duckLevel = duckLevel;
    this.ducker.destroy();
    this.ducker = new AudioDucker(this.media, {
      duckLevel: this.duckLevel,
    });
  }

  getActiveSegment(): Segment | null {
    if (!this._activeSegmentId || !this.transcript) return null;
    return this.transcript.segments.find((seg) => seg.id === this._activeSegmentId) ?? null;
  }

  isDucked(): boolean {
    return this.ducker.isDucked;
  }

  setDiarizationEnabled(enabled: boolean): void {
    this.diarizationEnabled = enabled;
  }

  isDiarizationEnabled(): boolean {
    return this.diarizationEnabled;
  }

  /**
   * Surface lookahead synthesis failures instead of swallowing them silently.
   * Logged on the 1st failure and every 10th after (per-segment synthesis
   * fires often; unthrottled warnings would flood the console).
   */
  private reportTtsFailure(segmentId: string, detail: unknown, text?: string): void {
    this.ttsFailureCount += 1;
    if (this.ttsFailureCount === 1 || this.ttsFailureCount % 10 === 0) {
      const textHint = text ? ` (text: "${text.slice(0, 40)}...")` : '';
      console.warn(
        `[AetherDub] Dub TTS synthesis failed (failure #${this.ttsFailureCount}, latest seg ${segmentId}${textHint}):`,
        detail
      );
    }
  }

  private get currentVoice(): string {    if (typeof this._voiceProfile === 'string') return this._voiceProfile;
    if (this._voiceProfile?.voiceKey) return this._voiceProfile.voiceKey;
    if (this._voiceProfile?.id) return this._voiceProfile.id;
    return this.defaultVoice;
  }

  resolveVoiceForSegment(segment?: Partial<Segment> | null): string {
    if (this.diarizationEnabled && segment) {
      if (segment.speakerGender === 'female') {
        return this.femaleVoice;
      }
      if (segment.speakerGender === 'male') {
        return this.maleVoice;
      }
    }
    return this.currentVoice;
  }

  async synthesizeSegment(segment: Segment): Promise<Blob | undefined> {
    if (!segment.translatedText) return undefined;
    const rawText = segment.translatedText;
    const text = cleanSpeechText(rawText);

    if (!isSpeakableText(text)) {
      const emptyBlob = new Blob([], { type: 'audio/mpeg' });
      segment.audioBlob = emptyBlob;
      return emptyBlob;
    }

    const voice = this.resolveVoiceForSegment(segment);
    segment.voiceProfileId = voice;
    if (this.ttsClient) {
      try {
        const blob = await this.ttsClient.synthesize(text, { voice });
        segment.audioBlob = blob;
        return blob;
      } catch (err: any) {
        this.reportTtsFailure(segment.id, err?.message || String(err), text);
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Prime initial lookahead audio around currentTime before video resumes.
   * Synthesizes the active segment at currentTime (or the next 1-2 upcoming segments)
   * so audio is ready to play immediately upon playback resume without race conditions.
   */
  async primeInitialLookahead(currentTime: number): Promise<void> {
    if (!this.transcript || !this.ttsClient) return;

    // Find the current active segment, or the next upcoming segments in next 15s
    const candidateSegments = this.transcript.segments.filter(
      (seg) => seg.endTime > currentTime && seg.startTime <= currentTime + 15
    );

    const toPrime = candidateSegments.slice(0, 2);
    if (toPrime.length === 0) return;

    console.log(`[AetherDub] Priming initial lookahead TTS for ${toPrime.length} segment(s)...`);
    for (const seg of toPrime) {
      if (!seg.audioBlob) {
        this.slidingWindow.markSynthesized(seg.id);
        const blob = await this.synthesizeSegment(seg);
        if (blob) {
          console.log(
            `[AetherDub] Primed initial audio for segment ${seg.id} (${(blob.size / 1024).toFixed(1)} KB)`
          );
        } else {
          this.slidingWindow.unmarkSynthesized(seg.id);
        }
      }
    }
  }

  getState(): OrchestratorState {
    const activeSegment = this.getActiveSegment();
    return {
      status: this.status,
      targetLanguage: this._targetLanguage,
      playbackRate: this._playbackRate,
      activeSegmentId: this._activeSegmentId,
      diarizationEnabled: this.diarizationEnabled,
      activeVoiceId: activeSegment?.voiceProfileId ?? this.resolveVoiceForSegment(activeSegment ?? {}),
    };
  }

  destroy(): void {
    for (const t of this.retryTimers) clearTimeout(t);
    this.retryTimers = [];
    this.syncEngine.stop();
    this.ducker.destroy();
    this.slidingWindow.reset();
    this.segmentFailures.clear();
    this.inFlightTtsCount = 0;
    this._activeSegmentId = null;
    this.lastPlayedSegmentId = null;
    this.status = 'destroyed';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Dispatches pending segment synthesis within the sliding window,
   * bounded by MAX_CONCURRENT_TTS to avoid server throttling / connection pool exhaustion.
   */
  private pumpSynthesisQueue(): void {
    if (
      !this.transcript ||
      !this.ttsClient ||
      this.status === 'idle' ||
      this.status === 'destroyed'
    ) {
      return;
    }

    const currentTime = this.media.currentTime;

    // 1. High priority: active segment at playhead (if missing audio and not yet queued)
    const activeSegment = this.findSegmentAt(currentTime);
    if (
      activeSegment &&
      !activeSegment.audioBlob &&
      !this.slidingWindow.hasSynthesized(activeSegment.id)
    ) {
      this.requestSegmentSynthesis(activeSegment);
    }

    // 2. Upcoming segments within sliding lookahead window
    if (this.inFlightTtsCount >= DubbingOrchestratorImpl.MAX_CONCURRENT_TTS) {
      return;
    }

    const toSynthesize = this.slidingWindow.getSegmentsToSynthesize(
      currentTime,
      this.transcript.segments,
    );

    for (const seg of toSynthesize) {
      if (this.inFlightTtsCount >= DubbingOrchestratorImpl.MAX_CONCURRENT_TTS) {
        break;
      }
      this.requestSegmentSynthesis(seg);
    }
  }

  private requestSegmentSynthesis(seg: Segment): void {
    if (!this.ttsClient || seg.audioBlob || this.slidingWindow.hasSynthesized(seg.id)) {
      return;
    }

    if (!seg.translatedText) {
      return;
    }

    const rawText = seg.translatedText;
    const text = cleanSpeechText(rawText);

    if (!isSpeakableText(text)) {
      // Non-speech segment (e.g. [Music], silence, sound effects)
      seg.audioBlob = new Blob([], { type: 'audio/mpeg' });
      this.slidingWindow.markSynthesized(seg.id);
      return;
    }

    this.slidingWindow.markSynthesized(seg.id);
    this.inFlightTtsCount++;

    const voice = this.resolveVoiceForSegment(seg);
    seg.voiceProfileId = voice;

    this.ttsClient
      .synthesize(text, { voice })
      .then((blob) => {
        if (!blob || blob.size === 0) {
          this.handleSegmentTtsFailure(seg.id, 'Edge TTS returned empty audio', text);
          return;
        }

        seg.audioBlob = blob;
        this.segmentFailures.delete(seg.id);

        if (!this.ttsSuccessLogged) {
          this.ttsSuccessLogged = true;
          console.info(
            `[AetherDub] Dub TTS audio ready (seg ${seg.id}, ${(blob.size / 1024).toFixed(1)} KB) — synthesis path OK`
          );
        } else {
          console.log(
            `[AetherDub] Dub TTS audio ready (seg ${seg.id}, ${(blob.size / 1024).toFixed(1)} KB)`
          );
        }

        // If playback has reached this segment while it was synthesizing:
        const curTime = this.media.currentTime;
        if (
          this.findSegmentAt(curTime)?.id === seg.id &&
          this.lastPlayedSegmentId !== seg.id &&
          this.status !== 'paused' &&
          this.status !== 'destroyed'
        ) {
          this._activeSegmentId = seg.id;
          this.lastPlayedSegmentId = seg.id;
          const rate = this.stretcher.calculateRate(
            this.estimateAudioDuration(blob, seg.duration),
            seg.duration,
            this._playbackRate,
          );
          console.log(
            `[AetherDub] Playing segment ${seg.id} upon synthesis completion at ${curTime.toFixed(2)}s`
          );
          this.syncEngine.playSegment(seg, blob, rate);
          this.ducker.duck();
        }
      })
      .catch((err) => {
        this.handleSegmentTtsFailure(seg.id, err?.message || String(err), text);
      })
      .finally(() => {
        this.inFlightTtsCount = Math.max(0, this.inFlightTtsCount - 1);
        this.pumpSynthesisQueue();
      });
  }

  private handleSegmentTtsFailure(segmentId: string, detail: unknown, text?: string): void {
    const currentFailures = (this.segmentFailures.get(segmentId) ?? 0) + 1;
    this.segmentFailures.set(segmentId, currentFailures);
    this.reportTtsFailure(segmentId, detail, text);

    if (currentFailures <= DubbingOrchestratorImpl.MAX_SEGMENT_RETRIES) {
      const timer = setTimeout(() => {
        if (this.status !== 'destroyed') {
          this.slidingWindow.unmarkSynthesized(segmentId);
          this.pumpSynthesisQueue();
        }
      }, 1000 * currentFailures);
      this.retryTimers.push(timer);
    } else {
      console.warn(
        `[AetherDub] Segment ${segmentId} reached maximum retry limit (${DubbingOrchestratorImpl.MAX_SEGMENT_RETRIES}). Skipping.`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private findSegmentAt(currentTime: number): Segment | undefined {
    return this.transcript?.segments.find(
      seg => currentTime >= seg.startTime && currentTime < seg.endTime,
    );
  }

  /**
   * Estimate audio duration from a Blob (bytes-based heuristic).
   * When actual audioDuration metadata is unavailable at this stage,
   * we fall back to the segment duration so the stretcher returns 1.0.
   * In production, the real duration would come from AudioBuffer.duration
   * after decoding.
   */
  private estimateAudioDuration(blob: Blob, fallback: number): number {
    // Heuristic: ~128kbps mp3 → bytes / 16000 ≈ seconds
    const estimated = blob.size / 16000;
    return estimated > 0 ? estimated : fallback;
  }
}
