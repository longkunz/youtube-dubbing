---
status: accepted
date: 2026-09-12
---

# 10. Self-hosted CPU backend for EN→VI translation and TTS

We added an operator-run Docker Compose service (FastAPI, CPU only) exposing `POST /v1/translate` (CTranslate2 Opus-MT en-vi) and `POST /v1/tts` (Piper, then Edge TTS on the server). The Chrome extension no longer uses Bing WebSocket for TTS. New installs default to Translation Provider `self-hosted`. Gemini, OpenAI-compatible, and YouTube Caption Translation remain explicit choices. GPU is unused. The documented run path is `docker compose up --build` on any Linux Docker host.
