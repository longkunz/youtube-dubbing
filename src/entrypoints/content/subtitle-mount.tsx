import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  SubtitleOverlay,
  type SubtitleOverlayProps,
  type SubtitleDisplayMode,
  type SubtitleLineOrder,
  type SubtitleFontSize,
} from '@/components/SubtitleOverlay';
import type { Segment } from '@/types/domain';
import {
  getSettings,
  subscribeToSettings,
  normalizeSettings,
} from '@/storage/settings';

export type { SubtitleDisplayMode, SubtitleLineOrder, SubtitleFontSize };

export interface SubtitleMountProps extends SubtitleOverlayProps {}

export interface SubtitleOverlayInstance {
  unmount: () => void;
  isMounted: () => boolean;
  shadowRoot: ShadowRoot;
  hostEl: HTMLElement;
  updateProps: (props: Partial<SubtitleMountProps>) => void;
  setSegment: (segment: Segment | null) => void;
  setVisible: (visible: boolean) => void;
}

const NATIVE_CC_STYLE_ID = 'aetherdub-native-cc-suppression';

function updateNativeCcSuppression(suppress: boolean): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(NATIVE_CC_STYLE_ID);
  if (suppress) {
    if (!existing) {
      const style = document.createElement('style');
      style.id = NATIVE_CC_STYLE_ID;
      style.textContent = `
        .ytp-caption-window-bottom {
          display: none !important;
        }
      `;
      (document.head || document.documentElement || document.body)?.appendChild(style);
    }
  } else {
    if (existing) {
      existing.remove();
    }
  }
}

let activeSubtitleInstance: SubtitleOverlayInstance | null = null;

export function getActiveSubtitleInstance(): SubtitleOverlayInstance | null {
  return activeSubtitleInstance;
}

export function resetSubtitleMountForTesting(): void {
  if (activeSubtitleInstance) {
    activeSubtitleInstance.unmount();
    activeSubtitleInstance = null;
  }
  updateNativeCcSuppression(false);
}

/**
 * Mount the Parallel Caption Overlay directly inside #movie_player
 * encapsulated within an isolated Shadow DOM host.
 */
export function mountSubtitleOverlay(
  playerContainer?: HTMLElement | null,
  initialProps?: Partial<SubtitleMountProps>,
): SubtitleOverlayInstance {
  // Resolve target player container
  const container =
    playerContainer ||
    (typeof document !== 'undefined'
      ? (document.getElementById('movie_player') as HTMLElement | null) ||
        (document.querySelector('.html5-video-player') as HTMLElement | null) ||
        document.body
      : null);

  if (!container) {
    throw new Error('[AetherDub] Unable to find container for Subtitle Overlay mount');
  }

  // Check if an existing host is already attached to this container
  const existingHost = container.querySelector('[data-aetherdub-subtitle-host="true"]') as HTMLElement | null;
  if (existingHost) {
    if ((existingHost as any).__aetherdub_subtitle_instance) {
      return (existingHost as any).__aetherdub_subtitle_instance;
    }
    existingHost.remove();
  }

  // Create isolated host element
  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-aetherdub-subtitle-host', 'true');
  hostEl.style.position = 'absolute';
  hostEl.style.left = '50%';
  hostEl.style.transform = 'translateX(-50%)';
  hostEl.style.pointerEvents = 'none';
  hostEl.style.zIndex = '9999';

  // Function to adapt bottom position based on YouTube controls autohide state
  const updateBottomPosition = () => {
    const isAutohide = container.classList.contains('ytp-autohide');
    hostEl.style.bottom = isAutohide ? '56px' : '96px';
  };

  updateBottomPosition();

  // Observe player class mutations for ytp-autohide dynamic adaptation
  let classObserver: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined') {
    classObserver = new MutationObserver(() => {
      updateBottomPosition();
    });
    classObserver.observe(container, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  // Attach open Shadow DOM
  const shadowRoot = hostEl.attachShadow({ mode: 'open' });

  // Inject host and component styles inside Shadow DOM
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-aetherdub-subtitle-style', 'true');
  styleEl.textContent = `
    :host {
      display: block;
      pointer-events: none;
    }
    .subtitle-overlay {
      display: flex;
      justify-content: center;
      align-items: center;
      pointer-events: none;
    }
    .subtitle-pill {
      user-select: none;
      transition: opacity 0.15s ease-in-out;
    }
  `;
  shadowRoot.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  mountPoint.className = 'aetherdub-subtitle-mount-root';
  shadowRoot.appendChild(mountPoint);

  let mounted = true;
  let currentProps: SubtitleMountProps = {
    visible: true,
    displayMode: 'bilingual',
    lineOrder: 'translated-first',
    fontSizeScale: 'standard',
    ...initialProps,
  };

  let root: Root | null = createRoot(mountPoint);

  const renderComponent = () => {
    if (!mounted || !root) return;

    // Check if subtitle should actively suppress native CC
    const isVis = currentProps.visible !== false;
    const hasActiveContent = Boolean(
      currentProps.segment &&
        (currentProps.segment.translatedText || currentProps.segment.sourceText)
    );
    updateNativeCcSuppression(isVis && hasActiveContent);

    flushSync(() => {
      root?.render(
        <SubtitleOverlay
          {...currentProps}
          isControlsVisible={!container.classList.contains('ytp-autohide')}
        />
      );
    });
  };

  renderComponent();
  container.appendChild(hostEl);

  let storageListener: ((changes: Record<string, any>, areaName: string) => void) | null = null;
  let unsubscribeSettings: (() => void) | null = null;

  const explicitlySet = new Set<string>(
    Object.keys(initialProps ?? {}).filter((k) => (initialProps as any)[k] !== undefined)
  );

  const instance: SubtitleOverlayInstance = {
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      classObserver?.disconnect();
      classObserver = null;
      unsubscribeSettings?.();
      unsubscribeSettings = null;
      if (storageListener && typeof chrome !== 'undefined' && (chrome?.storage as any)?.onChanged?.removeListener) {
        (chrome.storage as any).onChanged.removeListener(storageListener);
        storageListener = null;
      }
      updateNativeCcSuppression(false);
      if (root) {
        root.unmount();
        root = null;
      }
      if (hostEl.parentNode) {
        hostEl.parentNode.removeChild(hostEl);
      }
      if (activeSubtitleInstance === instance) {
        activeSubtitleInstance = null;
      }
    },
    isMounted: () => mounted && (hostEl.isConnected ?? true),
    shadowRoot,
    hostEl,
    updateProps: (newProps: Partial<SubtitleMountProps>) => {
      for (const k of Object.keys(newProps)) {
        explicitlySet.add(k);
      }
      currentProps = { ...currentProps, ...newProps };
      renderComponent();
    },
    setSegment: (segment: Segment | null) => {
      currentProps = { ...currentProps, segment };
      renderComponent();
    },
    setVisible: (visible: boolean) => {
      currentProps = { ...currentProps, visible };
      renderComponent();
    },
  };

  (hostEl as any).__aetherdub_subtitle_instance = instance;
  activeSubtitleInstance = instance;

  // Read initial subtitle settings from storage (for properties not explicitly provided)
  getSettings()
    .then((settings) => {
      if (!mounted) return;
      const toApply: Partial<SubtitleMountProps> = {};
      if (!explicitlySet.has('displayMode')) {
        toApply.displayMode = settings.subtitleDisplayMode;
      }
      if (!explicitlySet.has('lineOrder')) {
        toApply.lineOrder = settings.subtitleLineOrder;
      }
      if (!explicitlySet.has('fontSizeScale')) {
        toApply.fontSizeScale = settings.subtitleFontSize;
      }
      if (Object.keys(toApply).length > 0) {
        currentProps = { ...currentProps, ...toApply };
        renderComponent();
      }
    })
    .catch(() => {});

  // Listen for settings updates via in-memory subscription
  unsubscribeSettings = subscribeToSettings((settings) => {
    if (!mounted) return;
    getActiveSubtitleInstance()?.updateProps({
      displayMode: settings.subtitleDisplayMode,
      lineOrder: settings.subtitleLineOrder,
      fontSizeScale: settings.subtitleFontSize,
    });
  });

  // Listen for settings updates via chrome.storage.onChanged
  if (typeof chrome !== 'undefined' && (chrome?.storage as any)?.onChanged?.addListener) {
    storageListener = (changes: Record<string, any>, areaName: string) => {
      if (areaName === 'local' && changes.userSettings?.newValue && mounted) {
        const updated = normalizeSettings(changes.userSettings.newValue);
        getActiveSubtitleInstance()?.updateProps({
          displayMode: updated.subtitleDisplayMode,
          lineOrder: updated.subtitleLineOrder,
          fontSizeScale: updated.subtitleFontSize,
        });
      }
    };
    (chrome.storage as any).onChanged.addListener(storageListener);
  }

  return instance;
}
