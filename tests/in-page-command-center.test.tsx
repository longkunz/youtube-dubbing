import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { InPageCommandCenter } from '@/components/InPageCommandCenter';
import {
  mountCommandCenter,
  openCommandCenter,
  closeCommandCenter,
  toggleCommandCenter,
  isCommandCenterOpen,
  resetCommandCenterForTesting,
} from '@/entrypoints/content/command-center-mount';
import { HudContainer } from '@/components/HudContainer';
import { resetSettingsForTesting } from '@/storage/settings';

describe('In-Page Command Center Slide-Over Drawer (Issue #17)', () => {
  let videoEl: HTMLVideoElement;
  let originalChrome: any;

  beforeEach(async () => {
    await resetSettingsForTesting();
    resetCommandCenterForTesting();

    // Prepare video element in DOM
    videoEl = document.createElement('video');
    videoEl.className = 'html5-main-video';
    videoEl.play = vi.fn().mockResolvedValue(undefined);
    videoEl.pause = vi.fn();
    document.body.appendChild(videoEl);

    // Mock chrome APIs
    originalChrome = (globalThis as any).chrome;
    (globalThis as any).chrome = {
      runtime: {
        openOptionsPage: vi.fn(),
        sendMessage: vi.fn((msg, cb) => {
          if (cb) cb({ success: true });
        }),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  afterEach(async () => {
    await act(async () => {
      resetCommandCenterForTesting();
    });
    document.body.innerHTML = '';
    (globalThis as any).chrome = originalChrome;
    vi.restoreAllMocks();
  });

  describe('Mounting & Shadow DOM Encapsulation', () => {
    it('mounts into document.body with isolated open Shadow DOM and host attribute', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
      });

      expect(instance).not.toBeNull();
      const hostEl = document.querySelector('[data-aetherdub-command-center-host="true"]');
      expect(hostEl).not.toBeNull();
      expect(hostEl?.shadowRoot).not.toBeNull();
      expect(hostEl?.shadowRoot?.mode).toBe('open');

      // Verify scoped style element inside shadow root
      const styleEl = hostEl?.shadowRoot?.querySelector('style');
      expect(styleEl).not.toBeNull();

      // Ensure drawer is isolated in shadow root and does not pollute document.body
      expect(document.querySelector('[data-testid="command-center-drawer"]')).toBeNull();

      await act(async () => {
        instance.unmount();
      });
      expect(document.querySelector('[data-aetherdub-command-center-host="true"]')).toBeNull();
    });

    it('mounts inside document.fullscreenElement when video is in fullscreen', async () => {
      const fullscreenContainer = document.createElement('div');
      fullscreenContainer.id = 'player-fullscreen';
      document.body.appendChild(fullscreenContainer);

      // Mock document.fullscreenElement
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => fullscreenContainer,
      });

      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
      });

      expect(fullscreenContainer.querySelector('[data-aetherdub-command-center-host="true"]')).not.toBeNull();

      await act(async () => {
        instance.unmount();
      });
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => null,
      });
    });
  });

  describe('Drawer DOM Structure & Elements', () => {
    it('renders drawer header with title, auto-save badge, open-in-tab, and close button without dark backdrop', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
        instance.open();
      });

      const shadowRoot = instance.shadowRoot;
      const drawer = shadowRoot.querySelector('[data-testid="command-center-drawer"]');
      expect(drawer).not.toBeNull();

      // No backdrop covering the page/video
      expect(shadowRoot.querySelector('[data-testid="drawer-backdrop"]')).toBeNull();

      // Header title
      const title = shadowRoot.querySelector('[data-testid="command-center-title"]');
      expect(title).not.toBeNull();
      expect(title?.textContent).toContain('AETHERDUB // COMMAND CENTER');

      // Auto-save badge
      const autoSaveBadge = shadowRoot.querySelector('[data-testid="autosave-badge"]');
      expect(autoSaveBadge).not.toBeNull();

      // Open in Tab button
      const openInTabBtn = shadowRoot.querySelector('[data-testid="command-center-open-tab-btn"]');
      expect(openInTabBtn).not.toBeNull();

      // Close button
      const closeBtn = shadowRoot.querySelector('[data-testid="command-center-close-btn"]');
      expect(closeBtn).not.toBeNull();

      // Body container with OptionsDashboard
      const body = shadowRoot.querySelector('[data-testid="command-center-body"]');
      expect(body).not.toBeNull();
    });
  });

  describe('Video Playback Coordination', () => {
    it('pauses the main video when drawer opens, and keeps it paused when drawer closes', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
      });

      expect(videoEl.pause).not.toHaveBeenCalled();

      // Open drawer
      await act(async () => {
        instance.open();
      });
      expect(videoEl.pause).toHaveBeenCalledTimes(1);

      // Close drawer
      await act(async () => {
        instance.close();
      });
      // Crucial: video.play() must NOT be called (stay paused per ADR-0011)
      expect(videoEl.play).not.toHaveBeenCalled();
    });
  });

  describe('Dismissal Interactions', () => {
    it('closes drawer when Close [✕] button is clicked', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
        instance.open();
      });

      expect(isCommandCenterOpen()).toBe(true);

      const closeBtn = instance.shadowRoot.querySelector('[data-testid="command-center-close-btn"]') as HTMLElement;
      await act(async () => {
        fireEvent.click(closeBtn);
      });

      expect(isCommandCenterOpen()).toBe(false);
    });

    it('closes drawer when Escape key is pressed', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
        instance.open();
      });

      expect(isCommandCenterOpen()).toBe(true);

      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      });

      expect(isCommandCenterOpen()).toBe(false);
    });

    it('closes drawer and traps click propagation when clicking outside the drawer', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
        instance.open();
      });

      expect(isCommandCenterOpen()).toBe(true);

      const outsideButton = document.createElement('button');
      outsideButton.id = 'yt-video-overlay-btn';
      const outsideClickSpy = vi.fn();
      outsideButton.addEventListener('click', outsideClickSpy);
      document.body.appendChild(outsideButton);

      await act(async () => {
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        outsideButton.dispatchEvent(clickEvent);
      });

      // Drawer closed
      expect(isCommandCenterOpen()).toBe(false);
      // Event propagation stopped on the first click so underlying YouTube controls do not fire
      expect(outsideClickSpy).not.toHaveBeenCalled();
    });

    it('does not close drawer when clicking inside the drawer body', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
        instance.open();
      });

      expect(isCommandCenterOpen()).toBe(true);

      const body = instance.shadowRoot.querySelector('[data-testid="command-center-body"]') as HTMLElement;
      await act(async () => {
        fireEvent.click(body);
      });

      expect(isCommandCenterOpen()).toBe(true);
    });

    it('toggles open/close when toggleCommandCenter is called', async () => {
      mountCommandCenter();
      expect(isCommandCenterOpen()).toBe(false);

      await act(async () => {
        toggleCommandCenter();
      });
      expect(isCommandCenterOpen()).toBe(true);

      await act(async () => {
        toggleCommandCenter();
      });
      expect(isCommandCenterOpen()).toBe(false);
    });

    it('closes drawer on YouTube SPA navigation (yt-navigate-finish)', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
        instance.open();
      });
      expect(isCommandCenterOpen()).toBe(true);

      await act(async () => {
        window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      });
      expect(isCommandCenterOpen()).toBe(false);
    });
  });

  describe('Open in Tab Action', () => {
    it('triggers chrome.runtime.openOptionsPage when Open in Tab button is clicked', async () => {
      let instance: ReturnType<typeof mountCommandCenter> = null as any;
      await act(async () => {
        instance = mountCommandCenter();
        instance.open();
      });

      const openTabBtn = instance.shadowRoot.querySelector('[data-testid="command-center-open-tab-btn"]') as HTMLElement;
      await act(async () => {
        fireEvent.click(openTabBtn);
      });

      expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    });
  });

  describe('CyberCockpit & HUD Integration', () => {
    it('opens In-Page Command Center when clicking Settings in CyberCockpit footer', async () => {
      mountCommandCenter();
      expect(isCommandCenterOpen()).toBe(false);

      const onOpenSettings = vi.fn(() => {
        openCommandCenter();
      });

      const { getByTestId } = render(
        <HudContainer
          isOpen={true}
          onOpenCommandCenter={openCommandCenter}
          onConfigureSettings={openCommandCenter}
        />
      );

      const settingsBtn = getByTestId('cockpit-footer-settings-btn');
      await act(async () => {
        fireEvent.click(settingsBtn);
      });

      expect(isCommandCenterOpen()).toBe(true);
    });
  });
});
