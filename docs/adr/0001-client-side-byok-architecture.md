---
status: accepted
date: 2026-09-08
---

# 1. Client Architecture with Optional BYOK (amended)

We decided to ship the YouTube Dubbing extension as a Manifest V3 client that does **not** require a vendor SaaS. The default topology is an operator-run **Self-hosted Backend** (ADR-0010) for EN→VI translation and MP3 TTS. BYOK Gemini, OpenAI-compatible proxies, and Groq Whisper remain optional. Chrome must not speak Microsoft Edge TTS over Bing WebSocket; Edge TTS, when used, runs inside the Self-hosted Backend. The extension remains the clock (caption fetch, DubbingOrchestrator, Audio Ducking, Segment Cache).
