import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import React from 'react';
import { SubtitleOverlay } from '@/components/SubtitleOverlay';
import {
  mountSubtitleOverlay,
  resetSubtitleMountForTesting,
  getActiveSubtitleInstance,
  findSegmentBefore,
  findSegmentAtOrNearest,
  findSegmentAfter,
  shouldAutoPause,
} from '@/entrypoints/content/subtitle-mount';
import {
  getSettings,
  saveSettings,
  resetSettingsForTesting,
  DEFAULT_USER_SETTINGS,
  normalizeSettings,
  type UserSettings,
} from '@/storage/settings';
import { OptionsDashboard } from '@/entrypoints/options/OptionsDashboard';
import { SegmentCache } from '@/storage/segment-cache';
import type { Segment } from '@/types/domain';

describe('eJOY-Style Subtitle Configuration & Learning Tools (Issue #21 / ADR-0016)', () => {
  const sampleSegment: Segment = {
    id: 'seg-1',
    startTime: 10,
    endTime: 14,
    duration: 4,
    sourceText: 'The quick brown fox jumps over the lazy dog.',
    translatedText: 'Con cáo nâu nhanh nhẹn nhảy qua con chó lười biếng.',
  };

  const sampleSegments: Segment[] = [
    {
      id: 'seg-1',
      startTime: 10,
      endTime: 14,
      duration: 4,
      sourceText: 'First segment.',
      translatedText: 'Đoạn đầu tiên.',
    },
    {
      id: 'seg-2',
      startTime: 15,
      endTime: 18,
      duration: 3,
      sourceText: 'Second segment.',
      translatedText: 'Đoạn thứ hai.',
    },
    {
      id: 'seg-3',
      startTime: 20,
      endTime: 25,
      duration: 5,
      sourceText: 'Third segment.',
      translatedText: 'Đoạn thứ ba.',
    },
  ];

  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    await resetSettingsForTesting();
  });

  afterEach(() => {
    resetSubtitleMountForTesting();
    document.body.innerHTML = '';
  });

  describe('1. Settings Schema, Defaults, & Normalization', () => {
    it('has correct default values for all eJOY subtitle & learning fields in DEFAULT_USER_SETTINGS', async () => {
      const settings = await getSettings();
      expect(settings.subtitleOriginalFontSize).toBe(18);
      expect(settings.subtitleTranslatedFontSize).toBe(15);
      expect(settings.subtitleOriginalColor).toBe('#ffffff');
      expect(settings.subtitleTranslatedColor).toBe('#00f2fe');
      expect(settings.subtitleBackgroundOpacity).toBe(78);
      expect(settings.subtitleTextShadow).toBe(true);
      expect(settings.subtitleAutoPause).toBe(false);
      expect(settings.subtitleHotkeysEnabled).toBe(false);

      expect(DEFAULT_USER_SETTINGS.subtitleOriginalFontSize).toBe(18);
      expect(DEFAULT_USER_SETTINGS.subtitleTranslatedFontSize).toBe(15);
      expect(DEFAULT_USER_SETTINGS.subtitleOriginalColor).toBe('#ffffff');
      expect(DEFAULT_USER_SETTINGS.subtitleTranslatedColor).toBe('#00f2fe');
      expect(DEFAULT_USER_SETTINGS.subtitleBackgroundOpacity).toBe(78);
      expect(DEFAULT_USER_SETTINGS.subtitleTextShadow).toBe(true);
      expect(DEFAULT_USER_SETTINGS.subtitleAutoPause).toBe(false);
      expect(DEFAULT_USER_SETTINGS.subtitleHotkeysEnabled).toBe(false);
    });

    it('clamps numeric ranges in normalizeSettings', () => {
      const clamped = normalizeSettings({
        subtitleOriginalFontSize: 50, // max is 36
        subtitleTranslatedFontSize: 5, // min is 10
        subtitleBackgroundOpacity: 150, // max is 100
      });
      expect(clamped.subtitleOriginalFontSize).toBe(36);
      expect(clamped.subtitleTranslatedFontSize).toBe(10);
      expect(clamped.subtitleBackgroundOpacity).toBe(100);

      const clampedLow = normalizeSettings({
        subtitleOriginalFontSize: 2, // min is 12
        subtitleTranslatedFontSize: 40, // max is 30
        subtitleBackgroundOpacity: -10, // min is 0
      });
      expect(clampedLow.subtitleOriginalFontSize).toBe(12);
      expect(clampedLow.subtitleTranslatedFontSize).toBe(30);
      expect(clampedLow.subtitleBackgroundOpacity).toBe(0);
    });

    it('validates hex color strings and falls back to defaults for invalid formats', () => {
      const valid = normalizeSettings({
        subtitleOriginalColor: '#ffeb3b',
        subtitleTranslatedColor: '#00ff88',
      });
      expect(valid.subtitleOriginalColor).toBe('#ffeb3b');
      expect(valid.subtitleTranslatedColor).toBe('#00ff88');

      const invalid = normalizeSettings({
        subtitleOriginalColor: 'invalid-red',
        subtitleTranslatedColor: '#12345',
      });
      expect(invalid.subtitleOriginalColor).toBe('#ffffff');
      expect(invalid.subtitleTranslatedColor).toBe('#00f2fe');
    });

    it('persists and retrieves updated subtitle customization and learning settings', async () => {
      await saveSettings({
        subtitleOriginalFontSize: 24,
        subtitleTranslatedFontSize: 18,
        subtitleOriginalColor: '#cbd5e1',
        subtitleTranslatedColor: '#ffeb3b',
        subtitleBackgroundOpacity: 90,
        subtitleTextShadow: false,
        subtitleAutoPause: true,
        subtitleHotkeysEnabled: true,
      });

      const updated = await getSettings();
      expect(updated.subtitleOriginalFontSize).toBe(24);
      expect(updated.subtitleTranslatedFontSize).toBe(18);
      expect(updated.subtitleOriginalColor).toBe('#cbd5e1');
      expect(updated.subtitleTranslatedColor).toBe('#ffeb3b');
      expect(updated.subtitleBackgroundOpacity).toBe(90);
      expect(updated.subtitleTextShadow).toBe(false);
      expect(updated.subtitleAutoPause).toBe(true);
      expect(updated.subtitleHotkeysEnabled).toBe(true);
    });
  });

  describe('2. SubtitleOverlay Component Custom Styling', () => {
    it('applies custom font sizes, colors, and opacity props', () => {
      const { container } = render(
        <SubtitleOverlay
          segment={sampleSegment}
          visible={true}
          originalFontSize={22}
          translatedFontSize={16}
          originalColor="#ffeb3b"
          translatedColor="#00ff88"
          backgroundOpacity={50}
        />
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;
      expect(pill).not.toBeNull();
      expect(pill.style.background).toBe('rgba(0, 0, 0, 0.5)');

      const originalEl = container.querySelector('.subtitle-original') as HTMLElement;
      expect(originalEl).not.toBeNull();
      expect(originalEl.style.fontSize).toBe('22px');
      expect(originalEl.style.color).toBe('rgb(255, 235, 59)'); // #ffeb3b

      const translatedEl = container.querySelector('.subtitle-translated') as HTMLElement;
      expect(translatedEl).not.toBeNull();
      expect(translatedEl.style.fontSize).toBe('16px');
      expect(translatedEl.style.color).toBe('rgb(0, 255, 136)'); // #00ff88
    });

    it('removes pill border when backgroundOpacity is 0', () => {
      const { container } = render(
        <SubtitleOverlay
          segment={sampleSegment}
          visible={true}
          backgroundOpacity={0}
        />
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;
      expect(pill.style.background).toBe('rgba(0, 0, 0, 0)');
      expect(pill.style.borderStyle === 'none' || pill.style.border === 'none' || pill.style.border === 'medium').toBe(true);
      expect(pill.style.border).not.toContain('rgba(255, 255, 255, 0.12)');
    });

    it('disables text shadow when textShadowEnabled is false', () => {
      const { container } = render(
        <SubtitleOverlay
          segment={sampleSegment}
          visible={true}
          textShadowEnabled={false}
        />
      );

      const originalEl = container.querySelector('.subtitle-original') as HTMLElement;
      const translatedEl = container.querySelector('.subtitle-translated') as HTMLElement;

      expect(originalEl.style.textShadow).toBe('none');
      expect(translatedEl.style.textShadow).toBe('none');
    });

    it('falls back to default styling when custom props are undefined', () => {
      const { container } = render(
        <SubtitleOverlay segment={sampleSegment} visible={true} />
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;
      expect(pill.style.background).toBe('rgba(0, 0, 0, 0.78)');

      const originalEl = container.querySelector('.subtitle-original') as HTMLElement;
      expect(originalEl.style.fontSize).toBe('18px');
      expect(originalEl.style.color).toBe('rgb(255, 255, 255)');
      expect(originalEl.style.textShadow).not.toBe('none');

      const translatedEl = container.querySelector('.subtitle-translated') as HTMLElement;
      expect(translatedEl.style.fontSize).toBe('15px');
      expect(translatedEl.style.color).toBe('rgb(0, 242, 254)');
    });
  });

  describe('3. Learning Utilities: Auto-Pause & Hotkey Navigation', () => {
    it('finds previous, current/nearest, and next segments correctly', () => {
      // Current time is inside seg-2 (time = 16)
      expect(findSegmentBefore(sampleSegments, 16)?.id).toBe('seg-1');
      expect(findSegmentAtOrNearest(sampleSegments, 16)?.id).toBe('seg-2');
      expect(findSegmentAfter(sampleSegments, 16)?.id).toBe('seg-3');

      // Current time is in silence gap between seg-1 and seg-2 (time = 14.5)
      expect(findSegmentBefore(sampleSegments, 14.5)?.id).toBe('seg-1');
      expect(findSegmentAtOrNearest(sampleSegments, 14.5)?.id).toBe('seg-1');
      expect(findSegmentAfter(sampleSegments, 14.5)?.id).toBe('seg-2');

      // Boundaries
      expect(findSegmentBefore(sampleSegments, 10)?.id).toBe('seg-1');
      expect(findSegmentAfter(sampleSegments, 25)).toBeNull();
    });

    it('evaluates shouldAutoPause accurately at segment boundary', () => {
      // Segment ends at 14. Within [13.9, 14.3]
      expect(shouldAutoPause(sampleSegment, 13.95, null, true)).toBe(true);
      // Already paused on this segment
      expect(shouldAutoPause(sampleSegment, 13.95, 'seg-1', true)).toBe(false);
      // Auto-pause disabled
      expect(shouldAutoPause(sampleSegment, 13.95, null, false)).toBe(false);
      // Before boundary (12.0s)
      expect(shouldAutoPause(sampleSegment, 12.0, null, true)).toBe(false);
      // Past boundary (15.0s)
      expect(shouldAutoPause(sampleSegment, 15.0, null, true)).toBe(false);
    });

    it('handles A/S/D keyboard hotkeys and navigates video currentTime', async () => {
      const container = document.createElement('div');
      container.id = 'movie_player';
      const video = document.createElement('video');
      video.currentTime = 16; // Inside seg-2 (15..18)
      const pauseSpy = vi.fn();
      video.pause = pauseSpy;
      container.appendChild(video);
      document.body.appendChild(container);

      let instance: any;
      act(() => {
        instance = mountSubtitleOverlay(container, {
          hotkeysEnabled: true,
          segments: sampleSegments,
          videoElement: video,
        });
      });

      // Press 's' to replay current segment (should seek to 15)
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
      });
      expect(video.currentTime).toBe(15);

      // Press 'a' to seek to previous segment (seg-1 start is 10)
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      });
      expect(video.currentTime).toBe(10);

      // Press 'd' to seek to next segment after 10 (seg-2 start is 15)
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
      });
      expect(video.currentTime).toBe(15);

      // Guard test: Typing in an input element should NOT trigger hotkey
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const eventWithTarget = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      Object.defineProperty(eventWithTarget, 'target', { value: input });
      act(() => {
        window.dispatchEvent(eventWithTarget);
      });
      // Video should still be 15, not changed to 10
      expect(video.currentTime).toBe(15);

      act(() => {
        instance.unmount();
      });
    });

    it('auto-pauses video cleanly once at the end of active segment', async () => {
      const container = document.createElement('div');
      container.id = 'movie_player';
      const video = document.createElement('video');
      video.currentTime = 13.5;
      const pauseSpy = vi.fn();
      video.pause = pauseSpy;
      container.appendChild(video);
      document.body.appendChild(container);

      let instance: any;
      act(() => {
        instance = mountSubtitleOverlay(container, {
          autoPauseEnabled: true,
          videoElement: video,
          segment: sampleSegment, // ends at 14.0
        });
      });

      // Simulate playback reaching end boundary
      video.currentTime = 13.95;
      act(() => {
        video.dispatchEvent(new Event('timeupdate'));
      });
      expect(pauseSpy).toHaveBeenCalledTimes(1);

      // Second timeupdate in same window should not pause again
      video.currentTime = 14.05;
      act(() => {
        video.dispatchEvent(new Event('timeupdate'));
      });
      expect(pauseSpy).toHaveBeenCalledTimes(1);

      act(() => {
        instance.unmount();
      });
    });
  });

  describe('4. OptionsDashboard Section 3 UI & Live Preview', () => {
    let segmentCache: SegmentCache;

    beforeEach(() => {
      segmentCache = new SegmentCache({ dbName: `test-options-ejoy-${Date.now()}` });
    });

    afterEach(() => {
      segmentCache.close();
    });

    it('renders font sliders, color presets, opacity slider, toggles, and live preview card', async () => {
      render(<OptionsDashboard segmentCache={segmentCache} />);

      // Font size sliders
      expect(await screen.findByTestId('original-font-size-slider')).toBeInTheDocument();
      expect(screen.getByTestId('translated-font-size-slider')).toBeInTheDocument();

      // Opacity slider
      expect(screen.getByTestId('bg-opacity-slider')).toBeInTheDocument();

      // Text shadow toggle
      expect(screen.getByTestId('text-shadow-toggle')).toBeInTheDocument();

      // Learning toggles
      expect(screen.getByTestId('auto-pause-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('hotkeys-toggle')).toBeInTheDocument();

      // Live subtitle preview
      const preview = screen.getByTestId('subtitle-live-preview');
      expect(preview).toBeInTheDocument();
      expect(preview.textContent).toContain('The quick brown fox');
      expect(preview.textContent).toContain('Con cáo nâu');
    });

    it('adjusts sliders and color pickers, persisting changes to storage and updating live preview', async () => {
      render(<OptionsDashboard segmentCache={segmentCache} />);

      const origSlider = (await screen.findByTestId('original-font-size-slider')) as HTMLInputElement;
      fireEvent.change(origSlider, { target: { value: '26' } });

      const transSlider = screen.getByTestId('translated-font-size-slider') as HTMLInputElement;
      fireEvent.change(transSlider, { target: { value: '20' } });

      const opacitySlider = screen.getByTestId('bg-opacity-slider') as HTMLInputElement;
      fireEvent.change(opacitySlider, { target: { value: '50' } });

      const autoPauseToggle = screen.getByTestId('auto-pause-toggle') as HTMLInputElement;
      fireEvent.click(autoPauseToggle);

      const hotkeysToggle = screen.getByTestId('hotkeys-toggle') as HTMLInputElement;
      fireEvent.click(hotkeysToggle);

      // Verify persisted in settings
      await waitFor(async () => {
        const stored = await getSettings();
        expect(stored.subtitleOriginalFontSize).toBe(26);
        expect(stored.subtitleTranslatedFontSize).toBe(20);
        expect(stored.subtitleBackgroundOpacity).toBe(50);
        expect(stored.subtitleAutoPause).toBe(true);
        expect(stored.subtitleHotkeysEnabled).toBe(true);
      });
    });

    it('selects color preset button for English/Original text and persists color', async () => {
      render(<OptionsDashboard segmentCache={segmentCache} />);

      const yellowPreset = await screen.findByTestId('original-color-preset-#ffeb3b');
      fireEvent.click(yellowPreset);

      await waitFor(async () => {
        const stored = await getSettings();
        expect(stored.subtitleOriginalColor).toBe('#ffeb3b');
      });
    });
  });

  describe('5. Cross-Context Storage & chrome.storage.onChanged Edge Cases', () => {
    const originalChrome = (globalThis as any).chrome;
    let storageMap: Map<string, any>;
    let storageListeners: Set<(changes: Record<string, any>, areaName: string) => void>;

    beforeEach(async () => {
      storageMap = new Map();
      storageListeners = new Set();

      (globalThis as any).chrome = {
        runtime: { lastError: null },
        storage: {
          local: {
            get: vi.fn((key: string, cb: (res: Record<string, any>) => void) => {
              cb({ [key]: storageMap.get(key) });
            }),
            set: vi.fn((items: Record<string, any>, cb?: () => void) => {
              const changes: Record<string, any> = {};
              for (const [k, v] of Object.entries(items)) {
                changes[k] = { oldValue: storageMap.get(k), newValue: v };
                storageMap.set(k, v);
              }
              cb?.();
              for (const listener of storageListeners) {
                listener(changes, 'local');
              }
            }),
            clear: vi.fn((cb?: () => void) => {
              storageMap.clear();
              cb?.();
            }),
          },
          onChanged: {
            addListener: vi.fn((listener) => storageListeners.add(listener)),
            removeListener: vi.fn((listener) => storageListeners.delete(listener)),
          },
        },
      };

      await resetSettingsForTesting();
    });

    afterEach(async () => {
      await resetSettingsForTesting();
      (globalThis as any).chrome = originalChrome;
    });

    it('preserves settings from another context when saving partial settings (no cross-context lost update)', async () => {
      // Simulate dashboard context saving customized settings directly into chrome.storage.local
      const dashboardSettings = normalizeSettings({
        targetLanguage: 'vi',
        subtitleOriginalFontSize: 24,
        subtitleBackgroundOpacity: 90,
      });
      storageMap.set('userSettings', dashboardSettings);

      // Simulate content script saving partial subtitlePosition update (e.g. from drag)
      await saveSettings({
        subtitlePosition: { xPercent: 45, yPercent: 75 },
      });

      const updated = await getSettings();
      // Dashboard-customized settings must be preserved!
      expect(updated.targetLanguage).toBe('vi');
      expect(updated.subtitleOriginalFontSize).toBe(24);
      expect(updated.subtitleBackgroundOpacity).toBe(90);
      // And new position must be saved
      expect(updated.subtitlePosition).toEqual({ xPercent: 45, yPercent: 75 });
    });

    it('does not override non-standard fontSizeScale with default slider values via chrome.storage.onChanged', async () => {
      const container = document.createElement('div');
      container.id = 'movie_player';
      document.body.appendChild(container);

      let instance: any;
      act(() => {
        instance = mountSubtitleOverlay(container, {
          segment: sampleSegment,
          visible: true,
        });
      });

      // Fire chrome.storage.onChanged with 'large' preset and default slider sizes
      const largeSettings = normalizeSettings({
        subtitleFontSize: 'large',
        subtitleOriginalFontSize: 18,
        subtitleTranslatedFontSize: 15,
      });

      act(() => {
        for (const listener of storageListeners) {
          listener({ userSettings: { newValue: largeSettings } }, 'local');
        }
      });

      // Under 'large' preset, original text should be 22px and translated text should be 18px
      const host = container.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
      expect(host).not.toBeNull();
      const shadow = host.shadowRoot!;
      const originalEl = shadow.querySelector('.subtitle-original') as HTMLElement;
      const translatedEl = shadow.querySelector('.subtitle-translated') as HTMLElement;

      expect(originalEl.style.fontSize).toBe('22px');
      expect(translatedEl.style.fontSize).toBe('18px');

      // Now fire with 'small' preset and default slider sizes
      const smallSettings = normalizeSettings({
        subtitleFontSize: 'small',
        subtitleOriginalFontSize: 18,
        subtitleTranslatedFontSize: 15,
      });

      act(() => {
        for (const listener of storageListeners) {
          listener({ userSettings: { newValue: smallSettings } }, 'local');
        }
      });

      // Under 'small' preset, original text should be 14px and translated text should be 12px
      expect(originalEl.style.fontSize).toBe('14px');
      expect(translatedEl.style.fontSize).toBe('12px');

      act(() => {
        instance.unmount();
      });
    });

    it('applies custom slider font sizes via chrome.storage.onChanged and resets when reverted to default', async () => {
      const container = document.createElement('div');
      container.id = 'movie_player';
      document.body.appendChild(container);

      let instance: any;
      act(() => {
        instance = mountSubtitleOverlay(container, {
          segment: sampleSegment,
          visible: true,
        });
      });

      // Fire chrome.storage.onChanged with custom originalFontSize: 28 while on 'large' preset
      const customSliderSettings = normalizeSettings({
        subtitleFontSize: 'large',
        subtitleOriginalFontSize: 28,
        subtitleTranslatedFontSize: 20,
      });

      act(() => {
        for (const listener of storageListeners) {
          listener({ userSettings: { newValue: customSliderSettings } }, 'local');
        }
      });

      const host = container.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
      const shadow = host.shadowRoot!;
      const originalEl = shadow.querySelector('.subtitle-original') as HTMLElement;
      const translatedEl = shadow.querySelector('.subtitle-translated') as HTMLElement;

      expect(originalEl.style.fontSize).toBe('28px');
      expect(translatedEl.style.fontSize).toBe('20px');

      // Revert sliders back to default while keeping 'large' preset
      const revertedSettings = normalizeSettings({
        subtitleFontSize: 'large',
        subtitleOriginalFontSize: 18,
        subtitleTranslatedFontSize: 15,
      });

      act(() => {
        for (const listener of storageListeners) {
          listener({ userSettings: { newValue: revertedSettings } }, 'local');
        }
      });

      // Stale custom font size overrides must be deleted, reverting to large preset (22px / 18px)
      expect(originalEl.style.fontSize).toBe('22px');
      expect(translatedEl.style.fontSize).toBe('18px');

      act(() => {
        instance.unmount();
      });
    });
  });
});
