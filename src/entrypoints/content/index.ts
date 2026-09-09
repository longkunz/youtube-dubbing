import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountHud, HudInstance } from './mount';
import { startDubbingPipeline, stopDubbingPipeline } from './orchestrator-coordinator';

let activeInstance: HudInstance | null = null;

export function tryMount(): HudInstance | null {
  const controls = document.querySelector('.ytp-right-controls') as HTMLElement | null;
  if (!controls) {
    if (activeInstance) {
      activeInstance.unmount();
      activeInstance = null;
      stopDubbingPipeline();
    }
    return null;
  }

  if (activeInstance && activeInstance.isMounted() && controls.querySelector('[data-aetherdub-host]')) {
    startDubbingPipeline(activeInstance).catch(() => {});
    return activeInstance;
  }

  if (activeInstance) {
    activeInstance.unmount();
    activeInstance = null;
    stopDubbingPipeline();
  }

  activeInstance = mountHud(controls);
  startDubbingPipeline(activeInstance).catch(() => {});
  return activeInstance;
}

export function resetActiveInstanceForTesting(): void {
  stopDubbingPipeline();
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
