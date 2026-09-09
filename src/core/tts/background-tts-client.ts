/**
 * BackgroundDubbingTtsClient
 *
 * Implements DubbingTtsClient interface for DubbingOrchestratorImpl.
 * Proxies speech synthesis requests to the Background Service Worker via
 * chrome.runtime.sendMessage to avoid host page CSP and CORS restrictions.
 */

import type { DubbingTtsClient } from '../orchestrator/dubbing-orchestrator';
import type { VoiceProfile } from '../../types/domain';
import { DEFAULT_HOAI_MY_VOICE, DEFAULT_NAM_MINH_VOICE } from './voices';

export class BackgroundDubbingTtsClient implements DubbingTtsClient {
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

    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    return new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('TTS synthesis timed out after 20s'));
        }
      }, 20000);

      chrome.runtime.sendMessage(
        {
          action: 'SYNTHESIZE_TTS',
          text,
          voice: voiceProfile,
          options: { pitch: options?.pitch, rate: options?.rate },
        },
        (response: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          if (chrome.runtime?.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!response || !response.success) {
            return reject(new Error(response?.error || 'TTS synthesis failed in background'));
          }

          try {
            const binary = atob(response.audioBase64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: response.mimeType || 'audio/mpeg' });
            resolve(blob);
          } catch (e: any) {
            reject(new Error(`Failed to decode TTS audio data: ${e?.message}`));
          }
        }
      );
    });
  }
}
