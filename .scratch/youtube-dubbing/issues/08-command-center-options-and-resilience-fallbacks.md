# 08: Command Center Options Dashboard & Resilience Fallbacks

**What to build:** The standalone Command Center options page and system-wide error fallbacks. Features secure API key management for Gemini and Groq/OpenAI with a live "Ping Connection" test, TTS calibration, and cache storage management. Implements resilient error handling: unobtrusive notification when a video lacks subtitles, graceful fallback to Web Speech API if Edge-TTS is unreachable, and direct settings shortcuts on API quota exhaustion.

**Blocked by:** 01: Project Foundation & Shadow DOM In-Player HUD Mount, 03: Upfront Translation Pipeline with Gemini Flash, 05: Persistent Local Audio & Transcript Cache (IndexedDB)

**Status:** ready-for-agent

- [ ] Standalone options page rendered with Hyper Sci-Fi Command Center aesthetic using React and TailwindCSS.
- [ ] Secure input fields mask and save Gemini and Groq/OpenAI API keys in `chrome.storage.local`.
- [ ] "Ping Connection" button sends a lightweight test request to Gemini API and reports round-trip latency.
- [ ] Cache metrics card displays stored video count and MB usage with a working "Purge Local Cache" button.
- [ ] Friendly in-player notification displays when a video has no captions, recommending STT setup.
- [ ] Automatic fallback to Web Speech API engages if Edge-TTS WebSocket is blocked or fails 3 consecutive retries.
- [ ] Automated tests verify options page credential saving, ping validation, and error fallback handlers.
