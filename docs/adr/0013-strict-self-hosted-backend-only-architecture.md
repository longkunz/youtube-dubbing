---
status: accepted
date: 2026-09-13
---

# 13. Strict Self-Hosted Backend-Only Architecture

We eliminated all external third-party cloud service clients and fallback mechanisms from the Chrome extension, consolidating 100% of machine translation and speech synthesis onto the Self-hosted Backend. Gemini BYOK, OpenAI-compatible proxy, Groq Whisper STT fallback, browser Web Speech API fallback, and client-side Edge TTS WebSocket implementations are fully purged from the codebase. Translation is exclusively handled by `POST /v1/translate` (MarianMT EN→VI), locking target language support to Vietnamese (`vi`). Speech synthesis is routed exclusively to `POST /v1/tts` powered by ZeroTTS (`zeroweight-ai/ZeroTTS`) on CPU, providing real-time zero-shot Vietnamese streaming synthesis (~70ms TTFA). When the backend is offline or errors, the Dub Track immediately pauses with a distinct `BACKEND OFFLINE` indicator on the Cyber Cockpit HUD, enabling direct reconnect and circuit breaker recovery upon retry without full page reloads or silent degradation into lower-quality synthetic speech.
