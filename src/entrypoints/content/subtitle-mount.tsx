import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  SubtitleOverlay,
  type SubtitleOverlayProps,
  type SubtitleDisplayMode,
  type SubtitleLineOrder,
  type SubtitleFontSize,
  type SubtitlePosition,
} from '@/components/SubtitleOverlay';
import type { Segment } from '@/types/domain';
import {
  getSettings,
  saveSettings,
  subscribeToSettings,
  normalizeSettings,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
} from '@/storage/settings';

export type { SubtitleDisplayMode, SubtitleLineOrder, SubtitleFontSize, SubtitlePosition };

export interface SubtitleMountProps extends SubtitleOverlayProps {
  segments?: Segment[];
  videoElement?: HTMLVideoElement | null;
  autoPauseEnabled?: boolean;
  hotkeysEnabled?: boolean;
}

export interface SubtitleOverlayInstance {
  unmount: () => void;
  destroy?: () => void;
  isMounted: () => boolean;
  shadowRoot: ShadowRoot;
  hostEl: HTMLElement;
  updateProps: (props: Partial<SubtitleMountProps>) => void;
  setSegment: (segment: Segment | null) => void;
  setSegments?: (segments: Segment[]) => void;
  setVisible: (visible: boolean) => void;
  setPosition: (pos: SubtitlePosition | null) => void;
  resetPosition: () => void;
  getSegments?: () => Segment[];
  getVideo?: () => HTMLVideoElement | null;
}

export function getSegmentStartTime(segment: Segment): number {
  return (segment as any).startSec ?? segment.startTime ?? 0;
}

export function getSegmentEndTime(segment: Segment): number {
  return (segment as any).endSec ?? segment.endTime ?? 0;
}

export function shouldAutoPause(
  segment: Segment | null | undefined,
  currentTime: number,
  lastAutoPausedSegmentId: string | null,
  autoPauseEnabled: boolean
): boolean {
  if (!autoPauseEnabled || !segment) return false;
  if (lastAutoPausedSegmentId === segment.id) return false;
  const endSec = getSegmentEndTime(segment);
  return currentTime >= endSec - 0.1 && currentTime <= endSec + 0.3;
}

export function findSegmentBefore(segments: Segment[], currentTime: number): Segment | null {
  if (!segments || segments.length === 0) return null;
  const activeIndex = segments.findIndex((s) => {
    const start = getSegmentStartTime(s);
    const end = getSegmentEndTime(s);
    return currentTime >= start && currentTime <= end;
  });

  if (activeIndex > 0) {
    return segments[activeIndex - 1];
  }
  if (activeIndex === 0) {
    return segments[0];
  }

  for (let i = segments.length - 1; i >= 0; i--) {
    if (getSegmentStartTime(segments[i]) < currentTime) {
      return segments[i];
    }
  }
  return null;
}

function distanceToSegment(s: Segment, currentTime: number): number {
  const start = getSegmentStartTime(s);
  const end = getSegmentEndTime(s);
  if (currentTime >= start && currentTime <= end) return 0;
  if (currentTime < start) return start - currentTime;
  return currentTime - end;
}

export function findSegmentAtOrNearest(segments: Segment[], currentTime: number): Segment | null {
  if (!segments || segments.length === 0) return null;
  const active = segments.find((s) => {
    const start = getSegmentStartTime(s);
    const end = getSegmentEndTime(s);
    return currentTime >= start && currentTime <= end;
  });
  if (active) return active;

  let nearest = segments[0];
  let minDiff = distanceToSegment(segments[0], currentTime);
  for (let i = 1; i < segments.length; i++) {
    const diff = distanceToSegment(segments[i], currentTime);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = segments[i];
    }
  }
  return nearest;
}

export function findSegmentAfter(segments: Segment[], currentTime: number): Segment | null {
  if (!segments || segments.length === 0) return null;
  const activeIndex = segments.findIndex((s) => {
    const start = getSegmentStartTime(s);
    const end = getSegmentEndTime(s);
    return currentTime >= start && currentTime <= end;
  });

  if (activeIndex !== -1 && activeIndex + 1 < segments.length) {
    return segments[activeIndex + 1];
  }

  for (let i = 0; i < segments.length; i++) {
    if (getSegmentStartTime(segments[i]) > currentTime) {
      return segments[i];
    }
  }
  return null;
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
        .caption-window,
        .caption-window *,
        .ytp-caption-window,
        .ytp-caption-window *,
        .ytp-caption-window-bottom,
        .ytp-caption-window-bottom *,
        .ytp-caption-window-top,
        .ytp-caption-window-top *,
        .ytp-caption-window-rollup,
        .ytp-caption-window-rollup *,
        .ytp-caption-segment,
        .ytp-caption-window-container,
        .ytp-caption-window-container *,
        #ytp-caption-window-container,
        #ytp-caption-window-container * {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
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

  let currentPosition: SubtitlePosition | null = null;

  // Function to adapt bottom position based on YouTube controls autohide state
  const updateBottomPosition = () => {
    if (currentPosition) {
      hostEl.style.bottom = 'auto';
      return;
    }
    const isAutohide = container.classList.contains('ytp-autohide');
    hostEl.style.bottom = isAutohide ? '56px' : '96px';
  };

  const applyPosition = (pos: SubtitlePosition | null) => {
    currentPosition = pos;
    if (pos) {
      hostEl.style.left = `${pos.xPercent}%`;
      hostEl.style.top = `${pos.yPercent}%`;
      hostEl.style.bottom = 'auto';
      hostEl.style.transform = 'translate(-50%, -50%)';
    } else {
      hostEl.style.left = '50%';
      hostEl.style.top = 'auto';
      hostEl.style.transform = 'translateX(-50%)';
      updateBottomPosition();
    }
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
      user-select: text;
      cursor: grab;
      pointer-events: auto;
      transition: opacity 0.15s ease-in-out;
    }
    .subtitle-pill.is-dragging,
    .subtitle-pill.dragging {
      cursor: grabbing;
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
    lineOrder: 'original-first',
    fontSizeScale: 'standard',
    ...initialProps,
  };

  let root: Root | null = createRoot(mountPoint);

  const renderComponent = () => {
    if (!mounted || !root) return;

    // Keep native CC continuously suppressed as long as subtitle overlay is active/visible,
    // preventing YouTube's native CC from flickering back in during silence gaps or segment transitions.
    const isVis = currentProps.visible !== false;
    updateNativeCcSuppression(isVis);

    flushSync(() => {
      root?.render(
        <SubtitleOverlay
          {...currentProps}
          isControlsVisible={!container.classList.contains('ytp-autohide')}
          onPositionChange={(pos) => {
            applyPosition(pos);
            void saveSettings({ subtitlePosition: pos });
            currentProps.onPositionChange?.(pos);
          }}
          onResetPosition={() => {
            applyPosition(null);
            void saveSettings({ subtitlePosition: null });
            currentProps.onResetPosition?.();
          }}
        />
      );
    });
  };

  renderComponent();
  container.appendChild(hostEl);

  let currentSettings: UserSettings = { ...DEFAULT_USER_SETTINGS };
  let currentSegments: Segment[] = initialProps?.segments ?? [];
  if (initialProps?.segment && currentSegments.length === 0) {
    currentSegments = [initialProps.segment];
  }

  const getVideo = (): HTMLVideoElement | null => {
    return (
      currentProps.videoElement ??
      (container.querySelector('video') as HTMLVideoElement | null) ??
      (typeof document !== 'undefined' ? (document.querySelector('video') as HTMLVideoElement | null) : null)
    );
  };

  let lastAutoPausedSegmentId: string | null = null;

  const checkAutoPause = (currentTime: number) => {
    const isAutoPauseEnabled =
      currentProps.autoPauseEnabled ?? currentSettings.subtitleAutoPause;
    if (!isAutoPauseEnabled) return;

    const seg = currentProps.segment ?? currentProps.activeSegment;
    if (!seg) return;

    if (shouldAutoPause(seg, currentTime, lastAutoPausedSegmentId, true)) {
      const video = getVideo();
      if (video) {
        video.pause();
        lastAutoPausedSegmentId = seg.id;
      }
    } else {
      const endSec = getSegmentEndTime(seg);
      if (lastAutoPausedSegmentId === seg.id && (currentTime < endSec - 0.2 || currentTime > endSec + 0.5)) {
        lastAutoPausedSegmentId = null;
      }
    }
  };

  const onTimeUpdate = () => {
    const video = getVideo();
    if (video) {
      checkAutoPause(video.currentTime);
    }
  };

  let boundVideo: HTMLVideoElement | null = null;
  const attachVideo = (v: HTMLVideoElement | null) => {
    if (boundVideo && boundVideo !== v) {
      boundVideo.removeEventListener('timeupdate', onTimeUpdate);
    }
    boundVideo = v;
    if (boundVideo) {
      boundVideo.addEventListener('timeupdate', onTimeUpdate);
    }
  };

  attachVideo(getVideo());

  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const isEditable =
      target &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        target.getAttribute?.('contenteditable') === 'true');
    if (isEditable) return;

    const isHotkeysEnabled =
      currentProps.hotkeysEnabled ?? currentSettings.subtitleHotkeysEnabled;
    if (!isHotkeysEnabled) return;

    const key = e.key.toLowerCase();
    if (key !== 'a' && key !== 's' && key !== 'd') return;

    const video = getVideo();
    if (!video) return;

    const segs = currentProps.segments ?? currentSegments;
    if (!segs || segs.length === 0) return;

    const currentTime = video.currentTime;

    if (key === 'a') {
      const prev = findSegmentBefore(segs, currentTime);
      if (prev) {
        e.preventDefault();
        e.stopPropagation();
        video.currentTime = getSegmentStartTime(prev);
      }
    } else if (key === 's') {
      const curr = findSegmentAtOrNearest(segs, currentTime);
      if (curr) {
        e.preventDefault();
        e.stopPropagation();
        video.currentTime = getSegmentStartTime(curr);
      }
    } else if (key === 'd') {
      const next = findSegmentAfter(segs, currentTime);
      if (next) {
        e.preventDefault();
        e.stopPropagation();
        video.currentTime = getSegmentStartTime(next);
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
  }

  let storageListener: ((changes: Record<string, any>, areaName: string) => void) | null = null;
  let unsubscribeSettings: (() => void) | null = null;

  const explicitlySet = new Set<string>(
    Object.keys(initialProps ?? {}).filter((k) => (initialProps as any)[k] !== undefined)
  );

  const instance: SubtitleOverlayInstance = {
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
      }
      if (boundVideo) {
        boundVideo.removeEventListener('timeupdate', onTimeUpdate);
        boundVideo = null;
      }
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
    destroy: () => {
      instance.unmount();
    },
    isMounted: () => mounted && (hostEl.isConnected ?? true),
    shadowRoot,
    hostEl,
    updateProps: (newProps: Partial<SubtitleMountProps>) => {
      for (const k of Object.keys(newProps)) {
        explicitlySet.add(k);
      }
      if (newProps.segments) {
        currentSegments = newProps.segments;
      }
      if (
        (newProps.fontSizeScale && newProps.originalFontSize === undefined) ||
        ('originalFontSize' in newProps && newProps.originalFontSize === undefined)
      ) {
        delete currentProps.originalFontSize;
        explicitlySet.delete('originalFontSize');
      }
      if (
        (newProps.fontSizeScale && newProps.translatedFontSize === undefined) ||
        ('translatedFontSize' in newProps && newProps.translatedFontSize === undefined)
      ) {
        delete currentProps.translatedFontSize;
        explicitlySet.delete('translatedFontSize');
      }
      currentProps = { ...currentProps, ...newProps };
      if (
        (newProps.fontSizeScale && newProps.originalFontSize === undefined) ||
        ('originalFontSize' in newProps && newProps.originalFontSize === undefined)
      ) {
        delete currentProps.originalFontSize;
      }
      if (
        (newProps.fontSizeScale && newProps.translatedFontSize === undefined) ||
        ('translatedFontSize' in newProps && newProps.translatedFontSize === undefined)
      ) {
        delete currentProps.translatedFontSize;
      }
      if (newProps.videoElement !== undefined) {
        attachVideo(getVideo());
      }
      renderComponent();
    },
    setSegment: (segment: Segment | null) => {
      currentProps = { ...currentProps, segment };
      if (segment && !currentSegments.some((s) => s.id === segment.id)) {
        currentSegments = [...currentSegments, segment];
      }
      attachVideo(getVideo());
      const video = getVideo();
      if (video) {
        checkAutoPause(video.currentTime);
      }
      renderComponent();
    },
    setSegments: (segments: Segment[]) => {
      currentSegments = segments;
      currentProps = { ...currentProps, segments };
    },
    setVisible: (visible: boolean) => {
      currentProps = { ...currentProps, visible };
      renderComponent();
    },
    setPosition: (pos: SubtitlePosition | null) => {
      applyPosition(pos);
    },
    resetPosition: () => {
      applyPosition(null);
      void saveSettings({ subtitlePosition: null });
    },
    getSegments: () => currentSegments,
    getVideo: () => getVideo(),
  };

  (hostEl as any).__aetherdub_subtitle_instance = instance;
  activeSubtitleInstance = instance;

  // Read initial subtitle settings from storage (for properties not explicitly provided)
  getSettings()
    .then((settings) => {
      if (!mounted) return;
      currentSettings = { ...settings };
      if (settings.subtitlePosition) {
        applyPosition(settings.subtitlePosition);
      }
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
      if (!explicitlySet.has('originalFontSize') && !explicitlySet.has('fontSizeScale')) {
        if (settings.subtitleFontSize === 'standard' || settings.subtitleOriginalFontSize !== DEFAULT_USER_SETTINGS.subtitleOriginalFontSize) {
          toApply.originalFontSize = settings.subtitleOriginalFontSize;
        }
      }
      if (!explicitlySet.has('translatedFontSize') && !explicitlySet.has('fontSizeScale')) {
        if (settings.subtitleFontSize === 'standard' || settings.subtitleTranslatedFontSize !== DEFAULT_USER_SETTINGS.subtitleTranslatedFontSize) {
          toApply.translatedFontSize = settings.subtitleTranslatedFontSize;
        }
      }
      if (!explicitlySet.has('originalColor')) {
        toApply.originalColor = settings.subtitleOriginalColor;
      }
      if (!explicitlySet.has('translatedColor')) {
        toApply.translatedColor = settings.subtitleTranslatedColor;
      }
      if (!explicitlySet.has('backgroundOpacity')) {
        toApply.backgroundOpacity = settings.subtitleBackgroundOpacity;
      }
      if (!explicitlySet.has('textShadowEnabled')) {
        toApply.textShadowEnabled = settings.subtitleTextShadow;
      }
      if (!explicitlySet.has('autoPauseEnabled')) {
        toApply.autoPauseEnabled = settings.subtitleAutoPause;
      }
      if (!explicitlySet.has('hotkeysEnabled')) {
        toApply.hotkeysEnabled = settings.subtitleHotkeysEnabled;
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
    currentSettings = { ...currentSettings, ...settings };
    if ('subtitlePosition' in settings) {
      applyPosition(settings.subtitlePosition ?? null);
    }
    const updatedProps: Partial<SubtitleMountProps> = {
      displayMode: settings.subtitleDisplayMode,
      lineOrder: settings.subtitleLineOrder,
      fontSizeScale: settings.subtitleFontSize,
      originalColor: settings.subtitleOriginalColor,
      translatedColor: settings.subtitleTranslatedColor,
      backgroundOpacity: settings.subtitleBackgroundOpacity,
      textShadowEnabled: settings.subtitleTextShadow,
      autoPauseEnabled: settings.subtitleAutoPause,
      hotkeysEnabled: settings.subtitleHotkeysEnabled,
    };
    if (settings.subtitleFontSize === 'standard' || settings.subtitleOriginalFontSize !== DEFAULT_USER_SETTINGS.subtitleOriginalFontSize) {
      updatedProps.originalFontSize = settings.subtitleOriginalFontSize;
    }
    if (settings.subtitleFontSize === 'standard' || settings.subtitleTranslatedFontSize !== DEFAULT_USER_SETTINGS.subtitleTranslatedFontSize) {
      updatedProps.translatedFontSize = settings.subtitleTranslatedFontSize;
    }
    getActiveSubtitleInstance()?.updateProps(updatedProps);
  });

  // Listen for settings updates via chrome.storage.onChanged
  if (typeof chrome !== 'undefined' && (chrome?.storage as any)?.onChanged?.addListener) {
    storageListener = (changes: Record<string, any>, areaName: string) => {
      if (areaName === 'local' && changes.userSettings?.newValue && mounted) {
        const updated = normalizeSettings(changes.userSettings.newValue);
        currentSettings = { ...updated };
        if ('subtitlePosition' in updated) {
          applyPosition(updated.subtitlePosition ?? null);
        }
        const updatedProps: Partial<SubtitleMountProps> = {
          displayMode: updated.subtitleDisplayMode,
          lineOrder: updated.subtitleLineOrder,
          fontSizeScale: updated.subtitleFontSize,
          originalColor: updated.subtitleOriginalColor,
          translatedColor: updated.subtitleTranslatedColor,
          backgroundOpacity: updated.subtitleBackgroundOpacity,
          textShadowEnabled: updated.subtitleTextShadow,
          autoPauseEnabled: updated.subtitleAutoPause,
          hotkeysEnabled: updated.subtitleHotkeysEnabled,
        };
        if (updated.subtitleFontSize === 'standard' || updated.subtitleOriginalFontSize !== DEFAULT_USER_SETTINGS.subtitleOriginalFontSize) {
          updatedProps.originalFontSize = updated.subtitleOriginalFontSize;
        }
        if (updated.subtitleFontSize === 'standard' || updated.subtitleTranslatedFontSize !== DEFAULT_USER_SETTINGS.subtitleTranslatedFontSize) {
          updatedProps.translatedFontSize = updated.subtitleTranslatedFontSize;
        }
        getActiveSubtitleInstance()?.updateProps(updatedProps);
      }
    };
    (chrome.storage as any).onChanged.addListener(storageListener);
  }

  return instance;
}
