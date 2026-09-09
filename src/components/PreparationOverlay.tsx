import React, { useEffect } from 'react';

export type PreparationOverlayMode = 'preparing' | 'autoplay-blocked';

export interface PreparationOverlayProps {
  /** Controlled display mode */
  mode: PreparationOverlayMode;
  /** Called when the user clicks [CANCEL] or presses Escape */
  onCancel: () => void;
  /** Called when the user clicks the "CLICK TO RESUME" button (autoplay-blocked mode) */
  onResume?: () => void;
}

/**
 * PreparationOverlay
 *
 * A full-player centered overlay shown when the dubbing pipeline is preparing
 * (capturing, translating, synthesizing initial TTS lookahead) after the user
 * has activated dubbing on an uncached video.
 *
 * Per ADR-0008: blocks accidental video clicks, provides accessible [CANCEL] and
 * Escape to abort, and transitions to autoplay-blocked mode when video.play()
 * is rejected by Chrome's Autoplay Policy after asynchronous network calls.
 */
export const PreparationOverlay: React.FC<PreparationOverlayProps> = ({
  mode,
  onCancel,
  onResume,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="preparation-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'autoplay-blocked'
          ? 'Dubbing ready — click to resume'
          : 'AetherDub — synthesizing dub track'
      }
      data-testid="preparation-overlay"
    >
      <div className="preparation-glass">
        {mode === 'preparing' ? (
          <>
            <div className="preparation-spinner" aria-hidden="true" />
            <div className="preparation-status">
              <span className="preparation-label">AETHERDUB</span>
              <span className="preparation-separator">//</span>
              <span className="preparation-message">SYNTHESIZING DUB TRACK...</span>
            </div>
            <button
              type="button"
              className="preparation-cancel-btn"
              onClick={onCancel}
              aria-label="Cancel dubbing preparation"
              data-testid="preparation-cancel"
            >
              [ CANCEL ]
            </button>
          </>
        ) : (
          <>
            <div className="preparation-ready-icon" aria-hidden="true">▶</div>
            <div className="preparation-status">
              <span className="preparation-message">DUBBING READY</span>
            </div>
            <button
              type="button"
              className="preparation-resume-btn"
              onClick={onResume}
              aria-label="Click to resume video with dubbing"
              data-testid="preparation-resume"
            >
              CLICK TO RESUME
            </button>
            <button
              type="button"
              className="preparation-cancel-btn preparation-cancel-sm"
              onClick={onCancel}
              aria-label="Cancel dubbing"
              data-testid="preparation-cancel-autoplay"
            >
              [ CANCEL ]
            </button>
          </>
        )}
      </div>
    </div>
  );
};
