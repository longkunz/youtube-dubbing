# Self-hosted translation & TTS backend (EN→VI, CPU Docker)

Status: accepted  
Date: 2026-09-12  
Supersedes in part: ADR-0001 (client-only BYOK as the only topology)  
Related: ADR-0003, ADR-0007, ADR-0008, ADR-0009

## 1. Problem

The extension already has a working Dub Track (caption → Sentence Restructuring → translation → Sliding Window TTS → Audio Ducking / Time Stretching → Segment Cache). Two engines on the **happy path** are unofficial and interrupt playback on Chrome:

1. **Microsoft Edge Neural TTS** over WebSocket (`speech.platform.bing.com`, `Sec-MS-GEC`) from the MV3 service worker. Chrome cannot set handshake headers reliably; sockets drop; the in-extension Web Speech fallback returns a fake `Blob` and is disconnected on the hot path (`background.ts` constructs `EdgeTtsClient({ enableFallback: false })`). Settings `ttsProvider` / `enableFallback` are stored but not honored.
2. **YouTube Caption Translation (`tlang`)** is an opt-in provider (ADR-0009), not the default. Default LLM translation (Gemini BYOK) is fine when a key exists, but it is not a zero-key, self-owned path.

The product goal is a **self-hosted default** that returns real MP3 so the existing player does not change, runs in **one Docker Compose on any Linux Docker host** (CPU, GPU unused), and keeps Gemini / YouTube Caption Translation as explicit choices.

## 2. Goals

- Default new installs use a self-hosted backend for **EN→VI translation** and **all TTS**.
- TTS never opens Bing WebSocket from Chrome. Edge TTS, if used, runs **inside the backend**.
- OSS models on CPU: CTranslate2 Opus-MT for translate, Piper for TTS, Edge TTS as server-side fallback.
- One command to run: `docker compose up --build`. No NVIDIA runtime, no Hyper-V requirement, no GPU.
- Chrome on Windows Server (or any desktop) only needs `backendUrl` pointing at the Docker host.
- Gemini, OpenAI-compatible, and YouTube Caption Translation remain selectable. No automatic jump to Gemini when the backend is down.
- DubbingOrchestrator, Playback Sync Engine, Audio Ducking, Segment Cache, On-Demand Activation stay the clock.

## 3. Non-goals (V1)

- GPU / CUDA / nvidia-container-toolkit
- Language pairs other than English → Vietnamese
- Uploading video or audio to the server
- Self-hosted Whisper / ASR (Groq Whisper Fallback stays as today)
- NLLB, LibreTranslate, Kokoro, XTTS
- Cloudflare Worker, multi-tenant billing, public SaaS
- Making YouTube Caption Translation or Web Speech the TTS happy path
- Rewriting HUD, Shadow DOM, or caption extraction
- Fake audio blobs for Web Speech inside `syncEngine`

## 4. Constraints

- Personal use (one operator). Still require a Bearer token so an open port is not an open TTS proxy.
- CPU only. GPU may exist on the Docker host; V1 must not reference it.
- Easy run beats extra quality. Hyper-V Ubuntu is optional, not the documented default.
- Existing `host_permissions` already include `*://*/*`; no extra optional-permission flow for the backend URL.
- Saved user settings must not be silently rewritten: only **missing** `translationProvider` / fresh installs default to `self-hosted`. A stored `gemini` value stays `gemini`.
- V1 translate rejects non EN→VI with HTTP 400. TTS voices other than the Vietnamese Neural/Piper set still synthesize if Piper/Edge can, but the documented path is `vi-VN`.

## 5. Architecture

```
YouTube watch page (content script)
  clock, seek, pause, volume, HUD, Preparation Overlay
        │
Background service worker
  ├─ TRANSLATE_SEGMENTS
  │    self-hosted → POST {backendUrl}/v1/translate
  │    gemini / openai-compatible → existing clients
  │    youtube-caption-translation → not this client (caption path)
  └─ SYNTHESIZE_TTS
       always → POST {backendUrl}/v1/tts     (unless ttsProvider is web-speech)
        │
Docker Compose on any Linux Docker host (CPU)
  FastAPI :8787
  ├─ /v1/translate   CTranslate2 int8  Helsinki-NLP/opus-mt-en-vi
  ├─ /v1/tts         Piper vi_VN-vais1000-medium → timeout/fail → edge-tts
  ├─ /v1/health
  ├─ disk cache      models/  cache/
  └─ BACKEND_API_KEY
```

The backend is a **deep module** behind two HTTP endpoints. The extension keeps DubbingOrchestrator as the highest pipeline seam. A `BackendClient` in the service worker is the only module that knows the URL and token.

### 5.1 Responsibility split

| Concern | Extension | Backend |
|---|---|---|
| videoId, clock, seek, pause, rate | Yes | No |
| Caption Track fetch, Sentence Restructuring | Yes | No |
| EN→VI batch of merged cue text | If provider `self-hosted` | Yes |
| Gemini / OpenAI / YouTube CC | Yes (unchanged) | No |
| Neural/Piper MP3 | No | Yes |
| Edge TTS unofficial protocol | **No (V1)** | Yes, fallback only |
| IndexedDB Segment Cache | Yes | Disk cache of raw MP3/text too |
| Audio Ducking / Time Stretching | Yes | No |

## 6. HTTP contract

Base URL is operator-configured. All mutating routes require:

```
Authorization: Bearer <BACKEND_API_KEY>
```

Missing/wrong token → `401`. Oversized body → `413`.

### 6.1 `GET /v1/health`

Unauthenticated. Reports process liveness and engine state. Does not leak the API key.

```json
{
  "ok": true,
  "translate": "ready",
  "tts": "piper",
  "ttsFallback": "edge-tts",
  "breaker": "closed"
}
```

`tts` values: `piper` | `piper-only` (Edge breaker open) | `unavailable`.  
`breaker` values: `closed` | `open`.

Command Center Ping: `GET /v1/health` (up/down, `tts` mode) then `POST /v1/translate` with one cue `{ id: "ping", text: "ok" }` using the saved Bearer. Show latency, health `tts`, and whether the key was accepted (`401` vs `200`).

### 6.2 `POST /v1/translate`

Request:

```json
{
  "source": "en",
  "target": "vi",
  "cues": [
    { "id": "12", "text": "Welcome back" }
  ]
}
```

Rules:

- `cues.length` 1–50. Empty list → `400`.
- Each `text` max 2000 characters.
- `source`/`target` must be `en`/`vi` (case-insensitive, allow `en-US` → `en`, `vi-VN` → `vi`). Anything else → `400` with message that V1 is EN→VI only.
- If `source` language equals `target`, or a cue text is empty, return that cue unchanged.
- Response preserves `id` order.

```json
{
  "items": [
    { "id": "12", "text": "Chào mừng quay lại" }
  ]
}
```

Cache key: `sha256(source|target|text)`. Do not cache empty text.

### 6.3 `POST /v1/tts`

Request:

```json
{
  "text": "Chào mừng quay lại",
  "lang": "vi-VN",
  "voice": "vi-VN-HoaiMyNeural",
  "rate": "+0%",
  "format": "mp3"
}
```

Rules:

- `text` required, max 500 characters after trim. Empty → `400`.
- `format` must be `mp3` in V1.
- `voice` is a hint for **Edge TTS fallback only**: ids containing `NamMinh` → `vi-VN-NamMinhNeural`; otherwise `vi-VN-HoaiMyNeural`. Piper V1 always uses `vi_VN-vais1000-medium` (single voice).
- Response: `Content-Type: audio/mpeg`, raw body (not JSON).
- Cache key: `sha256(text|voice|rate|format)`.

### 6.4 TTS engine sequence (server)

1. Cache hit → return bytes.
2. Piper `vi_VN-vais1000-medium` (CPU). Hard timeout **2.5s** after process start of that utterance.
3. On timeout, non-zero exit, or empty audio → `edge-tts` with `vi-VN-HoaiMyNeural` or `vi-VN-NamMinhNeural`, rate mapped into Edge rate string. Timeout **8s**.
4. Success → write cache, return MP3.
5. Three consecutive Edge TTS failures **in-process** → breaker `open`, `health.tts = piper-only`. Subsequent requests skip Edge and fail if Piper fails, until process restart (V1 has no timer reset; document that `compose restart` clears it).
6. Never return a dummy body.

Convert Piper WAV → MP3 with ffmpeg in the image.

## 7. Backend implementation shape

Directory (same git repo):

```
server/
  Dockerfile
  compose.yml
  .env.example
  pyproject.toml
  app/
    main.py              # FastAPI routes
    auth.py
    translate.py         # CTranslate2 wrapper
    tts.py               # Piper then edge-tts, breaker, cache
    cache.py             # filesystem blobs
  scripts/
    download-models.sh   # opus-mt ct2 + piper onnx + piper binary
  models/                # gitignored
  cache/                 # gitignored
```

`compose.yml`:

- Service `api`, image built from `server/Dockerfile`, platform `linux/amd64`.
- Ports `8787:8787`.
- Env: `BACKEND_API_KEY`, `PIPER_VOICE`, `CT2_MODEL_DIR`.
- Volumes: `./models:/models`, `./cache:/cache`.
- **No** GPU reservation, **no** nvidia runtime.
- `restart: unless-stopped`.
- Entry: download models if missing, then uvicorn.

`.env.example`:

```
BACKEND_API_KEY=change-me
```

Run book (only documented path):

```bash
cd server
cp .env.example .env   # set BACKEND_API_KEY
docker compose up --build
```

Operator sets the extension `backendUrl` to `http://<docker-host-ip>:8787`.

Windows Server is a **client**. If Docker runs on another machine on the LAN, that is the intended topology. Hyper-V Ubuntu on the same box is supported only because it is also “a Linux Docker host”.

## 8. Models

| Role | Artifact | Why |
|---|---|---|
| Translate | `Helsinki-NLP/opus-mt-en-vi` converted to CTranslate2 int8 | Small, Apache-2.0, CPU, EN→VI only |
| TTS primary | Piper `vi_VN-vais1000-medium` | CPU, offline, real WAV |
| TTS fallback | Python `edge-tts` (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`) | Official-enough quality; headers set in Linux, not Chrome |
| Encode | ffmpeg in image | WAV→MP3 for the existing Blob player |

Do not load a second MT model in V1. Do not pin GPU device IDs.

## 9. Extension changes

### 9.1 Settings

`TranslationProvider` becomes:

`'self-hosted' | 'gemini' | 'openai-compatible' | 'youtube-caption-translation'`

New fields on `UserSettings`:

- `backendUrl: string` — default `http://127.0.0.1:8787`
- `backendApiKey: string` — default empty

`ttsProvider` becomes `'backend' | 'web-speech'`. Default `'backend'`. Remove `'edge-tts'` as a stored happy-path value. If an old profile has `ttsProvider: 'edge-tts'`, treat it as `'backend'` at read time (migration in `getSettings`).

`DEFAULT_USER_SETTINGS.translationProvider` = `'self-hosted'`. `getSettings` merge: only fill defaults for **absent** keys so an existing `gemini` install does not flip.

`enableFallback` remains in storage but V1 meaning is: unused for Chrome Edge TTS (that path is gone). Do not re-enable `speech.platform.bing.com` from the worker.

### 9.2 Translation factory

`createTranslationClient`:

- `self-hosted` → `BackendTranslationClient` implementing existing `TranslationClient` (`translateSegments` / `translateTranscript`). Maps `Segment.id` + `sourceText` to cues; writes `translatedText`. Does **not** invent `speakerGender`.
- `openai-compatible` / default Gemini unchanged.
- YouTube Caption Translation still **not** a `TranslationClient` (ADR-0009).

Unknown provider still constructs Gemini (keep current factory behavior) **except** the explicit `'self-hosted'` value.

### 9.3 Background TTS

`SYNTHESIZE_TTS` in `src/entrypoints/background.ts`:

1. Load settings. If `ttsProvider === 'web-speech'`, return a structured error `WEB_SPEECH_REQUIRED` so the content script can speak via `WebSpeechFallback` **without** feeding a dummy blob into `syncEngine`.
2. Otherwise `POST {backendUrl}/v1/tts` with Bearer, 8s fetch timeout (utterance already timed out server-side; this is the HTTP budget).
3. On success, return base64 MP3 as today.
4. Session breaker: 3 consecutive HTTP/network failures → stop calling until the tab’s pipeline is stopped or Ping succeeds. Respond `BACKEND_TTS_UNAVAILABLE`. Orchestrator skips the cue (existing no-blob branch: unduck, no stacked voices).
5. **Delete** the worker-level `new EdgeTtsClient({ enableFallback: false })` happy path. Do not call `EdgeTtsClient` from Chrome in V1.
6. `BackgroundDubbingTtsClient` must not fall back to in-page `EdgeTtsClient` on messaging failure for synthesis (today it does). Messaging failure → treat as unavailable, skip cue.

Content-script `speechSynthesis` is allowed only when the user selected `web-speech`, as a degraded engine outside Time Stretching.

### 9.4 Coordinator

`startDubbingPipeline` already branches YouTube Caption Translation vs LLM `translateViaBackground`. `translateViaBackground` already uses `createTranslationClient(settings)` in the worker — `self-hosted` flows through that without a third branch if the factory is correct.

HUD `resolveEngineLabel`: `self-hosted` → `SELF-HOST`.

Preparation Overlay / On-Demand Activation unchanged. Cache keys already include Translation Provider — `self-hosted` is a new distinct key. Legacy entries without provider remain Gemini (ADR-0009 migration).

### 9.5 Command Center

- Dropdown option **Self-hosted** (default for new installs).
- Fields: Backend URL, API key, Ping (health + one-cue translate).
- When Self-hosted is selected, Gemini key/Ping are not required (hide/disable; keep stored values), same pattern as YouTube Caption Translation.
- TTS engine control: Backend (default) vs Web Speech (degraded). No “Edge TTS (Chrome)” option.
- Save persists `backendUrl` / `backendApiKey` / provider.

### 9.6 Manifest

Keep `*://*/*`. Remove `https://speech.platform.bing.com/*` and `wss://speech.platform.bing.com/*` from `wxt.config.ts` once the Chrome Edge client is unused (avoids implying a Bing dependency).

## 10. Failure modes

| Event | Behavior |
|---|---|
| Docker host down / wrong URL | Ping fails. `self-hosted` dubbing → in-player notification, no Gemini auto-switch |
| Bad Bearer | `401` on translate/tts. Banner: check API key |
| Non EN→VI on `/v1/translate` | `400`. Banner: V1 is EN→VI; pick Gemini or YouTube CC |
| Piper timeout | Server uses Edge TTS; extension still gets one MP3 |
| Edge TTS fails ×3 on server | `health.tts = piper-only`; no Chrome Bing |
| `/v1/tts` fails ×3 on extension | Session breaker, skip cues, banner |
| Seek / pause | Existing orchestrator: cancel in-flight, keep caches |
| VM/host reboot | Models reload from volume; disk TTS/translate cache survives |
| User picks Gemini while backend TTS is up | LLM translate + backend MP3 (intended) |
| User picks YouTube CC | Caption acquisition + backend MP3 |
| User picks Web Speech TTS | Degraded utterance path; no Time Stretching |

Do not log full cue text at info level on the server. Log cue id, character count, cache hit/miss, engine used.

## 11. Testing

### Extension (Vitest, existing seams)

- Factory: `translationProvider: 'self-hosted'` constructs backend client; Gemini fetch is not called.
- Backend client: maps segments → cues, applies `items` onto `translatedText` by id.
- Background TTS: mocked `fetch` returns MP3 bytes; 3 failures trip breaker; `EdgeTtsClient` is not constructed.
- Old settings `ttsProvider: 'edge-tts'` reads as `'backend'`.
- Fresh defaults: `translationProvider === 'self-hosted'`.
- Stored `gemini` is preserved when other keys update.
- Options dashboard: Self-hosted option, Ping calls health, Gemini fields not required.
- HUD label `SELF-HOST`.
- Segment Cache key includes `self-hosted`.
- Coordinator YouTube CC path still does not call `TranslationClient`.

### Server (pytest)

- Translate preserves ids; EN→VI only; other pairs 400; empty text passthrough.
- Wrong Bearer → 401; health 200 without Bearer.
- TTS: Piper success writes cache; second call does not invoke Piper.
- Piper failure invokes `edge-tts` once and returns audio bytes.
- Edge failure ×3 → breaker; next request does not call Edge.
- Text over 500 chars → 400.
- Batch over 50 cues → 400.

No live Microsoft or Hugging Face calls in CI. Inject fakes for Piper/CTranslate2/edge-tts.

## 12. Docs to update when implementing

- `docs/adr/0001-client-side-byok-architecture.md` — amend: no vendor SaaS required; **self-hosted backend is the default topology**; BYOK Gemini/OpenAI/Groq remain optional; Chrome must not speak Edge TTS.
- New `docs/adr/0010-self-hosted-cpu-backend.md` — this design.
- `docs/adr/0007-pluggable-translation-openai-compatible-proxy.md` — `TranslationClient` gains a self-hosted adapter; YouTube CC stays outside that interface.
- `docs/SPEC.md`, `CONTEXT.md`, README run instructions, `.agents/memory/tech-decisions.md`.
- Glossary: **Self-hosted Backend** — operator-run Docker service exposing `/v1/translate` and `/v1/tts`. Avoid: “the API”, “cloud”, “our server”.

## 13. Implementation slices (after spec approval)

Do not start these until the human accepts this file.

1. **Server skeleton** — FastAPI, auth, health, compose, model download script, pytest fakes.
2. **Translate engine** — CTranslate2 wrapper + `/v1/translate` contract tests.
3. **TTS engine** — Piper → Edge fallback, cache, breaker, ffmpeg MP3.
4. **Extension BackendTranslationClient + factory + settings/migration + tests**.
5. **Background TTS router** — drop Chrome Edge happy path, breaker, tests.
6. **Command Center + HUD label + banners**.
7. **Docs/ADR/SPEC/README**.

Slice 1+2+3 is independently runnable with curl. Slice 4–6 is independently testable in Vitest without Docker.

## 14. Acceptance

- `docker compose up --build` on a Linux Docker host with no GPU flags yields `GET /v1/health` → `ok: true`.
- Chrome on another OS (Windows Server included) dubs an English-captioned YouTube video to Vietnamese for 10 minutes **without** opening `wss://speech.platform.bing.com`.
- Seek re-syncs Dub Track in under 2 seconds using cached MP3 when cues were already synthesized.
- Stopping Docker shows a clear in-player failure for `self-hosted` translate; Gemini is not called unless the user selected it.
- Switching Command Center to Gemini still uses `/v1/tts` for speech.
- Piper failure on the server still returns playable MP3 via Edge TTS (verified with a fake Piper in tests; live check optional on the operator machine).

## 15. Decisions locked

| Question | Decision |
|---|---|
| Topology | Two HTTP APIs, one Compose service, CPU |
| Where Docker runs | Any Linux Docker host; easiest box wins |
| GPU | Off. Unused even if present |
| Win Server Hyper-V | Not required |
| Translate model | CTranslate2 Opus-MT en-vi |
| TTS | Piper then Edge TTS **on the server** |
| Chrome Edge TTS | Removed from happy path |
| Default provider (new install) | `self-hosted` |
| Gemini / YouTube CC | Remain explicit choices |
| Auto-fallback translate to Gemini | No |
| V1 languages | EN→VI only |
| Auth | Single Bearer token |
