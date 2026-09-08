---
type: project
created: 2026-09-08
updated: 2026-09-08
---

# Technical Decisions Summary

- **ADR-0001 (100% Client-Side BYOK)**: Zero backend server; user provides Gemini API key; Edge TTS accessed via Background Service Worker WebSocket.
- **ADR-0002 (Volume Lerp for Ducking)**: Direct `HTMLMediaElement.volume` interpolation (150ms) to avoid YouTube cross-origin audio CORS blockage. Equalizer is event-driven rather than a live PCM FFT analyzer.
- **ADR-0003 (Pre-Translation + Sliding Window TTS)**: Translate complete transcript upfront with `gemini-2.0-flash` for global context; synthesize TTS in rolling 30–60s lookahead window.
- **ADR-0004 (Shadow DOM In-Player Controls)**: Injected directly into `.ytp-right-controls` inside an isolated Shadow DOM container.
- **ADR-0006 (Hyper Sci-Fi HUD Design System)**: Glassmorphic cockpit, neon cyan/magenta gradients, and animated audio equalizer for controls, paired with gentle YouTube-style subtitles (`rgba(8, 8, 8, 0.84)`).
- **SegmentCache (Storage)**: Persistent browser IndexedDB storage using Jake Archibald's `idb` library for 0ms replay and zero token waste.
