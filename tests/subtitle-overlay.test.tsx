import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SubtitleOverlay } from '@/components/SubtitleOverlay';
import type { Segment } from '@/types/domain';

describe('SubtitleOverlay', () => {
  const sampleSegment: Segment = {
    id: 'seg-1',
    startTime: 10,
    endTime: 14,
    duration: 4,
    sourceText: 'Hello world, welcome to our channel!',
    translatedText: 'Xin chào thế giới, chào mừng đến với kênh!',
  };

  it('renders translated text with rgba(8, 8, 8, 0.84) background and crisp white text', () => {
    const { container } = render(<SubtitleOverlay segment={sampleSegment} visible={true} />);

    const pill = container.querySelector('.subtitle-pill') as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('Xin chào thế giới, chào mừng đến với kênh!');

    // Check YouTube CC styling requirements per ADR-0005/0006
    expect(pill.style.background).toBe('rgba(8, 8, 8, 0.84)');
    expect(pill.style.color).toBe('rgb(255, 255, 255)');
  });

  it('displays secondary original text line when showOriginalText is true', () => {
    render(<SubtitleOverlay segment={sampleSegment} showOriginalText={true} />);

    const translatedEl = screen.getByText('Xin chào thế giới, chào mừng đến với kênh!');
    expect(translatedEl).toBeInTheDocument();

    const originalEl = screen.getByText('Hello world, welcome to our channel!');
    expect(originalEl).toBeInTheDocument();
    expect(originalEl.classList.contains('subtitle-original')).toBe(true);
  });

  it('hides secondary original text line when showOriginalText is false', () => {
    render(<SubtitleOverlay segment={sampleSegment} showOriginalText={false} />);

    expect(screen.getByText('Xin chào thế giới, chào mừng đến với kênh!')).toBeInTheDocument();
    expect(screen.queryByText('Hello world, welcome to our channel!')).toBeNull();
  });

  it('renders nothing when segment is null', () => {
    const { container } = render(<SubtitleOverlay segment={null} visible={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when visible is false', () => {
    const { container } = render(<SubtitleOverlay segment={sampleSegment} visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when segment has no translatedText', () => {
    const segmentWithoutTranslation: Segment = {
      ...sampleSegment,
      translatedText: '',
    };
    const { container } = render(<SubtitleOverlay segment={segmentWithoutTranslation} />);
    expect(container.firstChild).toBeNull();
  });
});
