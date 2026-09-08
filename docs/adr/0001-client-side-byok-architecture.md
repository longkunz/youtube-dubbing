# 1. 100% Client-Side Architecture with BYOK (Bring Your Own Key)

We decided to build the YouTube Dubbing extension entirely client-side using Web Extension Manifest V3, without a dedicated backend server. Translation and optional STT rely on user-supplied API keys (Gemini, OpenAI, Groq), while TTS leverages Microsoft Edge TTS (or premium user keys). This eliminates server hosting and operational costs, scales infinitely at zero marginal cost to the maintainer, and ensures user privacy, at the cost of requiring users to supply API keys and handling browser-level network constraints directly.
