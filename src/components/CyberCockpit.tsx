import React, { useState } from 'react';

export interface CyberCockpitProps {
  isOpen: boolean;
  onClose: () => void;
  targetLanguage?: string;
  onSelectVoice?: (voiceId: string) => void;
}

export const CyberCockpit: React.FC<CyberCockpitProps> = ({
  isOpen,
  onClose,
  targetLanguage = 'Tiếng Việt [vi]',
  onSelectVoice,
}) => {
  const [selectedVoice, setSelectedVoice] = useState('vi-VN-HoaiMyNeural');

  const handleVoiceSelect = (voiceId: string) => {
    setSelectedVoice(voiceId);
    onSelectVoice?.(voiceId);
  };

  const handleKeyDown = (e: React.KeyboardEvent, voiceId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleVoiceSelect(voiceId);
    }
  };

  return (
    <div className={`cyber-cockpit ${isOpen ? 'open' : ''}`} role="dialog" aria-label="Neural Audio HUD">
      <div className="cockpit-header">
        <div className="cockpit-title-wrap">
          <span className="cockpit-title">AETHERDUB // COCKPIT</span>
        </div>
        <button
          type="button"
          className="cockpit-close-btn"
          onClick={onClose}
          aria-label="Close Cockpit"
        >
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="telemetry-row">
        <div className="telemetry-card">
          <div className="telemetry-label">Engine</div>
          <div className="telemetry-value">GEMINI-2.0</div>
        </div>
        <div className="telemetry-card">
          <div className="telemetry-label">Target Lang</div>
          <div className="telemetry-value">{targetLanguage}</div>
        </div>
        <div className="telemetry-card">
          <div className="telemetry-label">Ducking</div>
          <div className="telemetry-value">20% DUCKED</div>
        </div>
      </div>

      <div className="module-label">Neural Voice Matrix</div>
      <div className="voice-list">
        <div
          className={`voice-card ${selectedVoice === 'vi-VN-HoaiMyNeural' ? 'selected' : ''}`}
          onClick={() => handleVoiceSelect('vi-VN-HoaiMyNeural')}
          onKeyDown={(e) => handleKeyDown(e, 'vi-VN-HoaiMyNeural')}
          role="button"
          tabIndex={0}
          aria-pressed={selectedVoice === 'vi-VN-HoaiMyNeural'}
        >
          <div>
            <div className="voice-name">VOICE-01 // HOÀI MY</div>
            <div className="voice-meta">Neural Soft Female • Edge-TTS</div>
          </div>
          <span className="pill-live-beacon" />
        </div>

        <div
          className={`voice-card ${selectedVoice === 'vi-VN-NamMinhNeural' ? 'selected' : ''}`}
          onClick={() => handleVoiceSelect('vi-VN-NamMinhNeural')}
          onKeyDown={(e) => handleKeyDown(e, 'vi-VN-NamMinhNeural')}
          role="button"
          tabIndex={0}
          aria-pressed={selectedVoice === 'vi-VN-NamMinhNeural'}
        >
          <div>
            <div className="voice-name">VOICE-02 // NAM MINH</div>
            <div className="voice-meta">Studio Warm Male • Edge-TTS</div>
          </div>
          <span className="pill-live-beacon" />
        </div>
      </div>

      <div className="cockpit-footer">
        <span>CORE: ONLINE</span>
        <span>LATENCY: ~110ms</span>
      </div>
    </div>
  );
};
