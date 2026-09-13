# Strict Self-Hosted Backend-Only Architecture & Dead Code Purge

Status: accepted  
Date: 2026-09-13  
Supersedes: ADR-0001, ADR-0007, ADR-0009  
Extends: ADR-0010, ADR-0013  

---

## 1. Problem & Motivation

The AetherDub extension historically accumulated multiple translation providers (Gemini BYOK, OpenAI-compatible proxy, YouTube Caption Translation), speech synthesis engines (Edge TTS via Bing WebSocket, Web Speech API fallback, backend Piper/Edge), and speech recognition fallbacks (Groq Whisper STT). 

Maintaining these redundant paths caused several core issues:
1. **Bloated bundle size & technical debt**: Multiple HTTP and WebSocket clients, authentication handlers, and fallback branches that add maintenance overhead.
2. **Fragile resilience fallbacks**: Silent fallbacks (e.g. degrading to low-quality browser Web Speech API or switching models) confuse users and mask backend connectivity problems.
3. **Cluttered settings interface**: The Command Center and Options page required managing 4 separate API keys and numerous toggles.

With the operator running a dedicated Self-hosted Backend equipped with MarianMT (EN→VI) and ZeroTTS (`zeroweight-ai/ZeroTTS` CPU streaming synthesis), all external cloud dependencies and browser fallbacks are obsolete. The extension must be refactored into a lean, strict backend client.

---

## 2. Goals

- **100% Backend-Only Execution**: The extension communicates exclusively with the Self-hosted Backend for translation (`POST /v1/translate`) and speech synthesis (`POST /v1/tts`).
- **Dead Code Elimination**: Completely purge `GeminiTranslationClient`, `OpenAiCompatibleTranslationClient`, `GroqWhisperClient`, `WebSpeechFallback`, `ResilientTtsClient`, client-side `EdgeTtsClient` WebSocket, and YouTube Caption Translation fetchers.
- **Dedicated ZeroTTS Integration**: Route all TTS requests to the backend with voice parameters tailored for ZeroTTS (`engine="zerotts"` or voice presets like `maichi`), while supporting customizable voice keys.
- **Deterministic Failure UX**: When the backend is unreachable or the circuit breaker opens (3 consecutive failures), the Dub Track immediately pauses, the Cyber Cockpit displays `BACKEND OFFLINE`, and a **Retry** action resets the breaker and resumes playback without a page reload.
- **Single-Purpose UI**: Clean In-Page Command Center and Options Dashboard by stripping all third-party API key inputs and fallback checkboxes, leaving only Backend settings, Voice/Audio settings, and Subtitle display preferences.
- **Preserve YouTube Captions**: Native YouTube timedtext remains the sole source for dialogue extraction; videos lacking captions display `No Captions Available` without attempting audio STT.

---

## 3. Non-Goals

- Building or altering the backend Docker Compose implementation (the operator manages `server/` independently).
- Supporting multi-language translation pairs outside English → Vietnamese (Backend V1 is strictly EN→VI).
- Retaining backward-compatibility switches for cloud BYOK providers in the extension.

---

## 4. Architecture & Component Changes

```
┌────────────────────────────────────────────────────────────────────────┐
│                        YouTube Watch Page                              │
│                                                                        │
│  ┌───────────────────────┐             ┌────────────────────────────┐  │
│  │  Cyber Cockpit HUD    │             │   Parallel Caption Overlay │  │
│  │  [BACKEND OFFLINE]    │             │   (Bilingual / Sub-Only)   │  │
│  │  [Reconnect / Retry]  │             └────────────────────────────┘  │
│  └───────────▲───────────┘                                             │
│              │                                                         │
│  ┌───────────┴──────────────────────────────────────────────────────┐  │
│  │             DubbingOrchestrator & Coordinator                    │  │
│  │  - Source: YouTube Timedtext Only (No Whisper Fallback)          │  │
│  │  - Target: Locked to 'vi' (Tiếng Việt)                           │  │
│  │  - On Backend Error: Pause & notify HUD                          │  │
│  └───────────────────────────┬──────────────────────────────────────┘  │
└──────────────────────────────┼─────────────────────────────────────────┘
                               │
                chrome.runtime.sendMessage
                               │
┌──────────────────────────────▼─────────────────────────────────────────┐
│                    MV3 Service Worker (background.ts)                  │
│                                                                        │
│  ┌─────────────────────────┐             ┌──────────────────────────┐  │
│  │ BackendTranslation      │             │ BackendTtsRouter         │  │
│  │ Client                  │             │                          │  │
│  │ POST /v1/translate      │             │ POST /v1/tts (ZeroTTS)   │  │
│  │ (MarianMT EN→VI)        │             │ Circuit Breaker (max 3)  │  │
│  └───────────┬─────────────┘             └────────────┬─────────────┘  │
└──────────────┼────────────────────────────────────────┼────────────────┘
               │                                        │
               ▼                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Self-Hosted Backend (Docker)                       │
│  - POST /v1/translate (MarianMT EN→VI)                                 │
│  - POST /v1/tts       (ZeroTTS CPU Real-time Streaming, ~70ms TTFA)    │
│  - GET  /v1/health    (Health & Service Readiness)                     │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Translation Layer (`src/core/translation/`)
- Delete `gemini-client.ts`, `openai-client.ts`, `youtube-caption-translation.ts`.
- Simplify `factory.ts`: Always return an instance of `BackendTranslationClient`.
- Keep `BackendTranslationClient` with robust error messaging and auth headers.

### 4.2 TTS Layer (`src/core/tts/`)
- Delete `web-speech-fallback.ts`, `edge-tts-client.ts`, `sec-ms-gec.ts`.
- Update `backend-tts-router.ts`:
  - Ensure payload accommodates ZeroTTS engine and voices.
  - Return clean error codes (`BACKEND_OFFLINE`, `BACKEND_TTS_UNAVAILABLE`).
- Update `voices.ts`:
  - Provide default ZeroTTS presets (`maichi` / Mai Chi) alongside server-side neural options.

### 4.3 STT Layer (`src/core/stt/`)
- Delete `groq-whisper-client.ts` and `audio-stream.ts`.
- In `orchestrator-coordinator.ts`: Remove `tryWhisperTranscriptFallback` and `transcribeAudioViaBackground`. If caption fetch fails, immediately update HUD to `isNoCaptions: true`.

### 4.4 Settings & Storage (`src/storage/settings.ts`)
- Remove fields: `geminiApiKey`, `geminiModel`, `openaiEndpoint`, `openaiModel`, `openaiApiKey`, `groqApiKey`, `enableFallback`.
- `translationProvider`: Fixed to `'self-hosted'`.
- `targetLanguage`: Fixed to `'vi'`.
- `ttsProvider`: Default `'zerotts'` (or `'piper'` / `'edge'`).

### 4.5 UI Components (`src/components/`, `src/entrypoints/options/`)
- **CyberCockpit.tsx**:
  - Lock language selector to `Tiếng Việt [vi]`.
  - Add `BACKEND OFFLINE` indicator and `onRetry` handler when circuit breaker is tripped.
- **InPageCommandCenter.tsx & OptionsDashboard.tsx**:
  - Remove all input controls for Gemini, OpenAI, Groq, and Fallbacks.
  - Retain Backend URL, Backend API Key (Bearer), Ping Health, ZeroTTS Voice presets, Custom Voice Key, and Subtitle styling controls.

---

## 5. Verification & TDD Seams

1. **Unit Tests**:
   - `tests/backend-translation-client.test.ts`: Verify translation request formatting, auth header, and error handling.
   - `tests/backend-tts-router.test.ts`: Verify ZeroTTS payload generation, MP3 handling, and circuit breaker trip/reset behavior.
   - `tests/dubbing-orchestrator.test.ts`: Verify pipeline works cleanly with backend clients.
   - `tests/options-dashboard.test.tsx`: Verify clean UI renders without third-party inputs and correctly triggers backend ping.
2. **Quality Gates**:
   - `npm run typecheck` passes with zero TypeScript errors.
   - `npm test` passes all updated test suites.
