import { defineContentScript } from 'wxt/utils/define-content-script';
import { getExtensionRuntime } from '@/core/extension-runtime';
import { mountHud, HudInstance } from './mount';
import { stopDubbingPipeline } from './orchestrator-coordinator';

let activeInstance: HudInstance | null = null;

/**
 * Mount the in-player HUD into the YouTube toolbar in a dormant (DUB: OFF) state.
 *
 * Per ADR-0008 (On-Demand Activation): this function NO LONGER automatically
 * starts the dubbing pipeline. The pipeline is only triggered when the user
 * explicitly activates dubbing via the Split Pill Control.
 */
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

  // Already mounted and host element still present — return the existing instance.
  // Do NOT restart the pipeline on re-check.
  if (activeInstance && activeInstance.isMounted() && controls.querySelector('[data-aetherdub-host]')) {
    return activeInstance;
  }

  // Stale instance (e.g. after SPA navigation unmounted the host element)
  if (activeInstance) {
    activeInstance.unmount();
    activeInstance = null;
    stopDubbingPipeline();
  }

  // Mount fresh — in dormant state, no pipeline launch
  activeInstance = mountHud(controls);
  return activeInstance;
}

export function resetActiveInstanceForTesting(): void {
  stopDubbingPipeline();
  if (activeInstance) {
    activeInstance.unmount();
    activeInstance = null;
  }
}

function keepBackgroundAlive(): void {
  const runtime = getExtensionRuntime();
  if (!runtime?.connect) return;
  try {
    const port = runtime.connect({ name: 'aetherdub-keepalive' });
    port.onDisconnect?.addListener(() => {
      setTimeout(keepBackgroundAlive, 1500);
    });
  } catch {
    // Isolated world without runtime — in-process translation fallback handles this.
  }
}

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  world: 'ISOLATED',
  runAt: 'document_idle',
  main() {
    keepBackgroundAlive();
    tryMount();

    // YouTube SPA navigation events — remount HUD in dormant state,
    // do NOT auto-start pipeline (On-Demand Activation, ADR-0008).
    window.addEventListener('yt-navigate-finish', () => {
      tryMount();
    });

    // MAIN-world bridge ready — previously used to trigger pipeline.
    // Now: only remount HUD if it wasn't already mounted (e.g. race condition
    // where bridge fires before player controls appeared). Do NOT start pipeline.
    document.addEventListener('aetherdub:player-response-ready', () => {
      if (!activeInstance) {
        tryMount();
      }
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
