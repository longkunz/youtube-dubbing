---
status: accepted
date: 2026-09-13
---

# 14. GPU Hy-MT2 and CPU ZeroTTS for the Self-hosted Backend

We replaced the ADR-0010 CPU stack (CTranslate2 Opus-MT, Piper, Edge TTS, optional MMS) with a single translation model and a single TTS model and no server-side fallback. `POST /v1/translate` runs Tencent Hy-MT2-1.8B in-process with transformers BF16 on NVIDIA CUDA; source may be any Hy-MT2 language and target must be Vietnamese. `POST /v1/tts` runs ZeroTTS on CPU and returns MP3; voice must be one of the eight published ZeroTTS ids. Missing GPU leaves translate unavailable (503) rather than loading a second MT model. This supersedes ADR-0010.
