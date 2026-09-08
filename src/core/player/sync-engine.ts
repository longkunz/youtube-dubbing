/**
 * PlaybackSyncEngine — coordinates synthesized Dub Track audio playback
 * with the host video player.
 *
 * Responsibilities (per CONTEXT.md "Playback Sync Engine"):
 *  - playSegment: create an HTMLAudioElement, set playback rate, play.
 *  - pause / resume / stop: mirror host video state.
 *  - setPlaybackRate: update rate on active audio element.
 *  - Emit 'speechstart' and 'speechend' CustomEvents on the audio element.
 */

import type { Segment } from '../../types/domain';

export type SyncEngineEvent = 'speechstart' | 'speechend';

export class PlaybackSyncEngine {
  private activeAudio: HTMLAudioElement | null = null;
  private activeSegmentId: string | null = null;
  private activeObjectUrl: string | null = null;
  private readonly eventTarget: EventTarget;
  private onSpeechEnd: (() => void) | null = null;

  constructor() {
    // Use a detached EventTarget for emitting domain events.
    this.eventTarget = new EventTarget();
  }

  /** Subscribe to speech start / end events. */
  on(event: SyncEngineEvent, listener: EventListenerOrEventListenerObject): void {
    this.eventTarget.addEventListener(event, listener);
  }

  /** Unsubscribe from speech events. */
  off(event: SyncEngineEvent, listener: EventListenerOrEventListenerObject): void {
    this.eventTarget.removeEventListener(event, listener);
  }

  /**
   * Play the audio blob for the given segment at the specified playback rate.
   * Stops any currently playing segment first.
   */
  playSegment(segment: Segment, audioBlob: Blob, playbackRate: number): void {
    this.stop();

    const url = URL.createObjectURL(audioBlob);
    this.activeObjectUrl = url;
    const audio = new Audio(url);
    audio.playbackRate = playbackRate;

    this.activeAudio = audio;
    this.activeSegmentId = segment.id;

    const handleEnd = (): void => {
      if (this.activeAudio !== audio) {
        if (this.activeObjectUrl === url) {
          URL.revokeObjectURL(url);
          this.activeObjectUrl = null;
        }
        return;
      }
      if (this.activeObjectUrl === url) {
        URL.revokeObjectURL(url);
        this.activeObjectUrl = null;
      }
      this.activeAudio = null;
      this.activeSegmentId = null;
      this.onSpeechEnd = null;
      this.emit('speechend');
    };

    this.onSpeechEnd = handleEnd;
    audio.addEventListener('ended', handleEnd, { once: true });

    this.emit('speechstart');
    const playResult = audio.play();
    if (playResult !== undefined) {
      playResult.catch(() => {
        // Autoplay may be blocked in some environments — treat as ended.
        handleEnd();
      });
    }
  }

  /** Pause the currently playing Dub Track audio. */
  pause(): void {
    this.activeAudio?.pause();
  }

  /** Resume a paused Dub Track audio. */
  resume(): void {
    if (this.activeAudio?.paused) {
      const resumeResult = this.activeAudio.play();
      if (resumeResult !== undefined) {
        resumeResult.catch(() => undefined);
      }
    }
  }

  /** Stop and discard the currently playing audio, revoking its object URL. */
  stop(): void {
    if (this.activeAudio) {
      this.activeAudio.pause();
      // Remove end listener to prevent stale callbacks.
      if (this.onSpeechEnd) {
        this.activeAudio.removeEventListener('ended', this.onSpeechEnd);
        this.onSpeechEnd = null;
      }
      this.activeAudio = null;
      this.activeSegmentId = null;
    }
    // Revoke the object URL to prevent memory leaks.
    if (this.activeObjectUrl) {
      URL.revokeObjectURL(this.activeObjectUrl);
      this.activeObjectUrl = null;
    }
  }

  /** Update the playback rate on the currently active audio element. */
  setPlaybackRate(rate: number): void {
    if (this.activeAudio) {
      this.activeAudio.playbackRate = rate;
    }
  }

  /** Destroy the sync engine, releasing all resources. */
  destroy(): void {
    this.stop();
  }

  /** The segment id currently being played, or null. */
  get currentSegmentId(): string | null {
    return this.activeSegmentId;
  }

  /** True if audio is currently playing. */
  get isPlaying(): boolean {
    return this.activeAudio !== null && !this.activeAudio.paused;
  }

  private emit(event: SyncEngineEvent): void {
    this.eventTarget.dispatchEvent(new CustomEvent(event));
  }
}
