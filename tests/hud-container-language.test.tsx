import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { HudContainer } from '@/components/HudContainer';

describe('HudContainer target language wiring', () => {
  it('passes the cockpit target language into onActivateDubbing', () => {
    const onActivateDubbing = vi.fn();
    render(
      <HudContainer
        initialIsOpen={true}
        initialTargetLanguage="ja"
        onActivateDubbing={onActivateDubbing}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: /select target language|target language/i }), {
      target: { value: 'es' },
    });
    fireEvent.click(screen.getByTestId('pill-dub-toggle'));

    expect(onActivateDubbing).toHaveBeenCalledWith('es');
  });

  it('notifies onTargetLanguageChange when the cockpit language changes', () => {
    const onTargetLanguageChange = vi.fn();
    render(
      <HudContainer
        initialIsOpen={true}
        initialTargetLanguage="vi"
        onTargetLanguageChange={onTargetLanguageChange}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: /select target language|target language/i }), {
      target: { value: 'en' },
    });
    expect(onTargetLanguageChange).toHaveBeenCalledWith('en');
  });
});
