/**
 * BackgroundDubbingTtsClient
 *
 * Implements DubbingTtsClient interface for DubbingOrchestratorImpl.
 * Proxies speech synthesis requests to the Background Service Worker via
 * chrome.runtime.sendMessage to avoid host page CSP and CORS restrictions.
 */

import type { DubbingTtsClient } from '../orchestrator/dubbing-orchestrator';
import type { VoiceProfile } from '../../types/domain';
import { sendExtensionMessage } from '../extension-runtime';
import { WebSpeechFallback } from './web-speech-fallback';
import { DEFAULT_HOAI_MY_VOICE, DEFAULT_NAM_MINH_VOICE } from './voices';

export interface PageSpeech {
  speak(text: string, voice?: VoiceProfile): Promise<void>;
}

export class BackgroundDubbingTtsClient implements DubbingTtsClient {
  private readonly webSpeech: PageSpeech;

  constructor(options?: { webSpeech?: PageSpeech }) {
    this.webSpeech = options?.webSpeech ?? new WebSpeechFallback();
  }

  async synthesize(
    text: string,
    options?: { voice?: string; rate?: string; pitch?: string }
  ): Promise<Blob> {
    const voiceKey = options?.voice ?? 'vi-VN-HoaiMyNeural';
    const isMale = voiceKey.includes('NamMinh');

    const voiceProfile: VoiceProfile = {
      ...(isMale ? DEFAULT_NAM_MINH_VOICE : DEFAULT_HOAI_MY_VOICE),
      id: voiceKey,
      voiceKey,
      pitch: options?.pitch ?? '+0Hz',
      rate: options?.rate ?? '+0%',
    };

    const response = await sendExtensionMessage<{
      success?: boolean;
      audioBase64?: string;
      mimeType?: string;
      error?: string;
      code?: string;
    }>(
      {
        action: 'SYNTHESIZE_TTS',
        text,
        voice: voiceProfile,
        options: { pitch: options?.pitch, rate: options?.rate },
      },
      45_000,
    );
    if (response?.code === 'WEB_SPEECH_REQUIRED') {
      await this.webSpeech.speak(text, voiceProfile);
      throw new Error(response.error || 'WEB_SPEECH_REQUIRED');
    }
    if (!response?.success || !response.audioBase64) {
      // No in-page Edge TTS fallback: surface unavailable so the
      // orchestrator skips the cue instead of stacking voices or
      // feeding a dummy blob into the Playback Sync Engine.
      throw new Error(response?.error || response?.code || 'TTS synthesis failed in background');
    }
    const binary = atob(response.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: response.mimeType || 'audio/mpeg' });
  }
}
