import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { HudContainer } from '@/components/HudContainer';

describe('HudContainer target language wiring', () => {
  it('passes the locked Vietnamese target language into onActivateDubbing', () => {
    const onActivateDubbing = vi.fn();
    render(
      <HudContainer
        initialIsOpen={true}
        initialTargetLanguage="vi"
        onActivateDubbing={onActivateDubbing}
      />,
    );

    fireEvent.click(screen.getByTestId('pill-dub-toggle'));

    expect(onActivateDubbing).toHaveBeenCalledWith('vi');
  });

  it('displays the locked Vietnamese target language in the cockpit', () => {
    const onTargetLanguageChange = vi.fn();
    render(
      <HudContainer
        initialIsOpen={true}
        initialTargetLanguage="vi"
        onTargetLanguageChange={onTargetLanguageChange}
      />,
    );

    const select = screen.getByRole('combobox', { name: /select target language|target language/i });
    expect(select).toHaveValue('vi');
    expect(select).toBeDisabled();
  });
});
