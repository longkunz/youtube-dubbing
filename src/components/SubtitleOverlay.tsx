import React, { useState, useRef } from 'react';
import type { Segment } from '../types/domain';
import type {
  SubtitleDisplayMode,
  SubtitleLineOrder,
  SubtitleFontSize,
  SubtitlePosition,
} from '../storage/settings';

export type { SubtitleDisplayMode, SubtitleLineOrder, SubtitleFontSize, SubtitlePosition };

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
  onPositionChange?: (pos: SubtitlePosition) => void;
  onResetPosition?: () => void;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  segment,
  activeSegment,
  visible = true,
  showOriginalText = true,
  displayMode = 'bilingual',
  lineOrder = 'original-first',
  fontSizeScale = 'standard',
  isControlsVisible,
  className = '',
  onPositionChange,
  onResetPosition,
}) => {
  const currentSegment = segment ?? activeSegment ?? null;
  const [isDragging, setIsDragging] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    pillRect: DOMRect;
    containerRect: DOMRect;
    moved: boolean;
  } | null>(null);

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
    fontSizeScale === 'small' ? '12px' : fontSizeScale === 'large' ? '18px' : '15px';

  const isBilingual = shouldShowTranslated && shouldShowOriginal;
  const originalIsPrimary = !isBilingual || lineOrder === 'original-first';

  const renderTranslated = () => (
    <div
      key="translated"
      className="subtitle-translated"
      style={{
        fontSize: originalIsPrimary && isBilingual ? secondaryFontSizePx : fontSizePx,
        fontWeight: originalIsPrimary && isBilingual ? 500 : 600,
        color: '#00f2fe',
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
        letterSpacing: '0.01em',
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
        fontSize: originalIsPrimary ? fontSizePx : secondaryFontSizePx,
        fontWeight: originalIsPrimary ? 600 : 500,
        color: '#ffffff',
        textShadow: '0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8)',
        letterSpacing: '0.01em',
        lineHeight: 1.35,
      }}
    >
      {currentSegment.sourceText}
    </div>
  );

  const elements = [];
  if (isBilingual) {
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

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const selection = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
    if (selection && selection.length > 0) {
      return;
    }

    const pillEl = pillRef.current;
    if (!pillEl) return;

    const pillRect = pillEl.getBoundingClientRect();
    let container: HTMLElement | null = null;
    const rootNode = pillEl.getRootNode();
    if (rootNode instanceof ShadowRoot && rootNode.host) {
      container = rootNode.host.parentElement;
    }
    if (!container) {
      container = (pillEl.closest('#movie_player') as HTMLElement) || pillEl.parentElement;
    }
    const containerRect = container ? container.getBoundingClientRect() : document.body.getBoundingClientRect();

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      pillRect,
      containerRect,
      moved: false,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.stopPropagation();
      if (!dragStartRef.current) return;

      const deltaX = moveEvent.clientX - dragStartRef.current.startX;
      const deltaY = moveEvent.clientY - dragStartRef.current.startY;

      if (!dragStartRef.current.moved && Math.hypot(deltaX, deltaY) > 3) {
        dragStartRef.current.moved = true;
        setIsDragging(true);
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      upEvent.stopPropagation();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      if (dragStartRef.current && dragStartRef.current.moved) {
        const { pillRect, containerRect } = dragStartRef.current;
        const containerWidth = containerRect.width || 1000;
        const containerHeight = containerRect.height || 600;
        const containerLeft = containerRect.left || 0;
        const containerTop = containerRect.top || 0;

        const deltaX = upEvent.clientX - dragStartRef.current.startX;
        const deltaY = upEvent.clientY - dragStartRef.current.startY;
        const initialCenterX = pillRect.left + pillRect.width / 2;
        const initialCenterY = pillRect.top + pillRect.height / 2;
        const newCenterX = initialCenterX + deltaX;
        const newCenterY = initialCenterY + deltaY;

        let xPercent = ((newCenterX - containerLeft) / containerWidth) * 100;
        let yPercent = ((newCenterY - containerTop) / containerHeight) * 100;

        xPercent = Math.min(98, Math.max(2, Math.round(xPercent * 10) / 10));
        yPercent = Math.min(98, Math.max(2, Math.round(yPercent * 10) / 10));

        onPositionChange?.({ xPercent, yPercent });
      }

      dragStartRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onResetPosition?.();
  };

  return (
    <div
      className={`subtitle-overlay ${className}`.trim()}
      role="region"
      aria-label="Subtitle Overlay"
      data-controls-visible={isControlsVisible ? 'true' : 'false'}
    >
      <div
        ref={pillRef}
        className={`subtitle-pill ${isDragging ? 'is-dragging dragging' : ''}`.trim()}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(0, 0, 0, 0.78)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          color: '#ffffff',
          borderRadius: '6px',
          padding: '6px 14px',
          textAlign: 'center',
          fontFamily: 'Roboto, "YouTube Noto", "Segoe UI", Arial, sans-serif',
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          maxWidth: '90vw',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
          wordBreak: 'break-word',
          userSelect: 'text',
          cursor: isDragging ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
        }}
      >
        {elements}
      </div>
    </div>
  );
};
