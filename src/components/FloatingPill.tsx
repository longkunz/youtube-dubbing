import React from 'react';

export interface FloatingPillProps {
  /** Whether the Cyber Cockpit settings panel is open */
  isOpen: boolean;
  /** Whether the Dub Track is enabled (ON/OFF state) */
  isEnabled: boolean;
  /** Whether the pipeline is currently preparing (show loading state) */
  isPreparing?: boolean;
  /** Called when user clicks the primary (dub toggle) area — toggles dubbing ON/OFF */
  onToggleDubbing: () => void;
  /** Called when user clicks the secondary (⚙) area — toggles Cyber Cockpit open/close */
  onToggleCockpit: () => void;
}

/**
 * Split Pill Control — dual-action toolbar button per ADR-0008.
 *
 * Primary hit area  → toggles Dub Track ON/OFF (calls onToggleDubbing)
 * Secondary hit area → expands/collapses Cyber Cockpit (calls onToggleCockpit)
 * Outer pill click   → defaults to expanding Cyber Cockpit for backward compatibility
 *
 * Badge shows: NEURAL DUB [DUB: OFF | SYNTHESIZING... | DUB: ON]
 */
export const FloatingPill: React.FC<FloatingPillProps> = ({
  isOpen,
  isEnabled,
  isPreparing = false,
  onToggleDubbing,
  onToggleCockpit,
}) => {
  const label = isPreparing ? 'SYNTHESIZING...' : isEnabled ? 'DUB: ON' : 'DUB: OFF';
  const labelClass = isPreparing
    ? 'pill-label pill-label--preparing'
    : isEnabled
      ? 'pill-label pill-label--on'
      : 'pill-label pill-label--off';

  const handleContainerClick = () => {
    onToggleCockpit();
  };

  return (
    <div
      className={`hyper-pill-trigger ${isOpen ? 'active' : ''} ${isEnabled ? 'enabled' : ''}`}
      role="group"
      aria-label="AetherDub split pill control"
      onClick={handleContainerClick}
    >
      {/* Primary hit area — toggles Dub Track ON/OFF */}
      <button
        type="button"
        className="pill-primary"
        onClick={(e) => {
          e.stopPropagation();
          onToggleDubbing();
        }}
        aria-label={isEnabled ? 'Turn dubbing off' : 'Turn dubbing on'}
        aria-pressed={isEnabled}
        disabled={isPreparing}
        data-testid="pill-dub-toggle"
      >
        <span className="pill-icon" aria-hidden="true">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </span>
        <span className="pill-label pill-brand">NEURAL DUB</span>
        <span className={labelClass}>{label}</span>
        {isEnabled && !isPreparing && <span className="pill-live-beacon" aria-hidden="true" />}
      </button>

      {/* Divider */}
      <span className="pill-divider" aria-hidden="true" />

      {/* Secondary hit area — toggles Cyber Cockpit */}
      <button
        type="button"
        className="pill-expander"
        onClick={(e) => {
          e.stopPropagation();
          onToggleCockpit();
        }}
        aria-label={isOpen ? 'Close settings' : 'Open settings'}
        aria-expanded={isOpen}
        data-testid="pill-cockpit-toggle"
      >
        <span aria-hidden="true">⚙</span>
      </button>
    </div>
  );
};
