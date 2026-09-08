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
  width: 340px;
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
  margin-bottom: 14px;
}

.cockpit-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
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

/* Telemetry Section */
.telemetry-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
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

/* Voice Matrix */
.module-label {
  font-family: 'Orbitron', monospace;
  font-size: 10px;
  font-weight: 700;
  color: #cbd5e1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.voice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
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
`;
