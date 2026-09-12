# YouTube Dubbing (AetherDub)

> **Real-time AI voice dubbing for YouTube with a Hyper Sci-Fi Audio HUD and gentle native captions.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.chrome.com/docs/extensions/develop)
[![Framework: WXT](https://img.shields.io/badge/Framework-WXT-purple.svg)](https://wxt.dev/)

YouTube Dubbing is a Chrome/Web extension that translates and dubs YouTube videos into natural, fluent Vietnamese (and other target languages) in real time. New installs default to an operator-run **Self-hosted Backend** (EN→VI + Piper/Edge TTS). Gemini BYOK and YouTube Caption Translation remain optional. It pairs a high-octane **Hyper Sci-Fi Cockpit HUD** for audio controls with clean, unobtrusive **YouTube-native subtitles** for zero eye fatigue.

---

## ⚡ Key Capabilities

- **Self-hosted Backend (default)**: CPU Docker Compose for EN→VI translation and MP3 TTS. Chrome does not open Bing WebSocket. Gemini / OpenAI-compatible / YouTube Caption Translation stay selectable.
- **Optional BYOK**: Google Gemini, OpenAI-compatible proxies, and Groq Whisper when you want them — not required for the self-hosted path.
- **Intelligent Sentence Restructuring**: Merges fragmented YouTube auto-captions (silence gap < 0.4s) into cohesive sentences with preserved timeline boundaries before translation.
- **On-Demand Activation**: Toolbar HUD mounts dormant (`DUB: OFF`). Translation and TTS start only when you toggle dubbing on (ADR-0008).
- **Configurable Gemini Flash + OpenAI-compatible proxies**: Default model `gemini-3.8-flash` with Command Center presets, custom IDs, 404 fallback, and optional `/v1/chat/completions` gateways.
- **Full Upfront Translation**: Translates the full video transcript in a single batch pass when dubbing is activated, ensuring pronouns, tone, and technical terminology remain consistent.
- **Cockpit target language**: Cache lookup and translation follow the language selected in the Cyber Cockpit (default `vi`).
- **Sliding-Window Speech Synthesis**: Pre-synthesizes audio 30–60 seconds ahead via `POST /v1/tts` (Piper, then Edge TTS on the server). Web Speech is an explicit degraded option, not a fake audio blob.
- **Whisper Fallback**: If YouTube captions cannot be downloaded and a Groq API key is set, transcribe unsigned player audio via Groq Whisper. Netflix, lip-sync, and paid TTS are out of scope.
- **Dynamic Audio Ducking & Time-Stretching**: Smoothly attenuates original video volume to ~20% in 150ms during active speech and scales TTS rate (1.0x–1.35x) to maintain perfect synchronization with speaker lip movements.
- **Zero-CSS-Bleed Shadow DOM Mount**: In-player controls (`NEURAL DUB` trigger pill and the expandable Cyber Cockpit) are isolated within a Shadow DOM container inside `.ytp-right-controls`.
- **Gentle, Native Subtitles**: Subtitle text overlay retains YouTube's clean, distraction-free aesthetic (`rgba(8, 8, 8, 0.84)` rounded pill with crisp white text).
- **Persistent Local Cache (`SegmentCache`)**: Stores translated transcripts and synthesized audio blobs in browser IndexedDB for instant 0ms replays with zero repeat API costs.

---

## 🏛️ Architecture & Decisions

The project's architectural decisions are documented as lightweight ADRs:

- [ADR-0001: Client architecture with optional BYOK](docs/adr/0001-client-side-byok-architecture.md)
- [ADR-0010: Self-hosted CPU backend](docs/adr/0010-self-hosted-cpu-backend.md)
- [ADR-0002: HTMLMediaElement Volume Lerp for Audio Ducking](docs/adr/0002-volume-lerp-for-audio-ducking.md)
- [ADR-0003: Full Transcript Pre-Translation with Sliding-Window TTS](docs/adr/0003-full-pretranslation-sliding-window-tts.md)
- [ADR-0004: In-Player Controls via Shadow DOM Injection](docs/adr/0004-shadow-dom-in-player-controls.md)
- [ADR-0006: Hyper-Fantastic Sci-Fi Audio HUD Design System](docs/adr/0006-hyper-fantastic-hud-design-system.md)
- [ADR-0007: Pluggable Multi-Provider Translation](docs/adr/0007-pluggable-translation-openai-compatible-proxy.md)
- [ADR-0008: On-Demand Pause-and-Buffer Activation](docs/adr/0008-on-demand-pause-and-buffer-activation.md)

---

## 🎨 Design System & Interactive Prototype

- **Design System**: [`DESIGN.md`](DESIGN.md) defines color tokens, typography scales, HUD geometry, and micro-interaction timings.
- **Interactive Prototype**: Open [`design/prototype.html`](design/prototype.html) directly in any browser to interact with the simulated YouTube video player, the Cyber Cockpit, volume sliders, and the Command Center.

---

## 🚀 Getting Started

### Prerequisites
- Node.js >= 20
- npm, pnpm, or bun

### Setup & Development
```bash
# Clone the repository
git clone https://github.com/longkunz/youtube-dubbing.git
cd youtube-dubbing

# Install dependencies
npm install

# Run in development mode with automatic Chrome reload
npm run dev

# Run unit and integration tests (TDD)
npm test

# Build production extension package
npm run build
```

### Self-hosted Backend

```bash
cd server
cp .env.example .env   # set BACKEND_API_KEY
docker compose up --build
```

Default is CPU (Piper). On an NVIDIA host, uncomment `gpus: all` in `server/compose.yml` so Local TTS can load MMS-TTS.

Point Command Center **Backend URL** at `http://<docker-host-ip>:8787`.

---

## 📋 Project Tracking

Issues are tracked on GitHub: [GitHub Issues](https://github.com/longkunz/youtube-dubbing/issues)

- [Issue #1: Project Foundation & Shadow DOM In-Player HUD Mount](https://github.com/longkunz/youtube-dubbing/issues/1)
- [Issue #2: Transcript Extraction & Gap-Based Sentence Restructuring](https://github.com/longkunz/youtube-dubbing/issues/2)
- [Issue #3: Upfront Translation Pipeline with Gemini Flash](https://github.com/longkunz/youtube-dubbing/issues/3)
- [Issue #4: Microsoft Edge Neural TTS Streaming via Service Worker](https://github.com/longkunz/youtube-dubbing/issues/4)
- [Issue #5: Persistent Local Audio & Transcript Cache (IndexedDB)](https://github.com/longkunz/youtube-dubbing/issues/5)
- [Issue #6: Audio Ducking & Playback Sync Engine](https://github.com/longkunz/youtube-dubbing/issues/6)
- [Issue #7: Gentle Subtitle Overlay & Full Cyber Cockpit Integration](https://github.com/longkunz/youtube-dubbing/issues/7)
- [Issue #8: Command Center Options Dashboard & Resilience Fallbacks](https://github.com/longkunz/youtube-dubbing/issues/8)
- [Issue #9: Multi-Speaker Diarization & Dynamic Voice Switching](https://github.com/longkunz/youtube-dubbing/issues/9)
- [Issue #10: Pluggable Multi-Provider Translation with OpenAI-Compatible Proxy](https://github.com/longkunz/youtube-dubbing/issues/10)
- [Issue #11: On-Demand Pause-and-Buffer Activation](https://github.com/longkunz/youtube-dubbing/issues/11)
- [Issue #12: Configurable Gemini Model Selection](https://github.com/longkunz/youtube-dubbing/issues/12)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
