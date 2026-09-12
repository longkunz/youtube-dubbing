/**
 * Web Speech API Fallback & Resilient TTS Client
 *
 * Provides a client-side SpeechSynthesis fallback adapter when Edge-TTS
 * is unreachable or exhausts retry attempts.
 *
 * @module core/tts/web-speech-fallback
 */

import type { VoiceProfile } from '../../types/domain';
import { EdgeTtsClient, type SynthesizeOptions } from './edge-tts-client';

/**
 * Adapter for the Web Speech API (SpeechSynthesis)
 */
export class WebSpeechFallback {
  /**
   * Check if SpeechSynthesis is supported in the current environment.
   */
  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    );
  }

  /**
   * Speak text using the Web Speech API configured with voice parameters.
   */
  speak(text: string, voice?: VoiceProfile): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.isSupported()) {
        reject(new Error('Web Speech API is not supported in this browser'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);

      if (voice) {
        if (voice.locale) {
          utterance.lang = voice.locale;
        }
        if (voice.pitch) {
          utterance.pitch = this.parsePitch(voice.pitch);
        }
        if (voice.rate) {
          utterance.rate = this.parseRate(voice.rate);
        }
      }

      utterance.onend = () => {
        resolve();
      };

      utterance.onerror = (event: { error?: string }) => {
        const errorMsg = event?.error ? String(event.error) : 'Unknown speech synthesis error';
        reject(new Error(`Speech synthesis error: ${errorMsg}`));
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Cancel any active speech synthesis playback.
   */
  cancel(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  private parsePitch(pitchStr: string): number {
    const num = parseFloat(pitchStr.replace(/[^0-9.-]/g, ''));
    if (isNaN(num)) return 1;
    if (pitchStr.includes('Hz')) {
      return Math.max(0, Math.min(2, 1 + num / 50));
    }
    if (pitchStr.includes('%')) {
      return Math.max(0, Math.min(2, 1 + num / 100));
    }
    return Math.max(0, Math.min(2, num));
  }

  private parseRate(rateStr: string): number {
    const num = parseFloat(rateStr.replace(/[^0-9.-]/g, ''));
    if (isNaN(num)) return 1;
    if (rateStr.includes('%')) {
      return Math.max(0.1, Math.min(10, 1 + num / 100));
    }
    return Math.max(0.1, Math.min(10, num));
  }
}

export interface ResilientTtsClientOptions {
  edgeClient?: EdgeTtsClient;
  fallback?: WebSpeechFallback;
  enableFallback?: boolean;
}

/**
 * Composite TTS client that attempts Edge-TTS synthesis and
 * transparently falls back to Web Speech API when Edge-TTS fails.
 */
export class ResilientTtsClient {
  private readonly edgeClient: EdgeTtsClient;
  private readonly fallback: WebSpeechFallback;
  private readonly enableFallback: boolean;

  constructor(options: ResilientTtsClientOptions = {}) {
    this.edgeClient = options.edgeClient ?? new EdgeTtsClient();
    this.fallback = options.fallback ?? new WebSpeechFallback();
    this.enableFallback = options.enableFallback ?? true;
  }

  async synthesize(
    text: string,
    voice: VoiceProfile,
    options?: SynthesizeOptions
  ): Promise<Blob> {
    try {
      return await this.edgeClient.synthesize(text, voice, options);
    } catch (err) {
      if (this.enableFallback && this.fallback.isSupported()) {
        await this.fallback.speak(text, voice);
        return new Blob(['web-speech-audio'], { type: 'audio/mpeg' });
      }
      throw err;
    }
  }
}