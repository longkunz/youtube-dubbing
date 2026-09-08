/* Scoped Sci-Fi HUD Styles for Shadow DOM */
export const HUD_STYLES = `
:host {
  all: initial;
  display: inline-flex;
  align-items: center;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --cyber-cyan: #00f2fe;
  --cyber-purple: #7928ca;
  --hyper-magenta: #ff007a;
  --matrix-emerald: #00ff88;
  --solar-amber: #ffb703;
  --void-dark: #05070f;
  --glass-bg: rgba(10, 14, 26, 0.88);
  --glass-card: rgba(18, 24, 44, 0.75);
  --border-neon: rgba(0, 242, 254, 0.35);
  --border-magenta: rgba(255, 0, 122, 0.4);
  --glow-cyan: 0 0 20px rgba(0, 242, 254, 0.35);
  --glow-magenta: 0 0 20px rgba(255, 0, 122, 0.35);
  --glow-emerald: 0 0 15px rgba(0, 255, 136, 0.4);
}

.hud-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-right: 8px;
  vertical-align: middle;
}

/* The Glowing Pill Trigger */
.hyper-pill-trigger {
  background: linear-gradient(135deg, rgba(0, 242, 254, 0.22), rgba(255, 0, 122, 0.22));
  border: 1px solid var(--cyber-cyan);
  box-shadow: 0 0 16px rgba(0, 242, 254, 0.4), inset 0 0 8px rgba(0, 242, 254, 0.2);
  border-radius: 20px;
  padding: 4px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  backdrop-filter: blur(16px);
  user-select: none;
  outline: none;
}

.hyper-pill-trigger:hover {
  transform: translateY(-1px) scale(1.03);
  box-shadow: 0 0 24px rgba(0, 242, 254, 0.6);
  border-color: #ffffff;
}

.hyper-pill-trigger.active {
  border-color: var(--hyper-magenta);
  box-shadow: 0 0 20px rgba(255, 0, 122, 0.6);
}

.pill-icon {
  color: var(--cyber-cyan);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pill-label {
  font-family: 'Orbitron', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ffffff;
  text-shadow: 0 0 8px rgba(0, 242, 254, 0.5);
  white-space: nowrap;
}

.pill-live-beacon {
  width: 6px;
  height: 6px;
  background: var(--matrix-emerald);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--matrix-emerald);
  animation: pulseBeacon 2s infinite ease-in-out;
}

@keyframes pulseBeacon {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

/* THE EXPANDABLE SCI-FI COCKPIT PANEL */
.cyber-cockpit {
  position: absolute;
  bottom: 56px;
  right: 0;
  width: 350px;
  background: var(--glass-bg);
  backdrop-filter: blur(28px);
  border: 1px solid var(--border-neon);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85), 0 0 35px rgba(0, 242, 254, 0.2);
  border-radius: 16px;
  padding: 18px;
  z-index: 99999;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(12px) scale(0.95);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  color: #e2e8f0;
}

.cyber-cockpit.open {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}

/* Cockpit Header */
.cockpit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(0, 242, 254, 0.2);
  margin-bottom: 12px;
}

.cockpit-title-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cockpit-title {
  font-family: 'Orbitron', monospace;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #ffffff;
  text-shadow: 0 0 10px rgba(0, 242, 254, 0.6);
}

.cockpit-close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.cockpit-close-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.1);
}

/* Equalizer Spectrum Wave */
.equalizer-wave {
  display: flex;
  align-items: flex-end;
  gap: 2.5px;
  height: 14px;
}

.equalizer-bar {
  width: 3px;
  height: 3px;
  background: rgba(0, 242, 254, 0.35);
  border-radius: 2px;
  transition: height 0.2s ease, background 0.2s ease;
}

.equalizer-bar.animating,
.equalizer-wave.active .equalizer-bar {
  animation: eqWave 0.8s infinite ease-in-out alternate;
}

.equalizer-wave.active .equalizer-bar:nth-child(1) { animation-delay: 0.0s; }
.equalizer-wave.active .equalizer-bar:nth-child(2) { animation-delay: 0.15s; }
.equalizer-wave.active .equalizer-bar:nth-child(3) { animation-delay: 0.3s; }
.equalizer-wave.active .equalizer-bar:nth-child(4) { animation-delay: 0.1s; }
.equalizer-wave.active .equalizer-bar:nth-child(5) { animation-delay: 0.25s; }

@keyframes eqWave {
  0% {
    height: 3px;
    background: var(--cyber-cyan);
  }
  50% {
    height: 14px;
    background: var(--matrix-emerald);
    box-shadow: 0 0 6px var(--matrix-emerald);
  }
  100% {
    height: 6px;
    background: var(--hyper-magenta);
  }
}

/* Control Row & On/Off Toggle */
.cockpit-control-row {
  margin-bottom: 12px;
}

.cyber-toggle-wrapper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--glass-card);
  border: 1px solid rgba(0, 242, 254, 0.2);
  border-radius: 8px;
  padding: 8px 12px;
}

.control-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  color: #cbd5e1;
  letter-spacing: 0.04em;
}

.cyber-toggle-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  outline: none;
}

.cyber-toggle-switch.active {
  background: rgba(0, 242, 254, 0.18);
  border-color: var(--cyber-cyan);
  box-shadow: 0 0 10px rgba(0, 242, 254, 0.3);
}

.toggle-slider {
  width: 12px;
  height: 12px;
  background: #64748b;
  border-radius: 50%;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.cyber-toggle-switch.active .toggle-slider {
  background: var(--matrix-emerald);
  box-shadow: 0 0 8px var(--matrix-emerald);
  transform: scale(1.1);
}

.toggle-text {
  font-family: 'Orbitron', monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #94a3b8;
}

.cyber-toggle-switch.active .toggle-text {
  color: #ffffff;
  text-shadow: 0 0 6px rgba(0, 242, 254, 0.6);
}

/* Telemetry Section */
.telemetry-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.telemetry-card {
  flex: 1;
  background: var(--glass-card);
  border: 1px solid rgba(0, 242, 254, 0.2);
  border-radius: 8px;
  padding: 8px 10px;
}

.telemetry-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: #94a3b8;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 2px;
}

.telemetry-value {
  font-family: 'Orbitron', monospace;
  font-size: 11px;
  font-weight: 700;
  color: var(--cyber-cyan);
}

/* Form Controls & Field Groups */
.cockpit-field-group {
  margin-bottom: 12px;
}

.module-label {
  font-family: 'Orbitron', monospace;
  font-size: 10px;
  font-weight: 700;
  color: #cbd5e1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
  display: block;
}

.cyber-select-wrap {
  position: relative;
}

.cyber-select {
  width: 100%;
  background: var(--glass-card);
  color: #ffffff;
  border: 1px solid rgba(0, 242, 254, 0.3);
  border-radius: 8px;
  padding: 7px 10px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  outline: none;
  cursor: pointer;
  transition: all 0.2s;
  box-sizing: border-box;
}

.cyber-select:hover,
.cyber-select:focus {
  border-color: var(--cyber-cyan);
  box-shadow: 0 0 10px rgba(0, 242, 254, 0.3);
}

.cyber-select option {
  background: var(--void-dark);
  color: #ffffff;
}

/* Ducking Slider */
.slider-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.ducking-readout {
  font-family: 'Orbitron', monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--cyber-cyan);
  text-shadow: 0 0 6px rgba(0, 242, 254, 0.4);
}

.cyber-slider {
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  outline: none;
  margin: 4px 0 0 0;
  cursor: pointer;
  box-sizing: border-box;
}

.cyber-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--cyber-cyan);
  box-shadow: 0 0 10px var(--cyber-cyan);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.cyber-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 14px var(--cyber-cyan);
}

.cyber-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--cyber-cyan);
  box-shadow: 0 0 10px var(--cyber-cyan);
  cursor: pointer;
  border: none;
}

/* Voice Matrix */
.voice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.voice-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--glass-card);
  border: 1px solid rgba(0, 242, 254, 0.25);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.voice-card:hover {
  border-color: var(--cyber-cyan);
  background: rgba(0, 242, 254, 0.1);
}

.voice-card.selected {
  border-color: var(--hyper-magenta);
  box-shadow: 0 0 15px rgba(255, 0, 122, 0.35);
  background: rgba(255, 0, 122, 0.1);
}

.voice-name {
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
}

.voice-meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: #94a3b8;
}

.cockpit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: #64748b;
}

/* SUBTITLE OVERLAY — YouTube CC Gentle Styling per ADR-0005/ADR-0006 */
.subtitle-overlay {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
  z-index: 9999;
  text-align: center;
  width: max-content;
  max-width: 85%;
}

.subtitle-pill {
  background: rgba(8, 8, 8, 0.84);
  color: #ffffff;
  padding: 6px 14px;
  border-radius: 4px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.4;
  text-shadow: none;
  box-shadow: none;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  word-break: break-word;
}

.subtitle-translated {
  color: #ffffff;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.4;
}

.subtitle-original {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  margin-top: 2px;
  font-weight: 400;
  line-height: 1.3;
}
`;
