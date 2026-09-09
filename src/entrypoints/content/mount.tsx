import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { HudContainer, type HudContainerProps } from '@/components/HudContainer';
import { HUD_STYLES } from '@/styles/hud.styles';
import type { DubbingOrchestrator } from '@/types/domain';

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

  const renderComponent = () => {
    if (mounted && root) {
      root.render(<HudContainer orchestrator={currentOrchestrator} {...currentProps} />);
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

  return instance;
}
