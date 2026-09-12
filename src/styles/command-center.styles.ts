/* Scoped Sci-Fi In-Page Command Center Drawer Styles for Shadow DOM */
export const COMMAND_CENTER_STYLES = `
:host {
  all: initial;
  display: block;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #ffffff;
  --cyber-cyan: #00f2fe;
  --cyber-purple: #7928ca;
  --hyper-magenta: #ff007a;
  --matrix-emerald: #00ff88;
  --solar-amber: #ffb703;
  --void-dark: #05070e;
  --glass-bg: rgba(10, 14, 26, 0.96);
  --glass-card: rgba(18, 24, 44, 0.85);
  --border-neon: rgba(0, 242, 254, 0.35);
  --border-magenta: rgba(255, 0, 122, 0.4);
}

*, *::before, *::after {
  box-sizing: border-box;
}

.command-center-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(480px, 100vw);
  height: 100vh;
  z-index: 2147483646;
  background: var(--void-dark);
  color: #ffffff;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-neon);
  box-shadow: -12px 0 36px rgba(0, 0, 0, 0.85), 0 0 24px rgba(0, 242, 254, 0.12);
  transform: translateX(0);
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.command-center-drawer.closed {
  transform: translateX(100%);
  pointer-events: none;
}

/* Header */
.command-center-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border-neon);
  position: sticky;
  top: 0;
  z-index: 20;
  flex-shrink: 0;
  gap: 12px;
}

.command-center-header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.command-center-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.command-center-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cyber-cyan);
  box-shadow: 0 0 10px var(--cyber-cyan);
  animation: pulse-glow 2s infinite ease-in-out;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

.command-center-title {
  font-family: 'Orbitron', 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.1em;
  background: linear-gradient(135deg, var(--cyber-cyan), var(--hyper-magenta), var(--cyber-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-transform: uppercase;
}

.command-center-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Auto-Save Badge */
.command-center-autosave-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  color: var(--matrix-emerald);
  background: rgba(0, 255, 136, 0.1);
  border: 1px solid rgba(0, 255, 136, 0.35);
  border-radius: 4px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.command-center-autosave-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--matrix-emerald);
  box-shadow: 0 0 6px var(--matrix-emerald);
}

/* Action Buttons */
.command-center-open-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--border-neon);
  color: var(--cyber-cyan);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 5px 9px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.command-center-open-tab-btn:hover {
  background: rgba(0, 242, 254, 0.15);
  border-color: var(--cyber-cyan);
  box-shadow: 0 0 10px rgba(0, 242, 254, 0.4);
  color: #ffffff;
}

.command-center-close-btn {
  background: transparent;
  border: 1px solid var(--border-magenta);
  color: var(--hyper-magenta);
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
}

.command-center-close-btn:hover {
  background: rgba(255, 0, 122, 0.2);
  border-color: var(--hyper-magenta);
  box-shadow: 0 0 12px rgba(255, 0, 122, 0.5);
  color: #ffffff;
}

/* Scrollable Drawer Body */
.command-center-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
}

/* Sci-Fi Scrollbar */
.command-center-body::-webkit-scrollbar {
  width: 6px;
}
.command-center-body::-webkit-scrollbar-track {
  background: rgba(5, 7, 15, 0.85);
}
.command-center-body::-webkit-scrollbar-thumb {
  background: rgba(0, 242, 254, 0.3);
  border-radius: 3px;
}
.command-center-body::-webkit-scrollbar-thumb:hover {
  background: var(--cyber-cyan);
  box-shadow: 0 0 8px var(--cyber-cyan);
}
`;
