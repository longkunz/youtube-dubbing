import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VoiceProfile } from '@/types/domain';
import { WebSpeechFallback, ResilientTtsClient } from '@/core/tts/web-speech-fallback';
import { EdgeTtsClient, type WebSocketLike } from '@/core/tts/edge-tts-client';
import { EdgeTtsErrorCode } from '@/core/tts/errors';
import { NotificationBanner } from '@/components/NotificationBanner';
import { HudContainer } from '@/components/HudContainer';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock SpeechSynthesis
// ---------------------------------------------------------------------------

class MockSpeechSynthesisUtterance {
  text: string;
  lang = '';
  pitch = 1;
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class MockSpeechSynthesis {
  speaking = false;
  pending = false;
  paused = false;
  lastUtterance: MockSpeechSynthesisUtterance | null = null;

  speak(utterance: MockSpeechSynthesisUtterance): void {
    this.speaking = true;
    this.lastUtterance = utterance;
    setTimeout(() => {
      this.speaking = false;
      if (utterance.onend) {
        utterance.onend(new Event('end'));
      }
    }, 10);
  }

  cancel = vi.fn(() => {
    this.speaking = false;
  });
}

// ---------------------------------------------------------------------------
// Mock WebSocket that always fails
// ---------------------------------------------------------------------------

function createFailingWebSocketFactory(): (url: string) => WebSocketLike {
  return () => {
    const ws: WebSocketLike = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: vi.fn(),
      close: vi.fn(),
    };

    setTimeout(() => {
      if (ws.onerror) {
        ws.onerror(new Event('error'));
      }
      if (ws.onclose) {
        ws.onclose({ code: 1006, reason: 'Network failure', wasClean: false } as CloseEvent);
      }
    }, 5);

    return ws;
  };
}

describe('Web Speech Fallback & Resilience (Issue #8)', () => {
  let originalSpeechSynthesis: SpeechSynthesis;
  let originalUtterance: typeof SpeechSynthesisUtterance;
  let mockSynth: MockSpeechSynthesis;

  beforeEach(() => {
    mockSynth = new MockSpeechSynthesis();
    originalSpeechSynthesis = window.speechSynthesis;
    originalUtterance = window.SpeechSynthesisUtterance;

    Object.defineProperty(window, 'speechSynthesis', {
      value: mockSynth,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: MockSpeechSynthesisUtterance,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSpeechSynthesis,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: originalUtterance,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  describe('WebSpeechFallback adapter', () => {
    const testVoice: VoiceProfile = {
      id: 'vi-VN-HoaiMyNeural',
      name: 'Hoai My',
      gender: 'female',
      locale: 'vi-VN',
      provider: 'web-speech',
      voiceKey: 'vi-VN-HoaiMy',
      pitch: '+5Hz',
      rate: '+10%',
    };

    it('speaks text via SpeechSynthesisUtterance and configures voice parameters', async () => {
      const fallback = new WebSpeechFallback();
      expect(fallback.isSupported()).toBe(true);

      const speakPromise = fallback.speak('Xin chào vũ trụ', testVoice);
      expect(mockSynth.lastUtterance).not.toBeNull();
      expect(mockSynth.lastUtterance?.text).toBe('Xin chào vũ trụ');
      expect(mockSynth.lastUtterance?.lang).toBe('vi-VN');
      expect(mockSynth.lastUtterance?.rate).toBeGreaterThan(1);
      expect(mockSynth.lastUtterance?.pitch).toBeGreaterThan(1);

      await expect(speakPromise).resolves.toBeUndefined();
    });

    it('rejects when speech synthesis triggers an error event', async () => {
      mockSynth.speak = (utterance: MockSpeechSynthesisUtterance) => {
        setTimeout(() => {
          if (utterance.onerror) {
            utterance.onerror({ error: 'audio-busy' });
          }
        }, 5);
      };

      const fallback = new WebSpeechFallback();
      await expect(fallback.speak('Lỗi âm thanh')).rejects.toThrow(/audio-busy/i);
    });

    it('cancels active speech playback', () => {
      const fallback = new WebSpeechFallback();
      fallback.cancel();
      expect(mockSynth.cancel).toHaveBeenCalled();
    });
  });

  describe('Edge-TTS retry exhaustion fallback', () => {
    const testVoice: VoiceProfile = {
      id: 'vi-VN-HoaiMyNeural',
      name: 'Hoai My',
      gender: 'female',
      locale: 'vi-VN',
      provider: 'edge-tts',
      voiceKey: 'vi-VN-HoaiMyNeural',
    };

    it('invokes WebSpeechFallback.speak when Edge-TTS exhausts retries and fallback is enabled', async () => {
      const fallback = new WebSpeechFallback();
      const speakSpy = vi.spyOn(fallback, 'speak').mockResolvedValue(undefined);

      const client = new EdgeTtsClient({
        webSocketFactory: createFailingWebSocketFactory(),
        retryDelayMs: 5,
        enableFallback: true,
        fallback,
      });

      const blob = await client.synthesize('Test fallback speech', testVoice);
      expect(speakSpy).toHaveBeenCalledWith('Test fallback speech', testVoice);
      expect(blob).toBeInstanceOf(Blob);
    });

    it('throws MAX_RETRIES_EXCEEDED when Edge-TTS fails and fallback is disabled', async () => {
      const client = new EdgeTtsClient({
        webSocketFactory: createFailingWebSocketFactory(),
        retryDelayMs: 5,
        enableFallback: false,
      });

      await expect(client.synthesize('Test without fallback', testVoice)).rejects.toMatchObject({
        code: EdgeTtsErrorCode.MAX_RETRIES_EXCEEDED,
      });
    });

    it('ResilientTtsClient routes synthesis to fallback upon failure', async () => {
      const fallback = new WebSpeechFallback();
      const speakSpy = vi.spyOn(fallback, 'speak').mockResolvedValue(undefined);

      const failingEdgeClient = new EdgeTtsClient({
        webSocketFactory: createFailingWebSocketFactory(),
        retryDelayMs: 5,
        enableFallback: false,
      });

      const resilientClient = new ResilientTtsClient({
        edgeClient: failingEdgeClient,
        fallback,
        enableFallback: true,
      });

      const result = await resilientClient.synthesize('Resilient client test', testVoice);
      expect(speakSpy).toHaveBeenCalledWith('Resilient client test', testVoice);
      expect(result).toBeInstanceOf(Blob);
    });
  });

  describe('In-Player Caption Fallback Notification', () => {
    it('renders NotificationBanner with the specified missing caption message', () => {
      const onConfigure = vi.fn();
      const onDismiss = vi.fn();

      render(
        React.createElement(NotificationBanner, {
          onConfigureSettings: onConfigure,
          onDismiss: onDismiss,
        })
      );

      expect(
        screen.getByText(/No captions found for this video\. Add a Groq\/OpenAI API key in Settings to activate Whisper STT\./i)
      ).toBeInTheDocument();

      const configBtn = screen.getByRole('button', { name: /configure settings/i });
      expect(configBtn).toBeInTheDocument();
      fireEvent.click(configBtn);
      expect(onConfigure).toHaveBeenCalledTimes(1);

      const closeBtn = screen.getByRole('button', { name: /dismiss|close/i });
      expect(closeBtn).toBeInTheDocument();
      fireEvent.click(closeBtn);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('calls chrome.runtime.openOptionsPage when onConfigureSettings callback is omitted', () => {
      const mockOpenOptionsPage = vi.fn();
      Object.defineProperty(globalThis, 'chrome', {
        value: {
          runtime: {
            openOptionsPage: mockOpenOptionsPage,
          },
        },
        writable: true,
        configurable: true,
      });

      render(React.createElement(NotificationBanner, null));

      const configBtn = screen.getByRole('button', { name: /configure settings/i });
      fireEvent.click(configBtn);
      expect(mockOpenOptionsPage).toHaveBeenCalledTimes(1);
    });

    it('integrates NotificationBanner into HudContainer when hasCaptions is false', () => {
      const onConfigure = vi.fn();

      const { rerender } = render(
        React.createElement(HudContainer, {
          hasCaptions: false,
          onConfigureSettings: onConfigure,
        })
      );

      expect(
        screen.getByText(/No captions found for this video\. Add a Groq\/OpenAI API key in Settings to activate Whisper STT\./i)
      ).toBeInTheDocument();

      // Dismiss the banner
      const dismissBtn = screen.getByRole('button', { name: /dismiss|close/i });
      fireEvent.click(dismissBtn);

      expect(
        screen.queryByText(/No captions found for this video/i)
      ).not.toBeInTheDocument();

      // Rerender with hasCaptions = true -> no banner
      rerender(React.createElement(HudContainer, { hasCaptions: true }));
      expect(
        screen.queryByText(/No captions found for this video/i)
      ).not.toBeInTheDocument();
    });
  });
});
