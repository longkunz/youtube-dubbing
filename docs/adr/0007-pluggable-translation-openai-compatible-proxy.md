---
status: accepted
date: 2026-09-09
---

# 7. Pluggable Multi-Provider Translation Engine with OpenAI-Compatible Proxy Support

We decided to decouple the translation subsystem into a pluggable provider interface (`TranslationClient`), supporting Google Gemini, an OpenAI-compatible proxy gateway (`/v1/chat/completions`), and a Self-hosted Backend adapter (`POST /v1/translate`). YouTube Caption Translation remains outside this interface (ADR-0009).

Users can connect custom proxy endpoints (e.g. self-hosted Ollama, vLLM, OpenRouter, DeepSeek, or private API gateways) with custom base URLs, model identifiers, and optional bearer tokens, bypassing commercial API fees.

The system maintains unified prompt engineering across providers, requiring structured JSON output and conversational speaker diarization (`speakerGender: 'female' | 'male'`), while gracefully degrading when optional features (like `response_format: { type: 'json_object' }`) are not supported by the proxy.

Network calls support extension-level CORS bypass via background execution and expanded host permissions (`<all_urls>`).
