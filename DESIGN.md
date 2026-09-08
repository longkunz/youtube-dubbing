# YouTube Dubbing — Hyper-Fantastic Sci-Fi Audio HUD Design System

> **Design Engine**: OpenDesign  
> **Aesthetic Profile**: Hyper-Futuristic Cyberpunk HUD / Glassmorphic Holographic Deck  
> **Target Environment**: Web Extension (In-Player Floating Shadow DOM HUD + Sci-Fi Command Center)

---

## 1. Visual Philosophy & Identity

- **Unapologetically Hyper & Futuristic**: Dubbing foreign audio in real-time with Generative AI is science fiction made real. The UI rejects dull, flat corporate conventions in favor of a striking, high-octane Cyberpunk / Holographic HUD aesthetic.
- **Deep Glassmorphism & Neon Glow**: Components float effortlessly over the video stream with `backdrop-filter: blur(24px)`, radiant neon gradient borders, and reactive laser glow effects.
- **Live Audio-Reactive Visuals**: The UI breathes with the voice—equalizer spectrum bars, pulsing energy orbs, and neon volume meters animate dynamically as speech synthesis fires.
- **HUD Telemetry & Micro-Details**: Monospace telemetry readouts (Engine model, latency in ms, voice sample rate) evoke the cockpit of an advanced AI spacecraft.

---

## 2. Neon Cyber Color Palette

| Token | Hex / CSS | Semantics & Impact |
| :--- | :--- | :--- |
| `--cyber-cyan` | `#00f2fe` | Primary laser highlight, active indicators, live audio wave |
| `--cyber-purple` | `#7928ca` | Secondary atmospheric gradient, card glow accents |
| `--hyper-magenta` | `#ff007a` | High-energy accent, active state switches, ducking thresholds |
| `--matrix-emerald` | `#00ff88` | Neural core online, ready status, cache optimal |
| `--solar-amber` | `#ffb703` | JIT translation stream in-flight, sliding window buffering |
| `--void-dark` | `#05070e` | Infinite black canvas for deep contrast |
| `--glass-surface` | `rgba(10, 14, 26, 0.78)` | Frosted glass panel surface with 24px blur |
| `--glass-card` | `rgba(19, 26, 46, 0.65)` | Inner component cards, selector chips |
| `--border-neon` | `rgba(0, 242, 254, 0.35)`| Luminous hairline border for HUD boundaries |
| `--glow-primary` | `0 0 24px rgba(0, 242, 254, 0.3)` | Atmospheric neon illumination |
| `--glow-magenta` | `0 0 24px rgba(255, 0, 122, 0.3)` | High-energy focus glow |

---

## 3. Futuristic Typography

- **Display & Telemetry Headers**: `'Orbitron', 'JetBrains Mono', monospace` (Futuristic, high-tech, angular numbers).
- **Body & Controls**: `'Inter', -apple-system, sans-serif` (Ultra-legible, geometric sans, weights 400 to 700).

| Hierarchy | Size | Weight | Tracking | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `hud-telemetry` | `11px` | 600 Mono | `+0.12em` | Real-time stats (`ENGINE: GEMINI-2.0 // LATENCY: 110ms`) |
| `hud-title` | `16px` | 700 Orbitron | `+0.06em` | Floating panel brand header & module titles |
| `hud-label` | `12px` | 600 Sans | `+0.04em` | Parameter labels, slider readouts, voice names |
| `hud-caption` | `10px` | 500 Mono | `+0.08em` | Technical metadata, model tags, status badges |

---

## 4. Component Architecture

### 4.1 Floating Holographic HUD Pill (`.hyper-hud-pill`)
- **Behavior**: Draggable or pinned floating capsule anchored near the YouTube player controls.
- **Surface**: Glass capsule with a rotating gradient border (`linear-gradient(135deg, #00f2fe, #ff007a)`), housing:
  - Glowing Neon Mic / Waveform icon.
  - Live animated Mini-Equalizer (5 glowing vertical bars reacting to speech).
  - Status Pill: `NEURAL CORE: LIVE` (pulsing green glow).
  - Quick Toggle click to expand the full Cockpit Panel.

### 4.2 The Cyber Cockpit (In-Player Expandable HUD)
- **Geometry**: Chamfered futuristic glass card (`width: 320px`, `backdrop-filter: blur(28px)`).
- **Modules**:
  1. **Neural Voice Matrix**: Glowing voice cards with holographic soundwave avatars:
     - `VOICE-01 // HOÀI MY` (Neural Soft Female - Cyan Glow)
     - `VOICE-02 // NAM MINH` (Neural Studio Male - Purple Glow)
  2. **Dual-Rail Audio Ducking Visualizer**:
     - Interactive laser slider with neon track fill and glowing thumb.
     - Dynamic HUD readouts: `ORIGINAL AUDIO: [20% DUCKED]` vs `AI DUB ENGINE: [100% BOOST]`.
  3. **Multi-Speaker Diarization Scanner**:
     - Cyber toggle with animated scanning beam when enabled.
  4. **Telemetry Footer**:
     - Displaying real-time tokens processed, current segment start/end time, and buffer health.

### 4.3 Subtitle Overlay (Gentle & Minimalist YouTube Native Style)
- **Rationale**: While controls and telemetry are hyper-futuristic, reading subtitles requires zero eye fatigue and maximum legibility. Therefore, the subtitles on the video surface strictly retain the gentle, clean aesthetic of native YouTube captions.
- **Styling**:
  - Background: `rgba(0, 0, 0, 0.8)` soft semi-transparent black pill (`border-radius: 3px`).
  - Text: `#ffffff` crisp white text, font size `18px - 20px`, font weight `500`, line height `1.4`.
  - Secondary Original Text (optional preview): `rgba(255, 255, 255, 0.75)` at `13px`.
  - **Zero Distraction**: No glowing neon borders, no laser boxes, and no shadows on the text itself, ensuring the video content remains the hero.

### 4.4 Command Center (Options & Configuration Dashboard)
- **Concept**: A dark sci-fi operations deck for controlling AI credentials, cache data, and sound processing models.
- **Sections**:
  - **Neural Link Core**: Input fields for Gemini / Groq API Keys styled as encrypted terminal inputs with glowing cursor and validation ping.
  - **TTS Engine Forge**: Edge TTS vs ElevenLabs selector with pitch, modulation, and timestretch calibration dials.
  - **Sub-atomic Cache Vault**: Interactive circular progress meter showing IndexedDB storage utilization and one-click "Purge Cache" with a warp-drive wipe animation.

---

## 5. Motion & Micro-Interactions

| Element | Animation Spec | Visual Effect |
| :--- | :--- | :--- |
| **HUD Expand / Collapse** | 220ms `cubic-bezier(0.16, 1, 0.3, 1)` | Holographic scale (`0.92 -> 1.0`), border laser glow flare |
| **Voice Card Selection** | 150ms `ease-out` | Border shift from Cyan to Magenta with neon ripple |
| **Ducking Laser Slider** | 60ms immediate | Thumb expands with neon bloom, audio wave bars shift height |
| **Equalizer Animation** | 100ms random loop | Bars fluctuate between 4px and 36px with cyan gradient |
| **Telemetry Pulse** | 2.5s infinite | Glowing dot breathing between opacity 0.4 and 1.0 |
