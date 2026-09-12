import React from 'react';
import type { Segment } from '../types/domain';
import type {
  SubtitleDisplayMode,
  SubtitleLineOrder,
  SubtitleFontSize,
} from '../storage/settings';

export type { SubtitleDisplayMode, SubtitleLineOrder, SubtitleFontSize };

export interface SubtitleOverlayProps {
  segment?: Segment | null;
  activeSegment?: Segment | null;
  visible?: boolean;
  showOriginalText?: boolean;
  displayMode?: SubtitleDisplayMode;
  lineOrder?: SubtitleLineOrder;
  fontSizeScale?: SubtitleFontSize;
  isControlsVisible?: boolean;
  className?: string;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  segment,
  activeSegment,
  visible = true,
  showOriginalText = true,
  displayMode = 'bilingual',
  lineOrder = 'translated-first',
  fontSizeScale = 'standard',
  isControlsVisible,
  className = '',
}) => {
  const currentSegment = segment ?? activeSegment ?? null;

  if (!visible || !currentSegment) {
    return null;
  }

  const hasTranslated = Boolean(currentSegment.translatedText && currentSegment.translatedText.trim() !== '');
  const hasSource = Boolean(currentSegment.sourceText && currentSegment.sourceText.trim() !== '');

  const shouldShowTranslated =
    displayMode !== 'original-only' && hasTranslated;
  const shouldShowOriginal =
    showOriginalText &&
    displayMode !== 'translated-only' &&
    hasSource;

  // If display mode is original-only, we require source text.
  // Otherwise, we require translated text per canonical CC requirements.
  if (displayMode === 'original-only') {
    if (!shouldShowOriginal) return null;
  } else {
    if (!shouldShowTranslated) return null;
  }

  const fontSizePx =
    fontSizeScale === 'small' ? '14px' : fontSizeScale === 'large' ? '22px' : '18px';
  const secondaryFontSizePx =
    fontSizeScale === 'small' ? '12px' : fontSizeScale === 'large' ? '17px' : '14px';

  const renderTranslated = () => (
    <div
      key="translated"
      className="subtitle-translated"
      style={{
        fontSize: fontSizePx,
        fontWeight: 600,
        lineHeight: 1.35,
      }}
    >
      {currentSegment.translatedText}
    </div>
  );

  const renderOriginal = () => (
    <div
      key="original"
      className="subtitle-original"
      style={{
        fontSize: secondaryFontSizePx,
        color: 'rgba(255, 255, 255, 0.75)',
        lineHeight: 1.35,
      }}
    >
      {currentSegment.sourceText}
    </div>
  );

  const elements = [];
  if (shouldShowTranslated && shouldShowOriginal) {
    if (lineOrder === 'original-first') {
      elements.push(renderOriginal(), renderTranslated());
    } else {
      elements.push(renderTranslated(), renderOriginal());
    }
  } else if (shouldShowTranslated) {
    elements.push(renderTranslated());
  } else if (shouldShowOriginal) {
    elements.push(renderOriginal());
  }

  return (
    <div
      className={`subtitle-overlay ${className}`.trim()}
      role="region"
      aria-label="Subtitle Overlay"
      data-controls-visible={isControlsVisible ? 'true' : 'false'}
    >
      <div
        className="subtitle-pill"
        style={{
          background: 'rgba(8, 8, 8, 0.84)',
          color: '#ffffff',
          borderRadius: '4px',
          padding: '6px 12px',
          textAlign: 'center',
          fontFamily: 'Roboto, "YouTube Noto", "Segoe UI", Arial, sans-serif',
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          maxWidth: '90vw',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
          wordBreak: 'break-word',
        }}
      >
        {elements}
      </div>
    </div>
  );
};
