import { defineBackground } from 'wxt/utils/define-background';
import { createBackendTtsRouter } from '@/core/tts/backend-tts-router';
import { createTranslationClient } from '@/core/translation/factory';
import { GroqWhisperClient } from '@/core/stt';
import { getSettings } from '@/storage/settings';
import type { VoiceProfile, Segment } from '@/types/domain';

const ttsRouter = createBackendTtsRouter({ getSettings });

export default defineBackground(() => {
  // When user clicks the extension action icon in the browser toolbar, open Command Center options page
  chrome.action?.onClicked?.addListener(() => {
    chrome.runtime.openOptionsPage();
  });

  chrome.runtime?.onConnect?.addListener((port) => {
    if ((port as { name?: string }).name === 'aetherdub-keepalive') {
      // Port held open from the content script so the MV3 worker is not
      // killed mid-translation / TTS.
    }
  });

  // Handle messages from content scripts (e.g. YouTube in-player Cyber Cockpit HUD)
  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    const msg = message as any;

    if (msg?.action === 'OPEN_OPTIONS_PAGE' || msg?.type === 'OPEN_OPTIONS_PAGE') {
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      return false;
    }

    if (msg?.action === 'RESET_TTS_BREAKER') {
      ttsRouter.resetBreaker();
      sendResponse({ success: true });
      return false;
    }

    if (msg?.action === 'SYNTHESIZE_TTS') {
      (async () => {
        try {
          const text = msg.text as string;
          const voice = msg.voice as VoiceProfile;
          const result = await ttsRouter.synthesize(text, voice);
          sendResponse(result);
        } catch (err: any) {
          console.error('[AetherDub Background] TTS synthesis failed:', err);
          sendResponse({ success: false, code: 'BACKEND_TTS_UNAVAILABLE', error: err?.message || String(err) });
        }
      })();
      return true; // Indicates asynchronous sendResponse
    }

    if (msg?.action === 'TRANSLATE_SEGMENTS') {
      (async () => {
        try {
          const segments = msg.segments as Segment[];
          const targetLanguage = msg.targetLanguage as string;
          const settings = msg.settings || (await getSettings());
          const client = createTranslationClient(settings);
          const translated = await client.translateSegments(segments, { targetLanguage });
          sendResponse({ success: true, segments: translated });
        } catch (err: any) {
          console.error('[AetherDub Background] Translation failed:', err);
          sendResponse({ success: false, error: err?.message || String(err) });
        }
      })();
      return true; // Indicates asynchronous sendResponse
    }

    if (msg?.action === 'TRANSCRIBE_AUDIO') {
      (async () => {
        try {
          const audioUrl = msg.audioUrl as string;
          const groqApiKey = (msg.groqApiKey as string) || (await getSettings()).groqApiKey;
          const audioResponse = await fetch(audioUrl, { credentials: 'include' });
          if (!audioResponse.ok) {
            throw new Error(`Audio download failed: HTTP ${audioResponse.status}`);
          }
          const audioBlob = await audioResponse.blob();
          if (audioBlob.size > 24 * 1024 * 1024) {
            throw new Error('Audio stream exceeds Groq Whisper 25MB limit');
          }
          const client = new GroqWhisperClient({ apiKey: groqApiKey });
          const segments = await client.transcribeBlob(audioBlob);
          sendResponse({ success: true, segments });
        } catch (err: any) {
          console.error('[AetherDub Background] Whisper transcription failed:', err);
          sendResponse({ success: false, error: err?.message || String(err) });
        }
      })();
      return true;
    }

    return false;
  });
});

