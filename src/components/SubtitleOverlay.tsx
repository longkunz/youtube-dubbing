import React from 'react';
import type { Segment } from '../types/domain';

export interface SubtitleOverlayProps {
  segment?: Segment | null;
  activeSegment?: Segment | null;
  visible?: boolean;
  showOriginalText?: boolean;
  className?: string;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  segment,
  activeSegment,
  visible = true,
  showOriginalText = true,
  className = '',
}) => {
  const currentSegment = segment ?? activeSegment ?? null;

  if (
    !visible ||
    !currentSegment ||
    !currentSegment.translatedText ||
    currentSegment.translatedText.trim() === ''
  ) {
    return null;
  }

  return (
    <div className={`subtitle-overlay ${className}`.trim()} role="region" aria-label="Subtitle Overlay">
      <div
        className="subtitle-pill"
        style={{
          background: 'rgba(8, 8, 8, 0.84)',
          color: '#ffffff',
        }}
      >
        <div className="subtitle-translated">{currentSegment.translatedText}</div>
        {showOriginalText && currentSegment.sourceText && (
          <div
            className="subtitle-original"
            style={{
              color: 'rgba(255, 255, 255, 0.75)',
            }}
          >
            {currentSegment.sourceText}
          </div>
        )}
      </div>
    </div>
  );
};
