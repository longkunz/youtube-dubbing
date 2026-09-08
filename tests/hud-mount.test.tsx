import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountHud } from '@/entrypoints/content/mount';
import { tryMount, resetActiveInstanceForTesting } from '@/entrypoints/content/index';
import { act } from 'react';
import { fireEvent } from '@testing-library/react';

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
});
