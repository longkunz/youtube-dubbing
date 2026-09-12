import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act } from 'react';
import { mountSubtitleOverlay, resetSubtitleMountForTesting } from '@/entrypoints/content/subtitle-mount';
import { saveSettings, resetSettingsForTesting } from '@/storage/settings';
import type { Segment } from '@/types/domain';

describe('Parallel Caption Overlay Mount & Encapsulation', () => {
  let moviePlayer: HTMLElement;
  const sampleSegment: Segment = {
    id: 'seg-1',
    startTime: 10,
    endTime: 14,
    duration: 4,
    sourceText: 'Hello world, welcome to our channel!',
    translatedText: 'Xin chào thế giới, chào mừng đến với kênh!',
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    moviePlayer = document.createElement('div');
    moviePlayer.id = 'movie_player';
    moviePlayer.className = 'html5-video-player';
    document.body.appendChild(moviePlayer);
  });

  afterEach(() => {
    resetSubtitleMountForTesting();
    document.body.innerHTML = '';
  });

  it('mounts inside #movie_player with open Shadow DOM host and required base styles', () => {
    const instance = mountSubtitleOverlay(moviePlayer);

    expect(instance).toBeDefined();
    expect(instance.isMounted()).toBe(true);

    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot?.mode).toBe('open');

    // Horizontal centering & overlay layering per ADR-0012
    expect(host.style.position).toBe('absolute');
    expect(host.style.left).toBe('50%');
    expect(host.style.transform).toBe('translateX(-50%)');
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.zIndex).toBe('9999');
  });

  it('falls back to .html5-video-player or document.body when #movie_player is not specified or found', () => {
    const fallbackPlayer = document.createElement('div');
    fallbackPlayer.className = 'html5-video-player';
    document.body.innerHTML = '';
    document.body.appendChild(fallbackPlayer);

    const instance = mountSubtitleOverlay();
    expect(fallbackPlayer.querySelector('[data-aetherdub-subtitle-host="true"]')).not.toBeNull();
    expect(instance.isMounted()).toBe(true);
  });

  it('adapts bottom position dynamically: 96px with controls visible, 56px when ytp-autohide is present', async () => {
    // 1. Controls visible (no ytp-autohide) -> bottom: 96px
    moviePlayer.className = 'html5-video-player';
    const instance = mountSubtitleOverlay(moviePlayer);
    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;

    expect(host.style.bottom).toBe('96px');

    // 2. Controls autohidden (ytp-autohide added) -> bottom: 56px
    moviePlayer.classList.add('ytp-autohide');

    // Allow MutationObserver to propagate
    await vi.waitFor(() => {
      expect(host.style.bottom).toBe('56px');
    });

    // 3. Controls restored (ytp-autohide removed) -> bottom: 96px
    moviePlayer.classList.remove('ytp-autohide');
    await vi.waitFor(() => {
      expect(host.style.bottom).toBe('96px');
    });
  });

  it('renders clean bilingual subtitle pill with rgba(8, 8, 8, 0.84) background and white text', async () => {
    const instance = mountSubtitleOverlay(moviePlayer, {
      segment: sampleSegment,
      visible: true,
      displayMode: 'bilingual',
    });

    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
    const shadowRoot = host.shadowRoot!;

    const pill = shadowRoot.querySelector('.subtitle-pill') as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.style.background).toBe('rgba(8, 8, 8, 0.84)');
    expect(pill.style.color).toBe('rgb(255, 255, 255)');

    const translatedEl = shadowRoot.querySelector('.subtitle-translated');
    const originalEl = shadowRoot.querySelector('.subtitle-original');

    expect(translatedEl).not.toBeNull();
    expect(translatedEl?.textContent).toBe('Xin chào thế giới, chào mừng đến với kênh!');
    expect(originalEl).not.toBeNull();
    expect(originalEl?.textContent).toBe('Hello world, welcome to our channel!');
  });

  it('supports displayMode options: bilingual, translated-only, and original-only', async () => {
    const instance = mountSubtitleOverlay(moviePlayer, {
      segment: sampleSegment,
      visible: true,
      displayMode: 'translated-only',
    });

    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
    const shadowRoot = host.shadowRoot!;

    // translated-only
    expect(shadowRoot.querySelector('.subtitle-translated')?.textContent).toBe(
      'Xin chào thế giới, chào mừng đến với kênh!'
    );
    expect(shadowRoot.querySelector('.subtitle-original')).toBeNull();

    // Switch to original-only
    await act(async () => {
      instance.updateProps({ displayMode: 'original-only' });
    });

    expect(shadowRoot.querySelector('.subtitle-translated')).toBeNull();
    expect(shadowRoot.querySelector('.subtitle-original')?.textContent).toBe(
      'Hello world, welcome to our channel!'
    );

    // Switch to bilingual
    await act(async () => {
      instance.updateProps({ displayMode: 'bilingual' });
    });

    expect(shadowRoot.querySelector('.subtitle-translated')).not.toBeNull();
    expect(shadowRoot.querySelector('.subtitle-original')).not.toBeNull();
  });

  it('supports lineOrder: translated-first (default) and original-first', async () => {
    const instance = mountSubtitleOverlay(moviePlayer, {
      segment: sampleSegment,
      visible: true,
      displayMode: 'bilingual',
      lineOrder: 'translated-first',
    });

    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
    const shadowRoot = host.shadowRoot!;
    const pill = shadowRoot.querySelector('.subtitle-pill')!;

    // Default: translated first
    expect(pill.children[0].className).toContain('subtitle-translated');
    expect(pill.children[1].className).toContain('subtitle-original');

    // Switch to original-first
    await act(async () => {
      instance.updateProps({ lineOrder: 'original-first' });
    });

    expect(pill.children[0].className).toContain('subtitle-original');
    expect(pill.children[1].className).toContain('subtitle-translated');
  });

  it('supports fontSizeScale: small (14px), standard (18px), large (22px)', async () => {
    const instance = mountSubtitleOverlay(moviePlayer, {
      segment: sampleSegment,
      visible: true,
      fontSizeScale: 'small',
    });

    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
    const shadowRoot = host.shadowRoot!;
    const translatedEl = shadowRoot.querySelector('.subtitle-translated') as HTMLElement;
    expect(translatedEl.style.fontSize).toBe('14px');

    await act(async () => {
      instance.updateProps({ fontSizeScale: 'standard' });
    });
    expect(translatedEl.style.fontSize).toBe('18px');

    await act(async () => {
      instance.updateProps({ fontSizeScale: 'large' });
    });
    expect(translatedEl.style.fontSize).toBe('22px');
  });

  it('suppresses native CC (.ytp-caption-window-bottom) when visible, restoring it when hidden or unmounted', async () => {
    // Native CC window in YouTube DOM
    const nativeCc = document.createElement('div');
    nativeCc.className = 'ytp-caption-window-bottom';
    document.body.appendChild(nativeCc);

    const instance = mountSubtitleOverlay(moviePlayer, {
      segment: sampleSegment,
      visible: true,
    });

    // Check that suppression style tag is injected
    const suppressionStyle = document.getElementById('aetherdub-native-cc-suppression');
    expect(suppressionStyle).not.toBeNull();
    expect(suppressionStyle?.textContent).toContain('.ytp-caption-window-bottom');
    expect(suppressionStyle?.textContent).toContain('display: none !important');

    // Hide subtitle overlay -> suppression style removed
    await act(async () => {
      instance.setVisible(false);
    });

    expect(document.getElementById('aetherdub-native-cc-suppression')).toBeNull();

    // Show again
    await act(async () => {
      instance.setVisible(true);
    });
    expect(document.getElementById('aetherdub-native-cc-suppression')).not.toBeNull();

    // Unmount -> suppression style removed
    instance.unmount();
    expect(document.getElementById('aetherdub-native-cc-suppression')).toBeNull();
  });

  it('immediately updates rendered text on scrub sync via setSegment', async () => {
    const instance = mountSubtitleOverlay(moviePlayer, {
      segment: sampleSegment,
      visible: true,
    });

    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
    const shadowRoot = host.shadowRoot!;

    expect(shadowRoot.querySelector('.subtitle-translated')?.textContent).toBe(
      'Xin chào thế giới, chào mừng đến với kênh!'
    );

    // Scrub video forward to seg-2
    const scrubbedSegment: Segment = {
      id: 'seg-2',
      startTime: 20,
      endTime: 25,
      duration: 5,
      sourceText: 'Let us build something incredible today.',
      translatedText: 'Hôm nay chúng ta hãy xây dựng điều gì đó tuyệt vời.',
    };

    await act(async () => {
      instance.setSegment(scrubbedSegment);
    });

    expect(shadowRoot.querySelector('.subtitle-translated')?.textContent).toBe(
      'Hôm nay chúng ta hãy xây dựng điều gì đó tuyệt vời.'
    );
    expect(shadowRoot.querySelector('.subtitle-original')?.textContent).toBe(
      'Let us build something incredible today.'
    );

    // Scrub into a gap between segments
    await act(async () => {
      instance.setSegment(null);
    });

    expect(shadowRoot.querySelector('.subtitle-pill')).toBeNull();
  });

  it('reads subtitleDisplayMode, subtitleLineOrder, and subtitleFontSize from getSettings() on mount', async () => {
    await saveSettings({
      subtitleDisplayMode: 'translated-only',
      subtitleLineOrder: 'original-first',
      subtitleFontSize: 'large',
    });

    let instance!: ReturnType<typeof mountSubtitleOverlay>;
    await act(async () => {
      instance = mountSubtitleOverlay(moviePlayer, {
        segment: sampleSegment,
        visible: true,
      });
    });

    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
    const shadowRoot = host.shadowRoot!;

    await vi.waitFor(() => {
      // Translated only
      expect(shadowRoot.querySelector('.subtitle-translated')).not.toBeNull();
      expect(shadowRoot.querySelector('.subtitle-original')).toBeNull();
      const translatedEl = shadowRoot.querySelector('.subtitle-translated') as HTMLElement;
      // Large fontSize is 22px
      expect(translatedEl.style.fontSize).toBe('22px');
    });

    await resetSettingsForTesting();
  });

  it('reactively updates active subtitle overlay props when settings change', async () => {
    let instance!: ReturnType<typeof mountSubtitleOverlay>;
    await act(async () => {
      instance = mountSubtitleOverlay(moviePlayer, {
        segment: sampleSegment,
        visible: true,
      });
    });

    const host = moviePlayer.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement;
    const shadowRoot = host.shadowRoot!;

    // Initial default: bilingual, translated-first, standard (18px)
    await vi.waitFor(() => {
      expect(shadowRoot.querySelector('.subtitle-translated')).not.toBeNull();
      expect(shadowRoot.querySelector('.subtitle-original')).not.toBeNull();
    });

    // Change settings to translated-only and small (14px)
    await act(async () => {
      await saveSettings({
        subtitleDisplayMode: 'translated-only',
        subtitleFontSize: 'small',
      });
    });

    await vi.waitFor(() => {
      expect(shadowRoot.querySelector('.subtitle-translated')).not.toBeNull();
      expect(shadowRoot.querySelector('.subtitle-original')).toBeNull();
      const translatedEl = shadowRoot.querySelector('.subtitle-translated') as HTMLElement;
      expect(translatedEl.style.fontSize).toBe('14px');
    });

    await resetSettingsForTesting();
  });
});
