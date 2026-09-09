import React, { useState } from 'react';

export interface TargetLanguageOption {
  code: string;
  label: string;
}

export const TARGET_LANGUAGES: TargetLanguageOption[] = [
  { code: 'vi', label: 'Tiếng Việt [vi]' },
  { code: 'en', label: 'English [en]' },
  { code: 'ja', label: '日本語 [ja]' },
  { code: 'zh', label: '中文 [zh]' },
  { code: 'es', label: 'Español [es]' },
];

export interface CyberCockpitProps {
  isOpen: boolean;
  onClose: () => void;
  isEnabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  isMultiSpeakerEnabled?: boolean;
  onToggleMultiSpeaker?: (enabled: boolean) => void;
  targetLanguage?: string;
  onSelectLanguage?: (languageCode: string) => void;
  selectedVoiceId?: string;
  onSelectVoice?: (voiceId: string) => void;
  duckLevel?: number;
  onDuckLevelChange?: (level: number) => void;
  isPlaying?: boolean;
  isDucked?: boolean;
  onOpenSettings?: () => void;
  /** Translation engine badge (e.g. GEMINI-2.0, GPT-4O-MINI). Defaults to GEMINI-2.0. */
  engineLabel?: string;
}

export const CyberCockpit: React.FC<CyberCockpitProps> = ({
  isOpen,
  onClose,
  isEnabled = true,
  onToggleEnabled,
  isMultiSpeakerEnabled = false,
  onToggleMultiSpeaker,
  targetLanguage = 'vi',
  onSelectLanguage,
  selectedVoiceId,
  onSelectVoice,
  duckLevel = 0.2,
  onDuckLevelChange,
  isPlaying = false,
  isDucked = false,
  onOpenSettings,
  engineLabel = 'GEMINI-2.0',
}) => {
  const [internalVoice, setInternalVoice] = useState('vi-VN-HoaiMyNeural');
  const [internalMultiSpeaker, setInternalMultiSpeaker] = useState(isMultiSpeakerEnabled);
  const activeVoice = selectedVoiceId ?? internalVoice;
  const isMultiSpeaker = isMultiSpeakerEnabled !== undefined ? isMultiSpeakerEnabled : internalMultiSpeaker;

  const handleToggleMultiSpeaker = () => {
    const next = !isMultiSpeaker;
    setInternalMultiSpeaker(next);
    onToggleMultiSpeaker?.(next);
  };

  const normalizedLang = TARGET_LANGUAGES.find(
    (l) => l.code === targetLanguage || l.label === targetLanguage
  );
  const currentLangCode = normalizedLang?.code ?? targetLanguage;
  const currentLangLabel = normalizedLang?.label ?? targetLanguage;

  const duckPercent = Math.round(duckLevel > 1 ? duckLevel : duckLevel * 100);
  const isWaveActive = Boolean(isPlaying && isDucked);

  const handleVoiceSelect = (voiceId: string) => {
    setInternalVoice(voiceId);
    onSelectVoice?.(voiceId);
  };

  const handleKeyDown = (e: React.KeyboardEvent, voiceId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleVoiceSelect(voiceId);
    }
  };

  return (
    <div
      className={`cyber-cockpit ${isOpen ? 'open' : ''}`}
      role="dialog"
      aria-label="Neural Audio HUD"
      aria-hidden={!isOpen}
    >

      {/* Header */}
      <div className="cockpit-header">
        <div className="cockpit-title-wrap">
          <span className="cockpit-title">AETHERDUB // COCKPIT</span>
          <div
            className={`equalizer-wave ${isWaveActive ? 'active' : ''}`}
            data-testid="equalizer-wave"
            data-animating={isWaveActive ? 'true' : 'false'}
            aria-label="Equalizer Spectrum"
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`equalizer-bar ${isWaveActive ? 'active animating' : ''}`}
                data-testid={`equalizer-bar-${i}`}
              />
            ))}
          </div>
        </div>
        <div className="cockpit-header-actions">
          <button
            type="button"
            className="cockpit-settings-btn"
            onClick={onOpenSettings}
            aria-label="Open Settings Dashboard"
            data-testid="cockpit-settings-btn"
            title="Open Command Center (Settings)"
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
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
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
      </div>

      {/* On/Off Toggle Row */}
      <div className="cockpit-control-row">
        <div className="cyber-toggle-wrapper">
          <span className="control-label">Dub Track Audio</span>
          <button
            type="button"
            role="switch"
            aria-checked={isEnabled}
            aria-label="Toggle Dub Track"
            className={`cyber-toggle-switch ${isEnabled ? 'active' : ''}`}
            onClick={() => onToggleEnabled?.(!isEnabled)}
          >
            <span className="toggle-slider" />
            <span className="toggle-text">{isEnabled ? 'DUB: ON' : 'DUB: OFF'}</span>
          </button>
        </div>

        <div className="cyber-toggle-wrapper">
          <span className="control-label">Multi-Speaker Diarization</span>
          <button
            type="button"
            role="switch"
            aria-checked={isMultiSpeaker}
            aria-label="Toggle Multi-Speaker Diarization Scanner"
            data-testid="multi-speaker-toggle"
            className={`cyber-toggle-switch ${isMultiSpeaker ? 'active' : ''}`}
            onClick={handleToggleMultiSpeaker}
          >
            <span className="toggle-slider" />
            <span className="toggle-text">{isMultiSpeaker ? 'SCANNER: AUTO' : 'SCANNER: OFF'}</span>
          </button>
        </div>
      </div>

      {/* Telemetry Row */}
      <div className="telemetry-row">
        <div className="telemetry-card">
          <div className="telemetry-label">Engine</div>
          <div className="telemetry-value">{engineLabel}</div>
        </div>
        <div className="telemetry-card">
          <div className="telemetry-label">Target Lang</div>
          <div className="telemetry-value">{currentLangLabel}</div>
        </div>
        <div className="telemetry-card">
          <div className="telemetry-label">Ducking</div>
          <div className="telemetry-value">{duckPercent}% DUCKED</div>
        </div>
      </div>

      {/* Language Selector */}
      <div className="cockpit-field-group">
        <label htmlFor="target-language-select" className="module-label">
          Target Language
        </label>
        <div className="cyber-select-wrap">
          <select
            id="target-language-select"
            className="cyber-select"
            aria-label="Select Target Language"
            value={currentLangCode}
            onChange={(e) => onSelectLanguage?.(e.target.value)}
          >
            {TARGET_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Dual-Rail Audio Ducking Slider */}
      <div className="cockpit-field-group">
        <div className="slider-header-row">
          <label htmlFor="ducking-level-slider" className="module-label">
            Audio Ducking Level
          </label>
          <span className="ducking-readout">ORIGINAL AUDIO: {duckPercent}% DUCKED</span>
        </div>
        <input
          id="ducking-level-slider"
          type="range"
          min={0}
          max={100}
          value={duckPercent}
          aria-label="Audio Ducking Level"
          className="cyber-slider"
          onChange={(e) => {
            const val = Number(e.target.value);
            onDuckLevelChange?.(val / 100);
          }}
        />
      </div>

      {/* Neural Voice Matrix */}
      <div className="module-label">Neural Voice Matrix</div>
      <div className="voice-list">
        <div
          className={`voice-card ${activeVoice === 'vi-VN-HoaiMyNeural' ? 'selected' : ''}`}
          onClick={() => handleVoiceSelect('vi-VN-HoaiMyNeural')}
          onKeyDown={(e) => handleKeyDown(e, 'vi-VN-HoaiMyNeural')}
          role="button"
          tabIndex={0}
          aria-pressed={activeVoice === 'vi-VN-HoaiMyNeural'}
        >
          <div>
            <div className="voice-name">VOICE-01 // HOÀI MY</div>
            <div className="voice-meta">Neural Soft Female • Edge-TTS</div>
          </div>
          <span className="pill-live-beacon" />
        </div>

        <div
          className={`voice-card ${activeVoice === 'vi-VN-NamMinhNeural' ? 'selected' : ''}`}
          onClick={() => handleVoiceSelect('vi-VN-NamMinhNeural')}
          onKeyDown={(e) => handleKeyDown(e, 'vi-VN-NamMinhNeural')}
          role="button"
          tabIndex={0}
          aria-pressed={activeVoice === 'vi-VN-NamMinhNeural'}
        >
          <div>
            <div className="voice-name">VOICE-02 // NAM MINH</div>
            <div className="voice-meta">Studio Warm Male • Edge-TTS</div>
          </div>
          <span className="pill-live-beacon" />
        </div>
      </div>

      <div className="cockpit-footer">
        <button
          type="button"
          className="cockpit-footer-btn"
          onClick={onOpenSettings}
          data-testid="cockpit-footer-settings-btn"
          title="Open Command Center Settings"
        >
          ⚙ SETTINGS // CONFIG
        </button>
        <span>LATENCY: ~110ms</span>
      </div>
    </div>
  );
};
