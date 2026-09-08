import React from 'react';

export interface FloatingPillProps {
  isOpen: boolean;
  onToggle: () => void;
  statusText?: string;
}

export const FloatingPill: React.FC<FloatingPillProps> = ({
  isOpen,
  onToggle,
  statusText = 'NEURAL DUB',
}) => {
  return (
    <button
      type="button"
      className={`hyper-pill-trigger ${isOpen ? 'active' : ''}`}
      onClick={onToggle}
      aria-label="Toggle Cyber Cockpit HUD"
    >
      <span className="pill-icon">
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
      <span className="pill-label">{statusText}</span>
      <span className="pill-live-beacon" />
    </button>
  );
};
