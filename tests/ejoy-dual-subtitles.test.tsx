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
} from '@/entrypoints/content/subtitle-mount';
import {
  getSettings,
  saveSettings,
  resetSettingsForTesting,
  DEFAULT_USER_SETTINGS,
  normalizeSettings,
  type SubtitlePosition,
} from '@/storage/settings';
import { OptionsDashboard } from '@/entrypoints/options/OptionsDashboard';
import { SegmentCache } from '@/storage/segment-cache';
import type { Segment } from '@/types/domain';

describe('eJOY-Style Dual Subtitle Overlay and Draggable Positioning (Issue #20 / ADR-0015)', () => {
  const sampleSegment: Segment = {
    id: 'seg-1',
    startTime: 10,
    endTime: 14,
    duration: 4,
    sourceText: 'Hello world, welcome to our channel!',
    translatedText: 'Xin chào thế giới, chào mừng đến với kênh!',
  };

  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    await resetSettingsForTesting();
  });

  afterEach(() => {
    resetSubtitleMountForTesting();
    document.body.innerHTML = '';
  });

  describe('1. Settings Schema & Defaults', () => {
    it('defaults subtitleLineOrder to original-first and subtitlePosition to null', async () => {
      const settings = await getSettings();
      expect(settings.subtitleLineOrder).toBe('original-first');
      expect(settings.subtitlePosition).toBeNull();
      expect(DEFAULT_USER_SETTINGS.subtitleLineOrder).toBe('original-first');
      expect(DEFAULT_USER_SETTINGS.subtitlePosition).toBeNull();
    });

    it('normalizes undefined settings to original-first lineOrder and null position', () => {
      const normalized = normalizeSettings({});
      expect(normalized.subtitleLineOrder).toBe('original-first');
      expect(normalized.subtitlePosition).toBeNull();
    });

    it('persists and validates subtitlePosition coordinates', async () => {
      await saveSettings({
        subtitlePosition: { xPercent: 35.5, yPercent: 62.8 },
      });

      const settings = await getSettings();
      expect(settings.subtitlePosition).toEqual({ xPercent: 35.5, yPercent: 62.8 });

      // Reset position back to null
      await saveSettings({ subtitlePosition: null });
      const reset = await getSettings();
      expect(reset.subtitlePosition).toBeNull();
    });

    it('clamps out-of-range subtitlePosition coordinates between 0 and 100 in normalizeSettings', () => {
      const normalized = normalizeSettings({
        subtitlePosition: { xPercent: -15, yPercent: 120 },
      });
      expect(normalized.subtitlePosition).toEqual({ xPercent: 0, yPercent: 100 });
    });
  });

  describe('2. SubtitleOverlay Component eJOY Styling', () => {
    it('renders English source on top (#ffffff, weight 600, 18px, text-shadow) and Vietnamese translation below (#00f2fe, weight 500, 15px) by default', () => {
      const { container } = render(
        <SubtitleOverlay segment={sampleSegment} visible={true} />
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;
      expect(pill).not.toBeNull();

      // Pill styling per ADR-0015
      expect(pill.style.background).toBe('rgba(0, 0, 0, 0.78)');
      expect(pill.style.backdropFilter).toContain('blur(8px)');
      expect(pill.style.borderRadius).toBe('6px');
      expect(pill.style.border).toContain('rgba(255, 255, 255, 0.12)');
      expect(pill.style.userSelect).toBe('text');
      expect(pill.style.cursor).toBe('grab');

      // Default line order: original first
      const children = Array.from(pill.children) as HTMLElement[];
      expect(children).toHaveLength(2);

      const originalEl = children[0];
      const translatedEl = children[1];

      expect(originalEl.classList.contains('subtitle-original')).toBe(true);
      expect(originalEl.textContent).toBe('Hello world, welcome to our channel!');
      expect(originalEl.style.color).toBe('rgb(255, 255, 255)');
      expect(originalEl.style.fontWeight).toBe('600');
      expect(originalEl.style.fontSize).toBe('18px');
      expect(originalEl.style.textShadow).toContain('rgba(0, 0, 0, 0.9)');

      expect(translatedEl.classList.contains('subtitle-translated')).toBe(true);
      expect(translatedEl.textContent).toBe('Xin chào thế giới, chào mừng đến với kênh!');
      expect(translatedEl.style.color).toBe('rgb(0, 242, 254)'); // #00f2fe
      expect(translatedEl.style.fontWeight).toBe('500');
      expect(translatedEl.style.fontSize).toBe('15px');
      expect(translatedEl.style.textShadow).toContain('rgba(0, 0, 0, 0.8)');
    });

    it('scales font size hierarchy for small (14px/12px) and large (22px/18px)', () => {
      const { container, rerender } = render(
        <SubtitleOverlay segment={sampleSegment} visible={true} fontSizeScale="small" />
      );

      const pillSmall = container.querySelector('.subtitle-pill') as HTMLElement;
      const originalSmall = pillSmall.querySelector('.subtitle-original') as HTMLElement;
      const translatedSmall = pillSmall.querySelector('.subtitle-translated') as HTMLElement;

      expect(originalSmall.style.fontSize).toBe('14px');
      expect(translatedSmall.style.fontSize).toBe('12px');

      rerender(
        <SubtitleOverlay segment={sampleSegment} visible={true} fontSizeScale="large" />
      );

      const pillLarge = container.querySelector('.subtitle-pill') as HTMLElement;
      const originalLarge = pillLarge.querySelector('.subtitle-original') as HTMLElement;
      const translatedLarge = pillLarge.querySelector('.subtitle-translated') as HTMLElement;

      expect(originalLarge.style.fontSize).toBe('22px');
      expect(translatedLarge.style.fontSize).toBe('18px');
    });

    it('supports translated-only mode with #00f2fe cyan text at primary font size (18px)', () => {
      const { container } = render(
        <SubtitleOverlay segment={sampleSegment} visible={true} displayMode="translated-only" />
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;
      expect(pill.querySelector('.subtitle-original')).toBeNull();
      const translatedEl = pill.querySelector('.subtitle-translated') as HTMLElement;
      expect(translatedEl).not.toBeNull();
      expect(translatedEl.style.color).toBe('rgb(0, 242, 254)');
      expect(translatedEl.style.fontSize).toBe('18px');
    });

    it('supports original-only mode with #ffffff text at primary font size (18px)', () => {
      const { container } = render(
        <SubtitleOverlay segment={sampleSegment} visible={true} displayMode="original-only" />
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;
      expect(pill.querySelector('.subtitle-translated')).toBeNull();
      const originalEl = pill.querySelector('.subtitle-original') as HTMLElement;
      expect(originalEl).not.toBeNull();
      expect(originalEl.style.color).toBe('rgb(255, 255, 255)');
      expect(originalEl.style.fontSize).toBe('18px');
    });
  });

  describe('3. Mouse Drag Interaction & Positioning Events', () => {
    it('stops event propagation on pill interactions to prevent YouTube play/pause toggle', () => {
      const { container } = render(
        <SubtitleOverlay segment={sampleSegment} visible={true} />
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;
      const mouseEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      const stopSpy = vi.spyOn(mouseEvent, 'stopPropagation');

      pill.dispatchEvent(mouseEvent);
      expect(stopSpy).toHaveBeenCalled();
    });

    it('invokes onPositionChange on mouse drag and clamp coordinates within 2% to 98%', () => {
      const onPositionChange = vi.fn();
      const { container } = render(
        <div style={{ width: '1000px', height: '600px', position: 'relative' }}>
          <SubtitleOverlay
            segment={sampleSegment}
            visible={true}
            onPositionChange={onPositionChange}
          />
        </div>
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;

      // Mock getBoundingClientRect
      vi.spyOn(pill, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 60,
        left: 400,
        top: 450,
        right: 600,
        bottom: 510,
        x: 400,
        y: 450,
        toJSON: () => {},
      });

      const parentEl = pill.parentElement as HTMLElement;
      vi.spyOn(parentEl, 'getBoundingClientRect').mockReturnValue({
        width: 1000,
        height: 600,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Mouse down to start drag
      fireEvent.mouseDown(pill, { clientX: 500, clientY: 480, button: 0 });

      // Mouse move to new coordinates
      fireEvent.mouseMove(window, { clientX: 200, clientY: 150 });

      // Mouse up to finish drag
      fireEvent.mouseUp(window);

      expect(onPositionChange).toHaveBeenCalledTimes(1);
      const pos = onPositionChange.mock.calls[0][0] as SubtitlePosition;
      expect(pos.xPercent).toBeGreaterThanOrEqual(2);
      expect(pos.xPercent).toBeLessThanOrEqual(98);
      expect(pos.yPercent).toBeGreaterThanOrEqual(2);
      expect(pos.yPercent).toBeLessThanOrEqual(98);
    });

    it('invokes onResetPosition on double click', () => {
      const onResetPosition = vi.fn();
      const { container } = render(
        <SubtitleOverlay
          segment={sampleSegment}
          visible={true}
          onResetPosition={onResetPosition}
        />
      );

      const pill = container.querySelector('.subtitle-pill') as HTMLElement;
      fireEvent.doubleClick(pill);

      expect(onResetPosition).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Subtitle Mount Integration & Absolute Percentage Positioning', () => {
    let moviePlayer: HTMLElement;

    beforeEach(() => {
      moviePlayer = document.createElement('div');
      moviePlayer.id = 'movie_player';
      moviePlayer.className = 'html5-video-player';
      document.body.appendChild(moviePlayer);
    });

    it('positions host element using percentage coordinates when subtitlePosition is configured', async () => {
      await saveSettings({
        subtitlePosition: { xPercent: 30, yPercent: 40 },
      });

      let instance!: ReturnType<typeof mountSubtitleOverlay>;
      await act(async () => {
        instance = mountSubtitleOverlay(moviePlayer, {
          segment: sampleSegment,
          visible: true,
        });
      });

      const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;

      await vi.waitFor(() => {
        expect(host.style.left).toBe('30%');
        expect(host.style.top).toBe('40%');
        expect(host.style.bottom).toBe('auto');
        expect(host.style.transform).toBe('translate(-50%, -50%)');
      });
    });

    it('restores default bottom docking when subtitlePosition is reset to null', async () => {
      await saveSettings({
        subtitlePosition: { xPercent: 20, yPercent: 30 },
      });

      let instance!: ReturnType<typeof mountSubtitleOverlay>;
      await act(async () => {
        instance = mountSubtitleOverlay(moviePlayer, {
          segment: sampleSegment,
          visible: true,
        });
      });

      const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;

      await vi.waitFor(() => {
        expect(host.style.left).toBe('20%');
      });

      // Call resetPosition on instance
      await act(async () => {
        instance.resetPosition();
      });

      expect(host.style.left).toBe('50%');
      expect(host.style.top).toBe('auto');
      expect(host.style.transform).toBe('translateX(-50%)');
      expect(host.style.bottom).toBe('96px');
    });

    it('exports setPosition and resetPosition on SubtitleOverlayInstance', async () => {
      const instance = mountSubtitleOverlay(moviePlayer, {
        segment: sampleSegment,
        visible: true,
      });

      expect(typeof instance.setPosition).toBe('function');
      expect(typeof instance.resetPosition).toBe('function');

      const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;

      act(() => {
        instance.setPosition({ xPercent: 42, yPercent: 68 });
      });

      expect(host.style.left).toBe('42%');
      expect(host.style.top).toBe('68%');
      expect(host.style.bottom).toBe('auto');
      expect(host.style.transform).toBe('translate(-50%, -50%)');

      act(() => {
        instance.resetPosition();
      });

      expect(host.style.left).toBe('50%');
      expect(host.style.top).toBe('auto');
      expect(host.style.transform).toBe('translateX(-50%)');
    });

    it('injects grab cursor and pointer-events styles into shadow root', () => {
      const instance = mountSubtitleOverlay(moviePlayer, {
        segment: sampleSegment,
        visible: true,
      });

      const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
      const styleEl = host.shadowRoot?.querySelector('style[data-aetherdub-subtitle-style="true"]');
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toContain('cursor: grab');
      expect(styleEl?.textContent).toContain('user-select: text');
    });
  });

  describe('5. OptionsDashboard Command Center Integration', () => {
    let segmentCache: SegmentCache;

    beforeEach(async () => {
      segmentCache = new SegmentCache();
    });

    afterEach(() => {
      segmentCache.close();
    });

    it('defaults line order to original-first in Command Center and provides Reset Subtitle Position button', async () => {
      render(<OptionsDashboard segmentCache={segmentCache} />);

      const lineOrderSelect = await screen.findByTestId('subtitle-line-order-select');
      expect(lineOrderSelect).toHaveValue('original-first');

      const resetBtn = await screen.findByTestId('reset-subtitle-position-btn');
      expect(resetBtn).toBeInTheDocument();
      expect(resetBtn).toHaveTextContent(/Reset Subtitle Position/i);
    });

    it('resets subtitlePosition in storage and notifies active subtitle instance when Reset Subtitle Position is clicked', async () => {
      await saveSettings({
        subtitlePosition: { xPercent: 30, yPercent: 50 },
      });

      const moviePlayer = document.createElement('div');
      moviePlayer.id = 'movie_player';
      document.body.appendChild(moviePlayer);

      const instance = mountSubtitleOverlay(moviePlayer);
      const resetSpy = vi.spyOn(instance, 'resetPosition');

      render(<OptionsDashboard segmentCache={segmentCache} />);

      const resetBtn = await screen.findByTestId('reset-subtitle-position-btn');
      fireEvent.click(resetBtn);

      await waitFor(async () => {
        const settings = await getSettings();
        expect(settings.subtitlePosition).toBeNull();
      });

      expect(resetSpy).toHaveBeenCalled();
    });
  });
});
