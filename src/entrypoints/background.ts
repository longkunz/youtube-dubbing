import { defineBackground } from 'wxt/utils/define-background';
import { EdgeTtsClient } from '@/core/tts/edge-tts-client';
import { createTranslationClient } from '@/core/translation/factory';
import { getSettings } from '@/storage/settings';
import type { VoiceProfile, Segment } from '@/types/domain';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

const edgeTtsClient = new EdgeTtsClient({ enableFallback: false });

export default defineBackground(() => {
  // When user clicks the extension action icon in the browser toolbar, open Command Center options page
  chrome.action?.onClicked?.addListener(() => {
    chrome.runtime.openOptionsPage();
  });

  // Handle messages from content scripts (e.g. YouTube in-player Cyber Cockpit HUD)
  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    const msg = message as any;

    if (msg?.action === 'OPEN_OPTIONS_PAGE' || msg?.type === 'OPEN_OPTIONS_PAGE') {
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      return false;
    }

    if (msg?.action === 'SYNTHESIZE_TTS') {
      (async () => {
        try {
          const text = msg.text as string;
          const voice = msg.voice as VoiceProfile;
          const options = msg.options;
          const blob = await edgeTtsClient.synthesize(text, voice, options);
          const buffer = await blob.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);
          sendResponse({
            success: true,
            audioBase64: base64,
            mimeType: blob.type || 'audio/mpeg',
          });
        } catch (err: any) {
          console.error('[AetherDub Background] TTS synthesis failed:', err);
          sendResponse({ success: false, error: err?.message || String(err) });
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

    return false;
  });
});

