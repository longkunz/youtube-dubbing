import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { InPageCommandCenter, type InPageCommandCenterProps } from '@/components/InPageCommandCenter';
import { COMMAND_CENTER_STYLES } from '@/styles/command-center.styles';
import type { SegmentCache } from '@/storage/segment-cache';

export interface CommandCenterMountOptions {
  container?: HTMLElement;
  segmentCache?: SegmentCache;
  onClose?: () => void;
  onOpenInTab?: () => void;
  initialIsOpen?: boolean;
}

export interface CommandCenterInstance {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  unmount: () => void;
  hostElement: HTMLElement;
  shadowRoot: ShadowRoot;
}

let activeInstance: CommandCenterInstance | null = null;

export function mountCommandCenter(options?: CommandCenterMountOptions): CommandCenterInstance {
  // If an active instance already exists and host is connected, return it
  if (activeInstance && (activeInstance.hostElement.isConnected ?? true)) {
    return activeInstance;
  }

  // Check if an existing host element is in DOM
  const existingHost = document.querySelector('[data-aetherdub-command-center-host="true"]') as HTMLElement | null;
  if (existingHost) {
    if ((existingHost as any).__aetherdub_command_center) {
      activeInstance = (existingHost as any).__aetherdub_command_center;
      return activeInstance!;
    }
    existingHost.remove();
  }

  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-aetherdub-command-center-host', 'true');
  hostEl.style.display = 'block';
  hostEl.style.position = 'relative';

  const shadowRoot = hostEl.attachShadow({ mode: 'open' });

  // Inject scoped sci-fi stylesheet
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-aetherdub-command-center-style', 'true');
  styleEl.textContent = COMMAND_CENTER_STYLES;
  shadowRoot.appendChild(styleEl);

  // Mount point for React inside Shadow DOM
  const mountPoint = document.createElement('div');
  mountPoint.className = 'aetherdub-command-center-mount-root';
  shadowRoot.appendChild(mountPoint);

  let isDrawerOpen = options?.initialIsOpen ?? false;
  let root: Root | null = createRoot(mountPoint);

  const resolveParent = (): HTMLElement => {
    if (options?.container) return options.container;
    return (document.fullscreenElement as HTMLElement) || document.body;
  };

  const renderComponent = () => {
    if (!root) return;
    root.render(
      <InPageCommandCenter
        isOpen={isDrawerOpen}
        onClose={() => {
          isDrawerOpen = false;
          renderComponent();
          options?.onClose?.();
        }}
        onOpenInTab={options?.onOpenInTab}
        hostElement={hostEl}
        segmentCache={options?.segmentCache}
      />
    );
  };

  const parent = resolveParent();
  parent.appendChild(hostEl);
  renderComponent();

  const instance: CommandCenterInstance = {
    open: () => {
      const currentParent = resolveParent();
      if (hostEl.parentElement !== currentParent) {
        currentParent.appendChild(hostEl);
      }
      isDrawerOpen = true;
      renderComponent();
    },
    close: () => {
      isDrawerOpen = false;
      renderComponent();
      options?.onClose?.();
    },
    toggle: () => {
      if (isDrawerOpen) {
        instance.close();
      } else {
        instance.open();
      }
    },
    isOpen: () => isDrawerOpen,
    unmount: () => {
      isDrawerOpen = false;
      if (root) {
        root.unmount();
        root = null;
      }
      if (hostEl.parentNode) {
        hostEl.parentNode.removeChild(hostEl);
      }
      if (activeInstance === instance) {
        activeInstance = null;
      }
    },
    hostElement: hostEl,
    shadowRoot,
  };

  (hostEl as any).__aetherdub_command_center = instance;
  activeInstance = instance;
  return instance;
}

export function openCommandCenter(): void {
  const instance = activeInstance || mountCommandCenter();
  instance.open();
}

export function closeCommandCenter(): void {
  activeInstance?.close();
}

export function toggleCommandCenter(): void {
  const instance = activeInstance || mountCommandCenter();
  instance.toggle();
}

export function isCommandCenterOpen(): boolean {
  return activeInstance ? activeInstance.isOpen() : false;
}

export function getCommandCenterInstance(): CommandCenterInstance | null {
  return activeInstance;
}

export function resetCommandCenterForTesting(): void {
  if (activeInstance) {
    activeInstance.unmount();
    activeInstance = null;
  }
  const leftover = document.querySelectorAll('[data-aetherdub-command-center-host="true"]');
  leftover.forEach((el) => el.remove());
}
