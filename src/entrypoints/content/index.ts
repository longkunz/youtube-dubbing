import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountHud, HudInstance } from './mount';

let activeInstance: HudInstance | null = null;

export function tryMount(): HudInstance | null {
  const controls = document.querySelector('.ytp-right-controls') as HTMLElement | null;
  if (!controls) {
    if (activeInstance) {
      activeInstance.unmount();
      activeInstance = null;
    }
    return null;
  }

  if (activeInstance && activeInstance.isMounted() && controls.querySelector('[data-aetherdub-host]')) {
    return activeInstance;
  }

  if (activeInstance) {
    activeInstance.unmount();
    activeInstance = null;
  }

  activeInstance = mountHud(controls);
  return activeInstance;
}

export function resetActiveInstanceForTesting(): void {
  if (activeInstance) {
    activeInstance.unmount();
    activeInstance = null;
  }
}

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    tryMount();

    // YouTube SPA navigation events
    window.addEventListener('yt-navigate-finish', () => {
      tryMount();
    });

    // Observer for dynamic player bar appearance/hydration
    const observer = new MutationObserver(() => {
      const controls = document.querySelector('.ytp-right-controls');
      if (controls && !controls.querySelector('[data-aetherdub-host]')) {
        tryMount();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  },
});
