import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import type { Transcript, Segment, OrchestratorConfig } from '../src/types/domain';
import { GeminiTranslationClient } from '../src/core/translation/gemini-client';
import type { FetchFn } from '../src/core/translation/gemini-client';
import { DubbingOrchestratorImpl, DubbingTtsClient } from '../src/core/orchestrator/dubbing-orchestrator';
import { CyberCockpit } from '../src/components/CyberCockpit';
import { HudContainer } from '../src/components/HudContainer';

// ---------------------------------------------------------------------------
// Helpers & Fixtures
// ---------------------------------------------------------------------------

const makeSegment = (overrides: Partial<Segment> & { id: string }): Segment => ({
  startTime: 0,
  endTime: 5,
  duration: 5,
  sourceText: 'Hello',
  translatedText: 'Xin chào',
  ...overrides,
});

function makeVideoElement(): HTMLVideoElement {
  const el = document.createElement('video');
  el.volume = 1.0;
  return el;
}

function makeOkResponse(body: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: body }],
          },
        },
      ],
    }),
  };
}

describe('Multi-Speaker Diarization & Dynamic Voice Switching', () => {
  // -------------------------------------------------------------------------
  // 1. GeminiTranslationClient with speakerGender enrichment
  // -------------------------------------------------------------------------
  describe('GeminiTranslationClient diarization', () => {
    let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

    beforeEach(() => {
      mockFetch = vi.fn<FetchFn>();
    });

    it('enriches segments with speakerGender from Gemini response', async () => {
      const responsePayload = {
        translations: [
          { id: 's1', translatedText: 'Xin chào anh', speakerGender: 'female' },
          { id: 's2', translatedText: 'Chào em', speakerGender: 'male' },
        ],
      };
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(responsePayload)));

      const client = new GeminiTranslationClient({ apiKey: 'test-key', fetchFn: mockFetch });
      const segments: Segment[] = [
        makeSegment({ id: 's1', sourceText: 'Hello sir' }),
        makeSegment({ id: 's2', sourceText: 'Hello maam' }),
      ];

      const result = await client.translateSegments(segments, { targetLanguage: 'vi' });

      expect(result).toHaveLength(2);
      expect(result[0].translatedText).toBe('Xin chào anh');
      expect(result[0].speakerGender).toBe('female');
      expect(result[1].translatedText).toBe('Chào em');
      expect(result[1].speakerGender).toBe('male');

      // Verify prompt instructed diarization
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1]?.body as string);
      const promptText = requestBody.contents[0].parts[0].text;
      expect(promptText).toMatch(/speakerGender/i);
    });

    it('preserves existing speakerGender if model response omits speakerGender', async () => {
      const responsePayload = {
        translations: [
          { id: 's1', translatedText: 'Xin chào' },
        ],
      };
      mockFetch.mockResolvedValueOnce(makeOkResponse(JSON.stringify(responsePayload)));

      const client = new GeminiTranslationClient({ apiKey: 'test-key', fetchFn: mockFetch });
      const segments: Segment[] = [
        makeSegment({ id: 's1', sourceText: 'Hello', speakerGender: 'female' }),
      ];

      const result = await client.translateSegments(segments);
      expect(result[0].speakerGender).toBe('female');
    });
  });

  // -------------------------------------------------------------------------
  // 2. DubbingOrchestratorImpl voice resolution & sliding-window synthesis
  // -------------------------------------------------------------------------
  describe('DubbingOrchestratorImpl voice resolution & dynamic switching', () => {
    let video: HTMLVideoElement;
    let mockTtsClient: DubbingTtsClient;

    beforeEach(() => {
      vi.useFakeTimers();
      video = makeVideoElement();
      mockTtsClient = {
        synthesize: vi.fn().mockResolvedValue(new Blob(['synthesized-audio'], { type: 'audio/mpeg' })),
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses standard/selected voice for all segments when diarization is disabled', async () => {
      const orchestrator = new DubbingOrchestratorImpl(video, {
        ttsClient: mockTtsClient,
        diarizationEnabled: false,
        defaultVoice: 'vi-VN-HoaiMyNeural',
      });

      const femaleSeg = makeSegment({ id: 's1', speakerGender: 'female' });
      const maleSeg = makeSegment({ id: 's2', speakerGender: 'male' });

      expect(orchestrator.resolveVoiceForSegment(femaleSeg)).toBe('vi-VN-HoaiMyNeural');
      expect(orchestrator.resolveVoiceForSegment(maleSeg)).toBe('vi-VN-HoaiMyNeural');
      expect(orchestrator.isDiarizationEnabled()).toBe(false);

      orchestrator.destroy();
    });

    it('resolves female and male voices dynamically when diarization is enabled', async () => {
      const orchestrator = new DubbingOrchestratorImpl(video, {
        ttsClient: mockTtsClient,
        diarizationEnabled: true,
        femaleVoice: 'vi-VN-HoaiMyNeural',
        maleVoice: 'vi-VN-NamMinhNeural',
      });

      const femaleSeg = makeSegment({ id: 's1', speakerGender: 'female' });
      const maleSeg = makeSegment({ id: 's2', speakerGender: 'male' });
      const neutralSeg = makeSegment({ id: 's3' });

      expect(orchestrator.isDiarizationEnabled()).toBe(true);
      expect(orchestrator.resolveVoiceForSegment(femaleSeg)).toBe('vi-VN-HoaiMyNeural');
      expect(orchestrator.resolveVoiceForSegment(maleSeg)).toBe('vi-VN-NamMinhNeural');
      expect(orchestrator.resolveVoiceForSegment(neutralSeg)).toBe('vi-VN-HoaiMyNeural');

      // Toggle off
      orchestrator.setDiarizationEnabled(false);
      expect(orchestrator.isDiarizationEnabled()).toBe(false);
      expect(orchestrator.resolveVoiceForSegment(maleSeg)).toBe('vi-VN-HoaiMyNeural');

      orchestrator.destroy();
    });

    it('configures diarization and custom voices via init()', async () => {
      const orchestrator = new DubbingOrchestratorImpl(video, { ttsClient: mockTtsClient });
      const transcript: Transcript = {
        videoId: 'v1',
        sourceLanguage: 'en',
        segments: [],
      };
      const config: OrchestratorConfig = {
        targetLanguage: 'vi',
        diarizationEnabled: true,
        femaleVoice: 'custom-female',
        maleVoice: 'custom-male',
      };

      await orchestrator.init('v1', transcript, config);
      expect(orchestrator.isDiarizationEnabled()).toBe(true);

      const maleSeg = makeSegment({ id: 's1', speakerGender: 'male' });
      expect(orchestrator.resolveVoiceForSegment(maleSeg)).toBe('custom-male');

      orchestrator.destroy();
    });

    it('sliding window synthesis dispatches alternating voices for multi-speaker transcript', async () => {
      const orchestrator = new DubbingOrchestratorImpl(video, {
        ttsClient: mockTtsClient,
        diarizationEnabled: true,
        femaleVoice: 'vi-VN-HoaiMyNeural',
        maleVoice: 'vi-VN-NamMinhNeural',
      });

      const transcript: Transcript = {
        videoId: 'v1',
        sourceLanguage: 'en',
        segments: [
          makeSegment({ id: 's1', startTime: 0, endTime: 3, speakerGender: 'female', translatedText: 'Xin chào', audioBlob: undefined }),
          makeSegment({ id: 's2', startTime: 4, endTime: 8, speakerGender: 'male', translatedText: 'Chào em', audioBlob: undefined }),
        ],
      };

      await orchestrator.init('v1', transcript, {
        targetLanguage: 'vi',
        lookaheadSeconds: 60,
        diarizationEnabled: true,
      });

      // Advance time update to trigger sliding window synthesis
      orchestrator.handleTimeUpdate(0);

      // Verify TTS synthesis calls
      expect(mockTtsClient.synthesize).toHaveBeenCalledWith('Xin chào', { voice: 'vi-VN-HoaiMyNeural' });
      expect(mockTtsClient.synthesize).toHaveBeenCalledWith('Chào em', { voice: 'vi-VN-NamMinhNeural' });

      // Verify voiceProfileId assigned on segments
      expect(transcript.segments[0].voiceProfileId).toBe('vi-VN-HoaiMyNeural');
      expect(transcript.segments[1].voiceProfileId).toBe('vi-VN-NamMinhNeural');

      // State reflection
      const state = orchestrator.getState();
      expect(state.diarizationEnabled).toBe(true);

      orchestrator.destroy();
    });

    it('synthesizeSegment helper assigns voiceProfileId and resolves audioBlob', async () => {
      const orchestrator = new DubbingOrchestratorImpl(video, {
        ttsClient: mockTtsClient,
        diarizationEnabled: true,
      });

      const seg = makeSegment({ id: 's1', speakerGender: 'male', translatedText: 'Thử nghiệm', audioBlob: undefined });
      const blob = await orchestrator.synthesizeSegment(seg);

      expect(blob).toBeDefined();
      expect(seg.voiceProfileId).toBe('vi-VN-NamMinhNeural');
      expect(seg.audioBlob).toBe(blob);
      expect(mockTtsClient.synthesize).toHaveBeenCalledWith('Thử nghiệm', { voice: 'vi-VN-NamMinhNeural' });

      orchestrator.destroy();
    });
  });

  // -------------------------------------------------------------------------
  // 3. CyberCockpit & HudContainer multi-speaker toggle UI
  // -------------------------------------------------------------------------
  describe('CyberCockpit & HudContainer multi-speaker toggle', () => {
    it('renders scanner toggle button in CyberCockpit and fires onToggleMultiSpeaker', () => {
      const onToggle = vi.fn();
      const { rerender } = render(
        <CyberCockpit
          isOpen={true}
          onClose={vi.fn()}
          isMultiSpeakerEnabled={false}
          onToggleMultiSpeaker={onToggle}
        />
      );

      const toggleBtn = screen.getByRole('switch', { name: /toggle multi-speaker diarization scanner/i });
      expect(toggleBtn).toBeInTheDocument();
      expect(toggleBtn).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText('SCANNER: OFF')).toBeInTheDocument();

      fireEvent.click(toggleBtn);
      expect(onToggle).toHaveBeenCalledWith(true);

      rerender(
        <CyberCockpit
          isOpen={true}
          onClose={vi.fn()}
          isMultiSpeakerEnabled={true}
          onToggleMultiSpeaker={onToggle}
        />
      );

      expect(toggleBtn).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('SCANNER: AUTO')).toBeInTheDocument();
    });

    it('wires multi-speaker toggle in HudContainer to DubbingOrchestrator', () => {
      const fakeOrchestrator = {
        getState: vi.fn().mockReturnValue({ status: 'ready', targetLanguage: 'vi', playbackRate: 1.0, activeSegmentId: null }),
        setDiarizationEnabled: vi.fn(),
        isDiarizationEnabled: vi.fn().mockReturnValue(false),
        init: vi.fn(),
        handleTimeUpdate: vi.fn(),
        handleSeek: vi.fn(),
        handleRateChange: vi.fn(),
        handlePlay: vi.fn(),
        handlePause: vi.fn(),
        setTargetLanguage: vi.fn(),
        destroy: vi.fn(),
      };

      const onToggle = vi.fn();
      render(
        <HudContainer
          isOpen={true}
          orchestrator={fakeOrchestrator as any}
          initialIsMultiSpeakerEnabled={false}
          onToggleMultiSpeaker={onToggle}
        />
      );

      const toggleBtn = screen.getByRole('switch', { name: /toggle multi-speaker diarization scanner/i });
      fireEvent.click(toggleBtn);

      expect(fakeOrchestrator.setDiarizationEnabled).toHaveBeenCalledWith(true);
      expect(onToggle).toHaveBeenCalledWith(true);
    });
  });
});
