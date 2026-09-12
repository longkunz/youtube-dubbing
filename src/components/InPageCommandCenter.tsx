import React, { useEffect, useRef } from 'react';
import { OptionsDashboard, type OptionsDashboardProps } from '@/entrypoints/options/OptionsDashboard';
import type { SegmentCache } from '@/storage/segment-cache';

export interface InPageCommandCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenInTab?: () => void;
  hostElement?: HTMLElement | null;
  segmentCache?: SegmentCache;
  pingFn?: OptionsDashboardProps['pingFn'];
  pingOpenAiFn?: OptionsDashboardProps['pingOpenAiFn'];
  pingBackendFn?: OptionsDashboardProps['pingBackendFn'];
  resetTtsBreaker?: OptionsDashboardProps['resetTtsBreaker'];
  ttsPreviewClient?: OptionsDashboardProps['ttsPreviewClient'];
  createPreviewAudio?: OptionsDashboardProps['createPreviewAudio'];
}

export const InPageCommandCenter: React.FC<InPageCommandCenterProps> = ({
  isOpen,
  onClose,
  onOpenInTab,
  hostElement,
  segmentCache,
  pingFn,
  pingOpenAiFn,
  pingBackendFn,
  resetTtsBreaker,
  ttsPreviewClient,
  createPreviewAudio,
}) => {
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Pause main YouTube video when drawer opens; keep paused when closed (ADR-0011)
  useEffect(() => {
    if (isOpen) {
      const video = (document.querySelector('video.html5-main-video') ||
        document.querySelector('video')) as HTMLVideoElement | null;
      if (video && typeof video.pause === 'function') {
        try {
          video.pause();
        } catch {
          // Safe catch
        }
      }
    }
  }, [isOpen]);

  // Handle dismissal: Escape key, outside clicks (with event trapping), and SPA navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    const handleDocumentClick = (e: MouseEvent) => {
      const drawer = drawerRef.current;
      if (!drawer) return;

      let isInside = false;
      if (typeof e.composedPath === 'function') {
        const path = e.composedPath();
        isInside = path.some((node) => node === drawer || node === hostElement);
      } else {
        const target = e.target as Node | null;
        if (target && (drawer.contains(target) || (hostElement && hostElement.contains(target)))) {
          isInside = true;
        }
      }

      if (!isInside) {
        // Stop event propagation on first click so underlying YouTube controls/elements are not triggered
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };

    const handleNavigateFinish = () => {
      onClose();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('yt-navigate-finish', handleNavigateFinish);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener('yt-navigate-finish', handleNavigateFinish);
    };
  }, [isOpen, onClose, hostElement]);

  const handleOpenInTab = () => {
    if (onOpenInTab) {
      onOpenInTab();
      return;
    }

    if (typeof chrome !== 'undefined' && chrome?.runtime?.openOptionsPage) {
      try {
        chrome.runtime.openOptionsPage();
      } catch {
        chrome?.runtime?.sendMessage?.({ action: 'OPEN_OPTIONS_PAGE' });
      }
    } else if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS_PAGE' });
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={drawerRef}
      className="command-center-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="AetherDub Command Center"
      data-testid="command-center-drawer"
    >
      {/* Header */}
      <div className="command-center-header">
        <div className="command-center-header-left">
          <div className="command-center-title-row">
            <span className="command-center-pulse-dot" />
            <span className="command-center-title" data-testid="command-center-title">
              AETHERDUB // COMMAND CENTER
            </span>
          </div>
        </div>

        <div className="command-center-header-right">
          <div
            className="command-center-autosave-badge"
            data-testid="autosave-badge"
            title="Changes are automatically persisted to extension storage"
          >
            <span className="command-center-autosave-dot" />
            <span>AUTO-SAVE ACTIVE</span>
          </div>

          <button
            type="button"
            className="command-center-open-tab-btn"
            onClick={handleOpenInTab}
            aria-label="Open in Tab"
            data-testid="command-center-open-tab-btn"
            title="Open Command Center in a dedicated tab"
          >
            ↗ Open in Tab
          </button>

          <button
            type="button"
            className="command-center-close-btn"
            onClick={onClose}
            aria-label="Close Command Center"
            data-testid="command-center-close-btn"
            title="Close Command Center"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body: Single vertical scrollable column with sci-fi scrollbar */}
      <div className="command-center-body" data-testid="command-center-body">
        <OptionsDashboard
          segmentCache={segmentCache}
          pingFn={pingFn}
          pingOpenAiFn={pingOpenAiFn}
          pingBackendFn={pingBackendFn}
          resetTtsBreaker={resetTtsBreaker}
          ttsPreviewClient={ttsPreviewClient}
          createPreviewAudio={createPreviewAudio}
        />
      </div>
    </div>
  );
};
