import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { NotificationBanner } from '../src/components/NotificationBanner';

describe('NotificationBanner UX Copy', () => {
  it('renders clean backend-only default message without Groq or Whisper mentions', () => {
    render(<NotificationBanner />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(
      'No captions available for this video. Enable YouTube CC or check video source.'
    );
    expect(banner.textContent).not.toMatch(/groq/i);
    expect(banner.textContent).not.toMatch(/whisper/i);
  });
});
