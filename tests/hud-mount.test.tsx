import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountHud } from '@/entrypoints/content/mount';
import { tryMount, resetActiveInstanceForTesting } from '@/entrypoints/content/index';
import { act } from 'react';
import { fireEvent } from '@testing-library/react';
import type { DubbingOrchestrator } from '@/types/domain';

describe('Shadow DOM In-Player HUD Mount Seam', () => {
  let playerContainer: HTMLElement;

  beforeEach(() => {
    playerContainer = document.createElement('div');
    playerContainer.className = 'ytp-right-controls';
    document.body.appendChild(playerContainer);
  });

  afterEach(async () => {
    await act(async () => {
      resetActiveInstanceForTesting();
    });
    document.body.innerHTML = '';
  });

  it('mounts an isolated Shadow DOM container inside the player container without polluting host DOM', async () => {
    let instance: ReturnType<typeof mountHud> = null as any;
    await act(async () => {
      instance = mountHud(playerContainer);
    });

    expect(instance!.isMounted()).toBe(true);

    const hostEl = playerContainer.querySelector('[data-aetherdub-host]');
    expect(hostEl).not.toBeNull();
    expect(hostEl?.shadowRoot).not.toBeNull();
    const shadowRoot = hostEl!.shadowRoot!;

    expect(document.querySelector('.hyper-pill-trigger')).toBeNull();
    expect(shadowRoot.querySelector('.hyper-pill-trigger')).not.toBeNull();
    expect(shadowRoot.textContent).toContain('NEURAL DUB');

    await act(async () => {
      instance!.unmount();
    });
    expect(instance!.isMounted()).toBe(false);
    expect(playerContainer.querySelector('[data-aetherdub-host]')).toBeNull();
  });

  it('toggles the Cyber Cockpit HUD panel when clicking the trigger pill', async () => {
    let instance: ReturnType<typeof mountHud> = null as any;
    await act(async () => {
      instance = mountHud(playerContainer);
    });

    const shadowRoot = playerContainer.querySelector('[data-aetherdub-host]')!.shadowRoot!;
    const triggerPill = shadowRoot.querySelector('.hyper-pill-trigger') as HTMLElement;
    expect(triggerPill).not.toBeNull();

    const cockpit = shadowRoot.querySelector('.cyber-cockpit') as HTMLElement;
    expect(cockpit).not.toBeNull();
    expect(cockpit.classList.contains('open')).toBe(false);

    await act(async () => {
      fireEvent.click(triggerPill);
    });
    expect(cockpit.classList.contains('open')).toBe(true);
    expect(triggerPill.classList.contains('active')).toBe(true);

    const closeBtn = shadowRoot.querySelector('.cockpit-close-btn') as HTMLElement;
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      fireEvent.click(closeBtn);
    });
    expect(cockpit.classList.contains('open')).toBe(false);

    await act(async () => {
      instance!.unmount();
    });
  });

  it('contains scoped CSS inside the Shadow Root preventing global style leakage', async () => {
    let instance: ReturnType<typeof mountHud> = null as any;
    await act(async () => {
      instance = mountHud(playerContainer);
    });

    const shadowRoot = playerContainer.querySelector('[data-aetherdub-host]')!.shadowRoot!;
    const styleEl = shadowRoot.querySelector('style');
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain('.hyper-pill-trigger');
    expect(styleEl!.textContent).toContain('.cyber-cockpit');

    expect(document.head.querySelector('style[data-aetherdub-style]')).toBeNull();

    await act(async () => {
      instance!.unmount();
    });
  });

  it('removes stale uninitialized host element to prevent duplicate DOM mounts', async () => {
    const staleHost = document.createElement('div');
    staleHost.setAttribute('data-aetherdub-host', 'true');
    playerContainer.appendChild(staleHost);

    let instance: ReturnType<typeof mountHud> = null as any;
    await act(async () => {
      instance = mountHud(playerContainer);
    });

    const allHosts = playerContainer.querySelectorAll('[data-aetherdub-host]');
    expect(allHosts.length).toBe(1);
    expect(instance!.isMounted()).toBe(true);

    await act(async () => {
      instance!.unmount();
    });
  });

  it('tryMount cleanly manages lifecycle across SPA navigations', async () => {
    // 1. Video page with controls
    let instance: ReturnType<typeof tryMount> = null;
    await act(async () => {
      instance = tryMount();
    });
    expect(instance).not.toBeNull();
    expect(instance!.isMounted()).toBe(true);

    // Calling tryMount again when already mounted returns the same active instance
    let recheckInstance: ReturnType<typeof tryMount> = null;
    await act(async () => {
      recheckInstance = tryMount();
    });
    expect(recheckInstance).toBe(instance);

    // 2. Navigating to non-video page (controls removed)
    await act(async () => {
      playerContainer.remove();
    });
    let unmountInstance: ReturnType<typeof tryMount> = null;
    await act(async () => {
      unmountInstance = tryMount();
    });
    expect(unmountInstance).toBeNull();
    expect(instance!.isMounted()).toBe(false);

    // 3. Navigating to a new video page (new controls created)
    const newControls = document.createElement('div');
    newControls.className = 'ytp-right-controls';
    document.body.appendChild(newControls);

    let newInstance: ReturnType<typeof tryMount> = null;
    await act(async () => {
      newInstance = tryMount();
    });
    expect(newInstance).not.toBeNull();
    expect(newInstance!.isMounted()).toBe(true);
    expect(newControls.querySelector('[data-aetherdub-host]')).not.toBeNull();

    await act(async () => {
      resetActiveInstanceForTesting();
    });
  });

  it('integrates Cyber Cockpit interactions and SubtitleOverlay with DubbingOrchestrator in Shadow DOM', async () => {
    const mockOrchestrator: DubbingOrchestrator = {
      init: vi.fn().mockResolvedValue(undefined),
      handleTimeUpdate: vi.fn(),
      handleSeek: vi.fn(),
      handleRateChange: vi.fn(),
      handlePlay: vi.fn(),
      handlePause: vi.fn(),
      setTargetLanguage: vi.fn().mockResolvedValue(undefined),
      setVoiceProfile: vi.fn(),
      setDuckLevel: vi.fn(),
      getActiveSegment: vi.fn().mockReturnValue({
        id: 'seg-test',
        startTime: 0,
        endTime: 3,
        duration: 3,
        sourceText: 'Hello world',
        translatedText: 'Xin chào thế giới',
      }),
      isDucked: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue({
        status: 'playing',
        targetLanguage: 'vi',
        playbackRate: 1.0,
        activeSegmentId: 'seg-test',
      }),
      destroy: vi.fn(),
    };

    let instance: ReturnType<typeof mountHud> = null as any;
    await act(async () => {
      instance = mountHud(playerContainer, mockOrchestrator);
    });

    const shadowRoot = instance.shadowRoot;

    // SubtitleOverlay should be visible in Shadow DOM with translated text
    const subtitlePill = shadowRoot.querySelector('.subtitle-pill');
    expect(subtitlePill).not.toBeNull();
    expect(subtitlePill?.textContent).toContain('Xin chào thế giới');
    expect(subtitlePill?.textContent).toContain('Hello world');

    // Open Cockpit
    const triggerPill = shadowRoot.querySelector('.hyper-pill-trigger') as HTMLElement;
    await act(async () => {
      fireEvent.click(triggerPill);
    });

    const cockpit = shadowRoot.querySelector('.cyber-cockpit') as HTMLElement;
    expect(cockpit.classList.contains('open')).toBe(true);

    // Language Selector
    const langSelect = shadowRoot.querySelector('.cyber-select') as HTMLSelectElement;
    expect(langSelect).not.toBeNull();
    await act(async () => {
      fireEvent.change(langSelect, { target: { value: 'en' } });
    });
    expect(mockOrchestrator.setTargetLanguage).toHaveBeenCalledWith('en');

    // Voice Matrix Selection
    const namMinhCard = Array.from(shadowRoot.querySelectorAll('.voice-card')).find((card) =>
      card.textContent?.includes('NAM MINH')
    ) as HTMLElement;
    expect(namMinhCard).not.toBeNull();
    await act(async () => {
      fireEvent.click(namMinhCard);
    });
    expect(mockOrchestrator.setVoiceProfile).toHaveBeenCalled();

    // Ducking Slider
    const duckSlider = shadowRoot.querySelector('.cyber-slider') as HTMLInputElement;
    expect(duckSlider).not.toBeNull();
    await act(async () => {
      fireEvent.change(duckSlider, { target: { value: '40' } });
    });
    expect(mockOrchestrator.setDuckLevel).toHaveBeenCalledWith(0.4);

    // Toggle On/Off Switch -> should pause dubbing and hide subtitles
    const toggleSwitch = shadowRoot.querySelector('.cyber-toggle-switch') as HTMLElement;
    expect(toggleSwitch).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggleSwitch);
    });
    expect(mockOrchestrator.handlePause).toHaveBeenCalled();

    // SubtitleOverlay should now be hidden because visible=false
    expect(shadowRoot.querySelector('.subtitle-pill')).toBeNull();

    // Toggle On/Off Switch back ON -> resumes dubbing
    await act(async () => {
      fireEvent.click(toggleSwitch);
    });
    expect(mockOrchestrator.handlePlay).toHaveBeenCalled();

    await act(async () => {
      instance.unmount();
    });
  });
});
