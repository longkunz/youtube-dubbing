---
status: accepted
date: 2026-09-09
---

# 7. Pluggable Multi-Provider Translation Engine with OpenAI-Compatible Proxy Support

We decided to decouple the translation subsystem into a pluggable provider interface (`TranslationClient`), supporting both Google Gemini and an OpenAI-compatible proxy gateway (`/v1/chat/completions`).

Users can connect custom proxy endpoints (e.g. self-hosted Ollama, vLLM, OpenRouter, DeepSeek, or private API gateways) with custom base URLs, model identifiers, and optional bearer tokens, bypassing commercial API fees.

The system maintains unified prompt engineering across providers, requiring structured JSON output and conversational speaker diarization (`speakerGender: 'female' | 'male'`), while gracefully degrading when optional features (like `response_format: { type: 'json_object' }`) are not supported by the proxy.

Network calls support extension-level CORS bypass via background execution and expanded host permissions (`<all_urls>`).
