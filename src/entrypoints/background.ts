import { defineBackground } from 'wxt/utils/define-background';
import { createBackendTtsRouter } from '@/core/tts/backend-tts-router';
import { createTranslationClient } from '@/core/translation/factory';
import { GroqWhisperClient } from '@/core/stt';
import { getSettings } from '@/storage/settings';
import type { VoiceProfile, Segment } from '@/types/domain';

const ttsRouter = createBackendTtsRouter({ getSettings });

/**
 * Handles toolbar extension action clicks. Dispatches TOGGLE_COMMAND_CENTER
 * to the active YouTube tab, or falls back to openOptionsPage() if on an internal/non-YouTube page
 * or if the content script is unavailable.
 */
export async function handleActionClick(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    chrome?.runtime?.openOptionsPage?.();
    return;
  }

  let handled = false;
  const processTabs = (tabs: chrome.tabs.Tab[] | undefined) => {
    if (handled) return;
    handled = true;

    if (chrome.runtime?.lastError || !tabs || tabs.length === 0 || tabs[0]?.id === undefined) {
      chrome.runtime.openOptionsPage();
      return;
    }

    const activeTab = tabs[0];
    const tabId = activeTab.id!;

    try {
      chrome.tabs.sendMessage(tabId, { action: 'TOGGLE_COMMAND_CENTER' }, (response) => {
        if (chrome.runtime?.lastError || !response || (response as any).success !== true) {
          chrome.runtime.openOptionsPage();
        }
      });
    } catch {
      chrome.runtime.openOptionsPage();
    }
  };

  try {
    const res = chrome.tabs.query({ active: true, currentWindow: true }, processTabs);
    if (res && typeof (res as any).then === 'function') {
      (res as unknown as Promise<chrome.tabs.Tab[]>)
        .then(processTabs)
        .catch(() => {
          if (!handled) {
            handled = true;
            chrome.runtime.openOptionsPage();
          }
        });
    }
  } catch {
    if (!handled) {
      handled = true;
      chrome.runtime.openOptionsPage();
    }
  }
}

export default defineBackground(() => {
  // When user clicks the extension action icon in the browser toolbar, toggle in-page Command Center or fallback
  chrome.action?.onClicked?.addListener(() => {
    handleActionClick();
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

