/**
 * AudioDucker — smoothly interpolates HTMLMediaElement.volume between
 * baseline and a ducked level using requestAnimationFrame linear interpolation.
 *
 * Per ADR-0002: avoids Web Audio API due to YouTube cross-origin CORS restrictions.
 * Crossfade window: 150 ms. Default duck level: 20% of baseline volume.
 */

/** Options accepted by AudioDucker constructor. */
export interface AudioDuckerOptions {
  /** Volume fraction to duck to (0–1). Defaults to 0.2. */
  duckLevel?: number;
  /** Crossfade duration in milliseconds. Defaults to 150. */
  crossfadeDurationMs?: number;
}

export class AudioDucker {
  private readonly media: HTMLMediaElement;
  private readonly duckLevel: number;
  private readonly crossfadeDurationMs: number;

  /** Volume captured at construction time (or last unduck) — the "100%" reference. */
  private baselineVolume: number;

  private _isDucked: boolean = false;

  /** id returned by requestAnimationFrame (or setTimeout in jsdom fallback). */
  private rafId: number | null = null;

  /** Timestamp (ms) when the current lerp started — performance.now() or Date.now(). */
  private lerpStartTime: number = 0;
  /** Volume at the start of the current lerp. */
  private lerpFromVolume: number = 1.0;
  /** Target volume for the current lerp. */
  private lerpToVolume: number = 1.0;

  constructor(media: HTMLMediaElement, options: AudioDuckerOptions = {}) {
    this.media = media;
    const rawDuck =
      options.duckLevel !== undefined && Number.isFinite(options.duckLevel)
        ? options.duckLevel
        : 0.2;
    this.duckLevel = Math.min(1, Math.max(0, rawDuck));
    this.crossfadeDurationMs = options.crossfadeDurationMs ?? 150;
    this.baselineVolume = media.volume;
  }

  get isDucked(): boolean {
    return this._isDucked;
  }

  /**
   * Smoothly attenuate media volume to duckLevel over crossfadeDurationMs.
   * If a lerp is already in progress it is cancelled and a new one starts
   * from the current instantaneous volume.
   */
  duck(): void {
    if (this._isDucked) return;
    this._isDucked = true;
    this.startLerp(this.duckLevel * this.baselineVolume);
  }

  /**
   * Smoothly restore media volume to baseline over crossfadeDurationMs.
   * If a duck lerp is in progress it is cancelled and a new one starts
   * from the current instantaneous volume.
   */
  unduck(): void {
    if (!this._isDucked) return;
    this._isDucked = false;
    this.startLerp(this.baselineVolume);
  }

  /**
   * Cancel any pending lerp and immediately restore media volume to baseline.
   */
  destroy(): void {
    this.cancelLerp();
    this.media.volume = this.baselineVolume;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private startLerp(target: number): void {
    this.cancelLerp();
    this.lerpFromVolume = this.media.volume;
    this.lerpToVolume = target;
    this.lerpStartTime = this.now();
    this.scheduleTick();
  }

  private cancelLerp(): void {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.rafId);
      } else {
        clearTimeout(this.rafId);
      }
      this.rafId = null;
    }
  }

  private scheduleTick(): void {
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => this.tick());
    } else {
      // jsdom / Node fallback: use setTimeout(0) so timers can be controlled
      this.rafId = setTimeout(() => this.tick(), 0) as unknown as number;
    }
  }

  private tick(): void {
    this.rafId = null;
    const elapsed = this.now() - this.lerpStartTime;
    const t = Math.min(1.0, elapsed / this.crossfadeDurationMs);
    this.media.volume = this.lerp(this.lerpFromVolume, this.lerpToVolume, t);

    if (t < 1.0) {
      this.scheduleTick();
    }
  }

  private lerp(from: number, to: number, t: number): number {
    return from + (to - from) * t;
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}
