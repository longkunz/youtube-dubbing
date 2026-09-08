import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CyberCockpit } from '@/components/CyberCockpit';

describe('CyberCockpit', () => {
  it('toggles on/off switch state and invokes onToggleEnabled callback', () => {
    const onToggleEnabled = vi.fn();
    const { rerender } = render(
      <CyberCockpit
        isOpen={true}
        isEnabled={true}
        onToggleEnabled={onToggleEnabled}
        onClose={vi.fn()}
      />
    );

    const toggleSwitch = screen.getByRole('switch', { name: /toggle dub track/i });
    expect(toggleSwitch).toBeInTheDocument();
    expect(toggleSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggleSwitch);
    expect(onToggleEnabled).toHaveBeenCalledWith(false);

    // Rerender as disabled
    rerender(
      <CyberCockpit
        isOpen={true}
        isEnabled={false}
        onToggleEnabled={onToggleEnabled}
        onClose={vi.fn()}
      />
    );
    expect(toggleSwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggleSwitch);
    expect(onToggleEnabled).toHaveBeenCalledWith(true);
  });

  it('updates language and calls onSelectLanguage when selector changes', () => {
    const onSelectLanguage = vi.fn();
    render(
      <CyberCockpit
        isOpen={true}
        targetLanguage="vi"
        onSelectLanguage={onSelectLanguage}
        onClose={vi.fn()}
      />
    );

    const select = screen.getByRole('combobox', { name: /select target language|target language/i });
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('vi');

    fireEvent.change(select, { target: { value: 'en' } });
    expect(onSelectLanguage).toHaveBeenCalledWith('en');

    fireEvent.change(select, { target: { value: 'ja' } });
    expect(onSelectLanguage).toHaveBeenCalledWith('ja');
  });

  it('updates active voice and calls onSelectVoice on click or keyboard', () => {
    const onSelectVoice = vi.fn();
    render(
      <CyberCockpit
        isOpen={true}
        selectedVoiceId="vi-VN-HoaiMyNeural"
        onSelectVoice={onSelectVoice}
        onClose={vi.fn()}
      />
    );

    const namMinhCard = screen.getByText(/VOICE-02 \/\/ NAM MINH/i).closest('.voice-card') as HTMLElement;
    expect(namMinhCard).not.toBeNull();

    // Click selection
    fireEvent.click(namMinhCard);
    expect(onSelectVoice).toHaveBeenCalledWith('vi-VN-NamMinhNeural');

    // Keyboard selection (Enter)
    const hoaiMyCard = screen.getByText(/VOICE-01 \/\/ HOÀI MY/i).closest('.voice-card') as HTMLElement;
    expect(hoaiMyCard).not.toBeNull();
    fireEvent.keyDown(hoaiMyCard, { key: 'Enter' });
    expect(onSelectVoice).toHaveBeenCalledWith('vi-VN-HoaiMyNeural');

    // Keyboard selection (Space)
    fireEvent.keyDown(namMinhCard, { key: ' ' });
    expect(onSelectVoice).toHaveBeenCalledWith('vi-VN-NamMinhNeural');
  });

  it('updates ducking level and calls onDuckLevelChange when slider changes', () => {
    const onDuckLevelChange = vi.fn();
    render(
      <CyberCockpit
        isOpen={true}
        duckLevel={0.2}
        onDuckLevelChange={onDuckLevelChange}
        onClose={vi.fn()}
      />
    );

    const slider = screen.getByRole('slider', { name: /audio ducking level|ducking/i });
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveValue('20');

    // Check readout text
    expect(screen.getByText(/ORIGINAL AUDIO: 20% DUCKED/i)).toBeInTheDocument();

    // Change slider to 50%
    fireEvent.change(slider, { target: { value: '50' } });
    expect(onDuckLevelChange).toHaveBeenCalledWith(0.5);
  });

  it('shows active equalizer wave animation dynamically during speech playback', () => {
    const { rerender } = render(
      <CyberCockpit
        isOpen={true}
        isPlaying={true}
        isDucked={true}
        onClose={vi.fn()}
      />
    );

    const eqWave = screen.getByLabelText(/equalizer spectrum/i);
    expect(eqWave).toBeInTheDocument();
    expect(eqWave.classList.contains('active')).toBe(true);
    expect(eqWave.getAttribute('data-animating')).toBe('true');

    // When not playing
    rerender(
      <CyberCockpit
        isOpen={true}
        isPlaying={false}
        isDucked={true}
        onClose={vi.fn()}
      />
    );
    expect(eqWave.classList.contains('active')).toBe(false);
    expect(eqWave.getAttribute('data-animating')).toBe('false');

    // When playing but not ducked
    rerender(
      <CyberCockpit
        isOpen={true}
        isPlaying={true}
        isDucked={false}
        onClose={vi.fn()}
      />
    );
    expect(eqWave.classList.contains('active')).toBe(false);
    expect(eqWave.getAttribute('data-animating')).toBe('false');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<CyberCockpit isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByRole('button', { name: /close cockpit/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
