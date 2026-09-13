---
type: project
created: 2026-09-08
updated: 2026-09-12
---

# Technical Decisions Summary

- **ADR-0001 (superseded) + ADR-0010 + ADR-0013**: Strict Self-hosted Backend-Only topology (FastAPI CPU Docker, MarianMT EN→VI + ZeroTTS CPU real-time TTS). All third-party cloud services (Gemini, OpenAI, Groq Whisper) and browser fallbacks (Web Speech API, direct Edge TTS, YouTube Caption Translation) are completely purged. Target language is locked to Vietnamese (`vi`).
- **ADR-0002 (Volume Lerp for Ducking)**: Direct `HTMLMediaElement.volume` interpolation (150ms) to avoid YouTube cross-origin audio CORS blockage. Equalizer is event-driven rather than a live PCM FFT analyzer.
- **ADR-0003 (Pre-Translation + Sliding Window TTS)**: Translate complete transcript upfront on backend for global context; synthesize TTS in rolling lookahead window via ZeroTTS. Lifecycle shifted to on-demand by ADR-0008.
- **ADR-0008 (On-Demand Activation)**: Dormant mount; cache-hit fast path; pause-and-buffer with Preparation Overlay on cache miss.
- **ADR-0013 (ZeroTTS & Failure Recovery)**: ZeroTTS CPU inference (`zeroweight-ai/ZeroTTS`, ~70ms TTFA). Dub Track halts on backend failure; HUD shows BACKEND OFFLINE with one-click reconnect (reset breaker + ping health) without reloading.
- **ADR-0004 (Shadow DOM In-Player Controls)**: Injected directly into `.ytp-right-controls` inside an isolated Shadow DOM container.
- **ADR-0006 (Hyper Sci-Fi HUD Design System)**: Glassmorphic cockpit, neon cyan/magenta gradients, and animated audio equalizer for controls, paired with gentle YouTube-style subtitles (`rgba(8, 8, 8, 0.84)`).
- **SegmentCache (Storage)**: Persistent browser IndexedDB storage using Jake Archibald's `idb` library for 0ms replay and zero token waste.
