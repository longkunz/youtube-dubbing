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
  private _voiceProfile: VoiceProfile | string | null = null;
  private duckLevel: number = 0.2;

  private readonly ttsClient?: DubbingTtsClient;
  private defaultVoice: string;
  private femaleVoice: string;
  private maleVoice: string;
  private diarizationEnabled: boolean;

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

    if (activeSegment && activeSegment.audioBlob) {
      // Entering a segment that has audio.
      if (this._activeSegmentId !== activeSegment.id) {
        this._activeSegmentId = activeSegment.id;
        const rate = this.stretcher.calculateRate(
          this.estimateAudioDuration(activeSegment.audioBlob, activeSegment.duration),
          activeSegment.duration,
          this._playbackRate,
        );
        this.syncEngine.playSegment(activeSegment, activeSegment.audioBlob, rate);
        this.ducker.duck();
      }
    } else if ((!activeSegment || !activeSegment.audioBlob) && this._activeSegmentId !== null) {
      // Exited a segment into silence, OR entered an audio-less segment.
      // Either way: stop Dub Track, restore volume, clear active tracking.
      this._activeSegmentId = null;
      this.syncEngine.stop();
      this.ducker.unduck();
    }

    // Queue upcoming segments in the sliding window.
    if (this.transcript) {
      const toSynthesize = this.slidingWindow.getSegmentsToSynthesize(
        currentTime,
        this.transcript.segments,
      );
      for (const seg of toSynthesize) {
        this.slidingWindow.markSynthesized(seg.id);
        if (this.ttsClient && !seg.audioBlob) {
          const voice = this.resolveVoiceForSegment(seg);
          seg.voiceProfileId = voice;
          const text = seg.translatedText ?? seg.sourceText;
          this.ttsClient
            .synthesize(text, { voice })
            .then((blob) => {
              seg.audioBlob = blob;
            })
            .catch(() => {
              // Ignore synthesis errors during lookahead
            });
        }
      }
    }
  }

  handleSeek(newTime: number): void {
    if (this.status === 'destroyed') return;
    // Immediately stop active audio and restore volume.
    this.syncEngine.stop();
    this.ducker.destroy();
    this.ducker = new AudioDucker(this.media, {
      duckLevel: this.duckLevel,
    });
    this._activeSegmentId = null;
    this.slidingWindow.recenter(newTime);
    if (this.status !== 'paused') {
      this.status = 'ready';
    }
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
  }

  handlePause(): void {
    if (this.status === 'destroyed') return;
    this.syncEngine.pause();
    this.status = 'paused';
  }

  async setTargetLanguage(languageCode: string): Promise<void> {
    this._targetLanguage = languageCode;
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

  private get currentVoice(): string {
    if (typeof this._voiceProfile === 'string') return this._voiceProfile;
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
    const voice = this.resolveVoiceForSegment(segment);
    segment.voiceProfileId = voice;
    if (this.ttsClient) {
      const text = segment.translatedText ?? segment.sourceText;
      const blob = await this.ttsClient.synthesize(text, { voice });
      segment.audioBlob = blob;
      return blob;
    }
    return undefined;
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
    this.syncEngine.stop();
    this.ducker.destroy();
    this.slidingWindow.reset();
    this._activeSegmentId = null;
    this.status = 'destroyed';
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
