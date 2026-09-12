import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { HudContainer, type HudContainerProps } from '@/components/HudContainer';
import { HUD_STYLES } from '@/styles/hud.styles';
import type { DubbingOrchestrator } from '@/types/domain';
import { getSettings, saveSettings } from '@/storage/settings';
import {
  activateDubbing,
  deactivateDubbing,
  activateSubOnly,
  stopSubOnlyPipeline,
  type ActivationHudCallbacks,
} from './orchestrator-coordinator';
import { getActiveSubtitleInstance } from './subtitle-mount';
import { openCommandCenter } from './command-center-mount';

export interface HudInstance {
  unmount: () => void;
  isMounted: () => boolean;
  shadowRoot: ShadowRoot;
  updateOrchestrator?: (orchestrator: DubbingOrchestrator | undefined) => void;
  updateProps?: (props: Partial<HudContainerProps>) => void;
}

export function mountHud(
  container: HTMLElement,
  orchestrator?: DubbingOrchestrator,
  initialProps?: Partial<HudContainerProps>
): HudInstance {
  // Check if an existing host is already attached
  const existingHost = container.querySelector('[data-aetherdub-host]') as HTMLElement | null;
  if (existingHost) {
    if ((existingHost as any).__aetherdub_instance) {
      return (existingHost as any).__aetherdub_instance;
    }
    // Remove stale detached or uninitialized host element to prevent duplicates
    existingHost.remove();
  }

  // Create custom host element
  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-aetherdub-host', 'true');
  hostEl.style.display = 'inline-flex';
  hostEl.style.alignItems = 'center';
  hostEl.style.verticalAlign = 'middle';

  // Attach isolated Shadow DOM root
  const shadowRoot = hostEl.attachShadow({ mode: 'open' });

  // Inject scoped stylesheet directly into shadow root
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-aetherdub-style', 'true');
  styleEl.textContent = HUD_STYLES;
  shadowRoot.appendChild(styleEl);

  // Mount point for React inside Shadow DOM
  const mountPoint = document.createElement('div');
  mountPoint.className = 'aetherdub-mount-root';
  shadowRoot.appendChild(mountPoint);

  let mounted = true;
  let currentOrchestrator = orchestrator;
  let currentProps: Partial<HudContainerProps> = { ...initialProps };

  // AbortController for the current activation attempt
  let activationController: AbortController | null = null;

  // Resolve video element lazily so mount doesn't require it at construction
  const resolveVideo = (): HTMLVideoElement | null =>
    (document.querySelector('video.html5-main-video') as HTMLVideoElement | null) ||
    (document.querySelector('video') as HTMLVideoElement | null);

  const hudCallbacks: ActivationHudCallbacks = {
    setPreparationMode: (mode) => {
      currentProps = {
        ...currentProps,
        isPreparing: mode === 'preparing',
        preparationMode: mode,
      };
      renderComponent();
    },
    setEnabled: (enabled) => {
      currentProps = { ...currentProps, isEnabled: enabled };
      renderComponent();
    },
    setError: (msg) => {
      if (msg) {
        // Show error via the isNoCaptions/hasCaptions flag which activates the NotificationBanner
        currentProps = { ...currentProps, hasCaptions: false, isNoCaptions: true };
        renderComponent();
      }
    },
  };

  // AbortController for the current sub-only activation attempt
  let subOnlyController: AbortController | null = null;

  const handleActivateDubbing = (targetLanguage: string) => {
    // Turning dubbing on cancels any running sub-only pipeline
    subOnlyController?.abort();
    subOnlyController = null;
    stopSubOnlyPipeline();

    const video = resolveVideo();
    if (!video) return;

    currentProps = { ...currentProps, targetLanguage, isEnabled: true };
    // Cancel any in-flight activation
    activationController?.abort();
    activationController = new AbortController();
    const signal = activationController.signal;

    activateDubbing(
      video,
      instance,
      hudCallbacks,
      signal,
      undefined,
      undefined,
      targetLanguage,
    ).catch((err) => {
      console.error('[AetherDub] activateDubbing threw unexpectedly:', err);
    });
  };

  const handleTargetLanguageChange = (languageCode: string) => {
    currentProps = { ...currentProps, targetLanguage: languageCode };
    saveSettings({ targetLanguage: languageCode }).catch(() => {});
  };

  const handleDeactivateDubbing = () => {
    const abortFn = activationController
      ? () => activationController!.abort()
      : undefined;
    activationController = null;
    deactivateDubbing(hudCallbacks, abortFn);
    getActiveSubtitleInstance()?.setVisible(false);
    getActiveSubtitleInstance()?.setSegment(null);
  };

  const handleToggleSubtitles = (enabled: boolean) => {
    currentProps = { ...currentProps, isSubtitlesEnabled: enabled };
    const isDubbingActive = Boolean(
      currentProps.isEnabled || currentProps.isPreparing || currentOrchestrator
    );

    if (enabled) {
      if (!isDubbingActive) {
        const video = resolveVideo();
        if (video) {
          subOnlyController?.abort();
          subOnlyController = new AbortController();
          const targetLang = currentProps.targetLanguage || 'vi';
          activateSubOnly(
            video,
            instance,
            hudCallbacks,
            subOnlyController.signal,
            undefined,
            targetLang,
          ).catch((err) => {
            console.error('[AetherDub] activateSubOnly threw unexpectedly:', err);
          });
        }
      } else {
        getActiveSubtitleInstance()?.setVisible(true);
      }
    } else {
      subOnlyController?.abort();
      subOnlyController = null;
      if (!isDubbingActive) {
        stopSubOnlyPipeline();
      } else {
        getActiveSubtitleInstance()?.setVisible(false);
      }
    }
    renderComponent();
  };

  const handleResumePlayback = () => {
    const video = resolveVideo();
    video?.play().catch(() => {});
    hudCallbacks.setPreparationMode(null);
  };

  const renderComponent = () => {
    if (mounted && root) {
      root.render(
        <HudContainer
          orchestrator={currentOrchestrator}
          {...currentProps}
          onOpenCommandCenter={openCommandCenter}
          onActivateDubbing={handleActivateDubbing}
          onTargetLanguageChange={handleTargetLanguageChange}
          onDeactivateDubbing={handleDeactivateDubbing}
          onCancelPreparation={handleDeactivateDubbing}
          onResumePlayback={handleResumePlayback}
          onToggleSubtitles={handleToggleSubtitles}
        />
      );
    }
  };

  let root: Root | null = createRoot(mountPoint);
  renderComponent();

  // Mount at start of container
  if (container.firstChild) {
    container.insertBefore(hostEl, container.firstChild);
  } else {
    container.appendChild(hostEl);
  }

  const instance: HudInstance = {
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      activationController?.abort();
      activationController = null;
      subOnlyController?.abort();
      subOnlyController = null;
      stopSubOnlyPipeline();
      if (root) {
        root.unmount();
        root = null;
      }
      if (hostEl.parentNode) {
        hostEl.parentNode.removeChild(hostEl);
      }
    },
    isMounted: () => mounted && (hostEl.isConnected ?? true),
    shadowRoot,
    updateOrchestrator: (newOrch?: DubbingOrchestrator) => {
      currentOrchestrator = newOrch;
      renderComponent();
    },
    updateProps: (newProps: Partial<HudContainerProps>) => {
      currentProps = { ...currentProps, ...newProps };
      renderComponent();
    },
  };

  (hostEl as any).__aetherdub_instance = instance;

  getSettings()
    .then((settings) => {
      if (!mounted) return;
      if (settings.targetLanguage && !currentProps.targetLanguage) {
        instance.updateProps?.({ targetLanguage: settings.targetLanguage });
      }
    })
    .catch(() => {});

  return instance;
}
