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
import { EdgeTtsClient } from './edge-tts-client';
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

    try {
      const response = await sendExtensionMessage<{
        success?: boolean;
        audioBase64?: string;
        mimeType?: string;
        error?: string;
      }>(
        {
          action: 'SYNTHESIZE_TTS',
          text,
          voice: voiceProfile,
          options: { pitch: options?.pitch, rate: options?.rate },
        },
        45_000,
      );
      if (!response?.success || !response.audioBase64) {
        throw new Error(response?.error || 'TTS synthesis failed in background');
      }
      const binary = atob(response.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: response.mimeType || 'audio/mpeg' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/unavailable|Receiving end does not exist|Extension context invalidated/i.test(message)) {
        throw err;
      }
      console.warn('[AetherDub] Background TTS messaging failed; synthesizing in content script:', message);
      const client = new EdgeTtsClient({ enableFallback: true });
      return client.synthesize(text, voiceProfile);
    }
  }
}
