---
type: project
created: 2026-09-08
updated: 2026-09-08
---

# Technical Decisions Summary

- **ADR-0001 (100% Client-Side BYOK)**: Zero backend server; user provides Gemini API key; Edge TTS accessed via Background Service Worker WebSocket.
- **ADR-0002 (Volume Lerp for Ducking)**: Direct `HTMLMediaElement.volume` interpolation (150ms) to avoid YouTube cross-origin audio CORS blockage. Equalizer is event-driven rather than a live PCM FFT analyzer.
- **ADR-0003 (Pre-Translation + Sliding Window TTS)**: Translate complete transcript upfront with the configured Gemini Flash model (default `gemini-3.8-flash`, 404 fallback chain) for global context; synthesize TTS in rolling 30–60s lookahead window. Lifecycle shifted to on-demand by ADR-0008.
- **ADR-0007 (Pluggable Translation)**: Gemini or OpenAI-compatible `/v1/chat/completions` proxy.
- **ADR-0008 (On-Demand Activation)**: Dormant mount; cache-hit fast path; pause-and-buffer with Preparation Overlay on cache miss.
- **Target language**: Cyber Cockpit selection is persisted and used for SegmentCache keys and translation, not hardcoded `vi`.
- **Whisper Fallback**: Groq Whisper only after caption fetch fails, and only for unsigned `streamingData` audio URLs. Netflix / lip-sync / paid TTS remain out of scope.
- **ADR-0004 (Shadow DOM In-Player Controls)**: Injected directly into `.ytp-right-controls` inside an isolated Shadow DOM container.
- **ADR-0006 (Hyper Sci-Fi HUD Design System)**: Glassmorphic cockpit, neon cyan/magenta gradients, and animated audio equalizer for controls, paired with gentle YouTube-style subtitles (`rgba(8, 8, 8, 0.84)`).
- **SegmentCache (Storage)**: Persistent browser IndexedDB storage using Jake Archibald's `idb` library for 0ms replay and zero token waste.
