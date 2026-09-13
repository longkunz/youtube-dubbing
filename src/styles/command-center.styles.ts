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

/* ==========================================================================
   Comprehensive Scoped Input & Form Control Styles for Options Dashboard
   Fixes unstyled input fields when mounted in isolated Shadow DOM
   ========================================================================== */

.command-center-body input[type="text"],
.command-center-body input[type="password"],
.command-center-body input[type="url"],
.command-center-body input[type="search"],
.command-center-body input[type="number"],
.command-center-body input:not([type]),
.command-center-body textarea,
.command-center-body select {
  width: 100%;
  background: #05070e;
  border: 1px solid #374151;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace, sans-serif;
  color: #ffffff;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              background-color 0.2s ease;
}

.command-center-body input[type="text"]:focus,
.command-center-body input[type="password"]:focus,
.command-center-body input[type="url"]:focus,
.command-center-body input[type="search"]:focus,
.command-center-body input[type="number"]:focus,
.command-center-body input:not([type]):focus,
.command-center-body textarea:focus,
.command-center-body select:focus {
  border-color: #00f2fe;
  box-shadow: 0 0 0 1px #00f2fe, 0 0 14px rgba(0, 242, 254, 0.35);
  background: #05070e;
  outline: none;
}

.command-center-body input::placeholder,
.command-center-body textarea::placeholder {
  color: #4b5563;
}

/* Select element specifics */
.command-center-body select {
  cursor: pointer;
  background-color: #05070e;
  color: #ffffff;
}

.command-center-body select option {
  background-color: #0a0e1a;
  color: #ffffff;
  padding: 8px;
}

/* Range sliders */
.command-center-body input[type="range"] {
  width: 100%;
  height: 8px;
  background: #1f2937;
  border-radius: 6px;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  outline: none;
  margin: 6px 0;
  accent-color: #00f2fe;
}

.command-center-body input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #00f2fe;
  border: 2px solid #ffffff;
  box-shadow: 0 0 10px #00f2fe, 0 0 20px rgba(0, 242, 254, 0.5);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.command-center-body input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 16px #00f2fe, 0 0 25px rgba(0, 242, 254, 0.8);
}

.command-center-body input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #00f2fe;
  border: 2px solid #ffffff;
  box-shadow: 0 0 10px #00f2fe;
  cursor: pointer;
}

/* Form labels */
.command-center-body label {
  display: block;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #cbd5e1;
  margin-bottom: 6px;
}

/* Dashboard Sections / Cards */
.command-center-body section {
  position: relative;
  border-radius: 12px;
  border: 1px solid rgba(0, 242, 254, 0.25);
  background: rgba(10, 14, 26, 0.85);
  backdrop-filter: blur(20px);
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 0 24px rgba(0, 242, 254, 0.08);
}

/* Buttons inside body */
.command-center-body button {
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
}

/* Utility classes used by OptionsDashboard inside Shadow DOM */
.command-center-body .w-full { width: 100%; }
.command-center-body .relative { position: relative; }
.command-center-body .absolute { position: absolute; }
.command-center-body .flex { display: flex; }
.command-center-body .flex-col { flex-direction: column; }
.command-center-body .flex-wrap { flex-wrap: wrap; }
.command-center-body .items-center { align-items: center; }
.command-center-body .justify-between { justify-content: space-between; }
.command-center-body .gap-2 { gap: 8px; }
.command-center-body .gap-2\\.5 { gap: 10px; }
.command-center-body .gap-3 { gap: 12px; }
.command-center-body .gap-4 { gap: 16px; }
.command-center-body .gap-5 { gap: 20px; }
.command-center-body .gap-8 { gap: 32px; }
.command-center-body .grid { display: grid; }
.command-center-body .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.command-center-body .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.command-center-body .space-y-4 > * + * { margin-top: 16px; }
.command-center-body .space-y-5 > * + * { margin-top: 20px; }
.command-center-body .space-y-6 > * + * { margin-top: 24px; }
.command-center-body .space-y-8 > * + * { margin-top: 32px; }
.command-center-body .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.command-center-body .text-xs { font-size: 0.75rem; line-height: 1rem; }
.command-center-body .text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.command-center-body .text-\\[10px\\] { font-size: 10px; }
.command-center-body .font-mono { font-family: 'JetBrains Mono', monospace; }
.command-center-body .font-sans { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.command-center-body .font-bold { font-weight: 700; }
.command-center-body .font-semibold { font-weight: 600; }
.command-center-body .rounded { border-radius: 4px; }
.command-center-body .rounded-lg { border-radius: 8px; }
.command-center-body .rounded-xl { border-radius: 12px; }
.command-center-body .rounded-full { border-radius: 9999px; }
.command-center-body .p-1 { padding: 4px; }
.command-center-body .p-4 { padding: 16px; }
.command-center-body .p-6 { padding: 24px; }
.command-center-body .px-3 { padding-left: 12px; padding-right: 12px; }
.command-center-body .py-1 { padding-top: 4px; padding-bottom: 4px; }
.command-center-body .py-1\\.5 { padding-top: 6px; padding-bottom: 6px; }
.command-center-body .px-4 { padding-left: 16px; padding-right: 16px; }
.command-center-body .py-2 { padding-top: 8px; padding-bottom: 8px; }
.command-center-body .px-3\\.5 { padding-left: 14px; padding-right: 14px; }
.command-center-body .py-2\\.5 { padding-top: 10px; padding-bottom: 10px; }
.command-center-body .pr-10 { padding-right: 40px; }
.command-center-body .right-2\\.5 { right: 10px; }
.command-center-body .mb-1 { margin-bottom: 4px; }
.command-center-body .mb-2 { margin-bottom: 8px; }
.command-center-body .mb-6 { margin-bottom: 24px; }
.command-center-body .mt-1 { margin-top: 4px; }
.command-center-body .pt-2 { padding-top: 8px; }
.command-center-body .pt-3 { padding-top: 12px; }
.command-center-body .pb-3 { padding-bottom: 12px; }
.command-center-body .border { border-width: 1px; }
.command-center-body .border-b { border-bottom-width: 1px; }
.command-center-body .border-t { border-top-width: 1px; }
.command-center-body .border-gray-700 { border-color: #374151; }
.command-center-body .border-gray-800 { border-color: #1f2937; }
.command-center-body .text-white { color: #ffffff; }
.command-center-body .text-gray-300 { color: #d1d5db; }
.command-center-body .text-gray-400 { color: #9ca3af; }
.command-center-body .text-gray-600 { color: #4b5563; }
.command-center-body .bg-\\[\\#05070e\\] { background-color: #05070e; }
.command-center-body .bg-\\[\\#0a0e1a\\]\\/85 { background-color: rgba(10, 14, 26, 0.85); }
.command-center-body .border-\\[\\#00f2fe\\]\\/20 { border-color: rgba(0, 242, 254, 0.2); }
.command-center-body .border-\\[\\#00f2fe\\]\\/30 { border-color: rgba(0, 242, 254, 0.3); }
.command-center-body .border-\\[\\#00f2fe\\]\\/40 { border-color: rgba(0, 242, 254, 0.4); }
.command-center-body .text-\\[\\#00f2fe\\] { color: #00f2fe; }
.command-center-body .bg-\\[\\#00f2fe\\]\\/10 { background-color: rgba(0, 242, 254, 0.1); }
.command-center-body .text-\\[\\#00ff88\\] { color: #00ff88; }
.command-center-body .border-\\[\\#00ff88\\]\\/20 { border-color: rgba(0, 255, 136, 0.2); }
.command-center-body .border-\\[\\#00ff88\\]\\/30 { border-color: rgba(0, 255, 136, 0.3); }
.command-center-body .border-\\[\\#00ff88\\]\\/60 { border-color: rgba(0, 255, 136, 0.6); }
.command-center-body .bg-\\[\\#00ff88\\]\\/10 { background-color: rgba(0, 255, 136, 0.1); }
.command-center-body .bg-\\[\\#00ff88\\]\\/15 { background-color: rgba(0, 255, 136, 0.15); }
.command-center-body .text-\\[\\#ff007a\\] { color: #ff007a; }
.command-center-body .border-\\[\\#ff007a\\]\\/30 { border-color: rgba(255, 0, 122, 0.3); }
.command-center-body .border-\\[\\#ff007a\\]\\/40 { border-color: rgba(255, 0, 122, 0.4); }
.command-center-body .border-\\[\\#ff007a\\]\\/50 { border-color: rgba(255, 0, 122, 0.5); }
.command-center-body .border-\\[\\#ff007a\\]\\/60 { border-color: rgba(255, 0, 122, 0.6); }
.command-center-body .bg-\\[\\#ff007a\\]\\/10 { background-color: rgba(255, 0, 122, 0.1); }
.command-center-body .bg-\\[\\#ff007a\\]\\/15 { background-color: rgba(255, 0, 122, 0.15); }
.command-center-body .border-\\[\\#7928ca\\]\\/30 { border-color: rgba(121, 40, 202, 0.3); }
.command-center-body .border-\\[\\#7928ca\\]\\/40 { border-color: rgba(121, 40, 202, 0.4); }
.command-center-body .shadow-\\[0_0_24px_rgba\\(0\\,242\\,254\\,0\\.1\\)\\] { box-shadow: 0 0 24px rgba(0, 242, 254, 0.1); }
.command-center-body .shadow-\\[0_0_15px_rgba\\(0\\,242\\,254\\,0\\.3\\)\\] { box-shadow: 0 0 15px rgba(0, 242, 254, 0.3); }
.command-center-body .shadow-\\[0_0_10px_rgba\\(0\\,255\\,136\\,0\\.3\\)\\] { box-shadow: 0 0 10px rgba(0, 255, 136, 0.3); }
.command-center-body .shadow-\\[0_0_10px_rgba\\(255\\,0\\,122\\,0\\.3\\)\\] { box-shadow: 0 0 10px rgba(255, 0, 122, 0.3); }
.command-center-body .block { display: block; }
.command-center-body .uppercase { text-transform: uppercase; }
.command-center-body .tracking-wide { letter-spacing: 0.025em; }
.command-center-body .tracking-wider { letter-spacing: 0.05em; }
.command-center-body .tracking-widest { letter-spacing: 0.1em; }
.command-center-body .leading-relaxed { line-height: 1.625; }
.command-center-body .backdrop-blur-xl { backdrop-filter: blur(24px); }
.command-center-body .appearance-none { appearance: none; -webkit-appearance: none; }
.command-center-body .cursor-pointer { cursor: pointer; }
.command-center-body .transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.command-center-body .disabled\\:opacity-50:disabled { opacity: 0.5; }
.command-center-body .max-w-md { max-width: 28rem; }
`;
