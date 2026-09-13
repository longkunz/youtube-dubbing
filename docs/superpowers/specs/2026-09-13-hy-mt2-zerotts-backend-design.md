# Hy-MT2 + ZeroTTS Self-hosted Backend

Status: accepted  
Date: 2026-09-13  
Supersedes: ADR-0010 (CPU Opus-MT + Piper/Edge TTS)  
Related: ADR-0013, `docs/superpowers/specs/2026-09-13-strict-backend-only-design.md` (extension; out of this ticket)

## 1. Problem

The Self-hosted Backend (`server/`) still implements ADR-0010: CTranslate2 Opus-MT EN→VI, Piper (or MMS on CUDA), then Edge TTS with a circuit breaker. That stack is the wrong quality/weight trade-off:

- Opus-MT is EN→VI only and needs a stutter-collapse hack.
- Piper + Edge + MMS is three TTS engines, a breaker, and a CUDA probe that exists only as a silent fallback.
- The Dockerfile already pulls PyTorch CUDA while ADR-0010 forbids GPU as the documented path.

The operator has an NVIDIA GPU and wants one translation model and one TTS model, no fallbacks. Chosen engines:

- Translate: [tencent/Hy-MT2-1.8B](https://huggingface.co/tencent/Hy-MT2-1.8B) (transformers, BF16, CUDA).
- TTS: [zeroweight-ai/ZeroTTS](https://github.com/zeroweight-ai/ZeroTTS) (ONNX CPU, eight Vietnamese presets).

A separate extension ticket (`strict-backend-only`) will send ZeroTTS voice ids and drop Web Speech / Edge / Piper UI. This spec is **`server/` only**. Until that ticket lands, the current extension still posts `voice: vi-VN-HoaiMyNeural`; this backend will return **400** for that id (explicit, no compatibility map).

## 2. Goals

- Replace the translate engine with Hy-MT2-1.8B in-process in FastAPI (no vLLM sidecar, no GGUF).
- Replace the TTS engine with ZeroTTS in-process (no Piper, Edge TTS, MMS, or breaker).
- Keep `POST /v1/translate`, `POST /v1/tts`, `GET /v1/health`, Bearer auth, MP3 response body, cue batch ≤ 50, 500-character TTS clip.
- Accept any Hy-MT2 source language; **target must be Vietnamese**.
- Accept only the eight ZeroTTS voice ids. Unknown or missing `voice` → 400.
- Fail loud: engine errors and delimiter-count mismatches are **502**, never a second model.
- One Compose service with GPU. `docker compose up --build` remains the run path.

## 3. Non-goals

- Any change under `src/`, `tests/*.ts`, HUD, Command Center, Voice Profile picker, client TTS timeout (frontend ticket: 30s, hardcoded eight voices).
- `GET /v1/voices`.
- Mapping `vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural` to ZeroTTS ids.
- Streaming PCM/WAV to the extension (V1 remains one-shot MP3).
- Voice cloning (ZeroTTS encoder is unpublished).
- vLLM, SGLang, llama.cpp, Hy-MT2-7B/30B, FP8.
- Changing Gemini / OpenAI-compatible / YouTube Caption Translation in the extension (this ticket does not touch them).
- Whisper / ASR.

## 4. Constraints

- NVIDIA GPU required to load Hy-MT2. No CUDA → translator stays unloaded → `/v1/translate` is 503. ZeroTTS still loads on CPU.
- Personal operator, Bearer token required on mutating routes.
- Existing `create_app(api_key, translator, tts_engine)` injection stays the test seam.
- Hy-MT2 official sampling for 1.8B: `temperature=0.7`, `top_p=0.6`, `top_k=20`, `repetition_penalty=1.05`. No system prompt.
- ZeroTTS `synthesize()` does not normalize text; this backend **must** call `normalize_vi_text` before synthesis.
- ffmpeg remains in the image for WAV → MP3 `libmp3lame` 128k.

## 5. Architecture

```
Extension (unchanged in this ticket)
  POST {backendUrl}/v1/translate
  POST {backendUrl}/v1/tts
        │
Docker Compose (linux, NVIDIA runtime)
  FastAPI :8787
  ├─ /v1/translate   Hy-MT2-1.8B transformers BF16 CUDA (one GPU lock)
  ├─ /v1/tts         ZeroTTS ONNX CPU → ffmpeg MP3
  ├─ /v1/health      ok, translate, tts  (no ttsFallback, no breaker)
  ├─ FileCache       /cache
  └─ HF_HOME         /models/hf-cache
```

One process. Hy-MT2 occupies GPU; ZeroTTS occupies CPU. Concurrent translate requests serialize on a process-wide GPU lock. Concurrent TTS requests serialize on a process-wide ZeroTTS lock (`onnxruntime` is not assumed thread-safe). TTS runs via `asyncio.to_thread` with a **25s** synthesize ceiling (frontend fetch timeout will be 30s).

### 5.1 Module shape (`server/`)

| File | After this ticket |
|---|---|
| `app/main.py` | Routes; health without fallback fields; TTS 400 on bad voice |
| `app/translate.py` | `HyMt2Translator` (delimiter batch). Remove Marian/CTranslate2/stutter collapse |
| `app/tts.py` | `TtsEngine` wrapping ZeroTTS + ffmpeg. No Piper/Edge/breaker |
| `app/runtime.py` | Load Hy-MT2 on CUDA if present; load ZeroTTS always. No MMS |
| `app/lang.py` | `normalize_lang` plus Hy-MT2 code set and English display names |
| `app/cache.py` | Unchanged |
| `Dockerfile` | torch CUDA + transformers≥5.6 + zerotts. Drop ct2/piper/edge-tts install path as the engine |
| `compose.yml` | `gpus: all` (or Compose `deploy.resources.reservations.devices`) |
| `scripts/download-models.sh` | Snapshot `tencent/Hy-MT2-1.8B` and `zeroweight-ai/ZeroTTS` into `HF_HOME` |
| `pyproject.toml` | fastapi, uvicorn, zerotts; drop ctranslate2, piper-tts, edge-tts as required deps |

## 6. HTTP contract

Mutating routes: `Authorization: Bearer <BACKEND_API_KEY>`. Missing/wrong → 401.

### 6.1 `GET /v1/health`

Unauthenticated.

```json
{
  "ok": true,
  "translate": "ready",
  "tts": "ready"
}
```

`translate` / `tts`: `ready` | `unavailable`.  
Do **not** emit `ttsFallback` or `breaker`.

### 6.2 `POST /v1/translate`

Request (unchanged shape):

```json
{
  "source": "en",
  "target": "vi",
  "cues": [{ "id": "12", "text": "Welcome back" }]
}
```

Rules:

- `cues` must be a non-empty list, length ≤ 50. Each `text` ≤ 2000 characters.
- `normalize_lang` as today (strip region: `en-US` → `en`, `vi-VN` → `vi`). **Exception documented:** `zh-Hant` collapses to `zh`; Traditional Chinese is not a distinct V1 source code.
- `target` must be `vi`. Anything else → 400 (`target must be vi`).
- `source` must be in the Hy-MT2 primary-code set below. Unknown → 400 (`unsupported source language`).
- `source == target == vi`: echo each cue `id`/`text` (stripped), do not call the model.
- Empty/whitespace cue: echo `""`, exclude from the model batch.
- Preserve `id` order in `items`.

Response:

```json
{
  "items": [{ "id": "12", "text": "Chào mừng quay lại" }]
}
```

Errors: translator unloaded → 503; generation failure or delimiter count mismatch → 502 (`translation failed` / `delimiter count mismatch`). Do not retry per-cue.

### 6.3 Delimiter batch (Hy-MT2)

Join non-empty cue texts with a delimiter line that is **exactly** `<CUESEP>` on its own line:

```
Welcome back
<CUESEP>
Hello
```

User prompt (English names, official Delimiters instruction, no system prompt):

```
Please accurately translate the following text into Vietnamese.
You must retain the exact same number of delimiters in the translation. Strictly do not omit, escape, or translate these symbols, and pay close attention to their placement.

{joined}
```

`{target_lang}` is always the English name `Vietnamese`. Source language is not required in this instruction (Hy-MT2 infers it).

After `generate`, split the output on the literal token `<CUESEP>` (not only whole-line matches) and trim each piece. If the number of pieces ≠ number of non-empty input cues → 502, do not write cache. Empty pieces after split still count.

Sampling: `max_new_tokens` large enough for 50 cues (cap 4096 as in the model card). Decode only new tokens.

GPU: hold the translate lock for the entire `generate` call.

### 6.4 Hy-MT2 source codes (after `normalize_lang`)

`ar`, `bn`, `bo`, `cs`, `de`, `en`, `es`, `fa`, `fr`, `gu`, `he`, `hi`, `id`, `it`, `ja`, `kk`, `km`, `ko`, `mn`, `mr`, `ms`, `my`, `nl`, `pl`, `pt`, `ru`, `ta`, `te`, `th`, `tl`, `tr`, `ug`, `uk`, `ur`, `vi`, `yue`, `zh`.

Prompt English names live in a single dict next to that set (e.g. `en` → `English`, `zh` → `Chinese`, `vi` → `Vietnamese`).

### 6.5 `POST /v1/tts`

Request:

```json
{
  "text": "Chào mừng quay lại",
  "lang": "vi-VN",
  "voice": "maichi",
  "rate": "+0%",
  "format": "mp3",
  "engine": "piper"
}
```

Rules:

- `text` required after trim. Empty → 400. Longer than 500 characters: truncate at last space before 500 (same as today), not an error.
- `format` missing or `mp3` (case-insensitive). Any other value → 400 (`format must be mp3`).
- `voice` required. Must be one of: `maichi`, `baotrang`, `kimoanh`, `hamy`, `giahuy`, `huuduc`, `quangminh`, `tiendat`. Missing or anything else (including `vi-VN-HoaiMyNeural`) → 400 (`unknown voice`).
- Ignore `engine`, `rate`, `pitch`, `lang`.
- Response: `Content-Type: audio/mpeg`, raw MP3. Never a dummy body.
- Engine unloaded → 503. Synthesis/ffmpeg failure or 25s timeout → 502 (`tts synthesis failed`).

Pipeline:

1. Cache lookup (key below).
2. `normalize_vi_text(text)`.
3. If the utterance is long, segment with ZeroTTS `chunk_text` (`max_chunk_sec=15`) and concatenate waveforms.
4. `ZeroTTS.synthesize(..., voice=<id>)` at the model sample rate (48 kHz float32).
5. Encode WAV then ffmpeg MP3 128k.
6. Cache and return.

Do not apply `cfg_scale` other than the library default (`1.0`). Use the eight built-in packs only.

## 7. Cache

`FileCache` unchanged (sha256 of the key string as filename).

| Kind | Key | When written |
|---|---|---|
| Translate | `{source}\|vi\|{original_cue_text}` | After a **successful** batch split, per non-empty cue |
| TTS | `zerotts\|{voice}\|{normalized_text}\|mp3` | After successful MP3 encode |

Do not read Opus-MT or Piper cache entries (old keys differ). Do not cache empty cues. Do not cache a translate batch that 502s.

On translate cache hits for some cues, still send **only misses** through Hy-MT2 as a delimiter batch of the misses, then merge by original index. If that sub-batch mismatches, 502 the whole request (do not return a mix of cached hits and guessed splits).

## 8. Runtime load

`build_runtime()`:

1. Construct `FileCache(CACHE_ROOT)`.
2. If `_cuda_device_present()` (existing `/dev/nvidia0` + `CUDA_VISIBLE_DEVICES` guard): `AutoModelForCausalLM` + `AutoTokenizer` from `tencent/Hy-MT2-1.8B`, `dtype=bfloat16`, `device_map` CUDA, `trust_remote_code=True`. Wrap in `HyMt2Translator`. On import/load failure: log, translator `None`.
3. Else: translator `None`, log that translate is unavailable without NVIDIA.
4. `ZeroTTS.from_pretrained("zeroweight-ai/ZeroTTS")`. On failure: tts `None`.
5. Return `(translator, tts_engine)`.

`download-models.sh` prefetches both Hub repos into `HF_HOME` so first start is not a surprise download inside uvicorn if the operator wants that; runtime must still succeed if the script already populated the cache.

`compose.yml`: publish 8787, volumes `./models` and `./cache`, `BACKEND_API_KEY` from `.env`, **enable GPU**. Document `nvidia-container-toolkit` as required for translate.

## 9. Testing

Keep pytest + `TestClient` + injected fakes. Rewrite `server/tests/test_tts.py`; update translate/health.

Translate:

- `en` / `en-US` → `vi` / `vi-VN` preserves ids and order.
- `ja` → `vi` is 200 (no longer 400).
- `fr` → `en` is 400 (`target must be vi`).
- `xx` → `vi` is 400 (unsupported source).
- `vi` → `vi` echoes, zero model calls.
- Empty cue in a mixed list echoes `""` and is omitted from the joined prompt.
- Fake model returning the wrong number of `<CUESEP>` slices → 502.
- Auth 401 cases unchanged.
- Empty cues / >50 / text >2000 still 400.
- Translator `None` → 503.

TTS:

- Each of the eight ids returns `audio/mpeg` and is forwarded to the fake engine.
- `vi-VN-HoaiMyNeural`, missing `voice`, empty text, `format=wav` → 400.
- `engine=piper` still synthesizes with ZeroTTS (ignored field).
- Fake engine exception → 502.
- Engine `None` → 503.
- No tests for Piper, Edge, MMS, or breaker.

Health: `ttsFallback` and `breaker` absent; `translate`/`tts` are `ready` or `unavailable`.

Do not download Hy-MT2 or ZeroTTS in CI. Fakes only.

## 10. Docs in the same implementation change

- **ADR-0014** (new): GPU Hy-MT2-1.8B + CPU ZeroTTS, no server fallback, target `vi`, ZeroTTS ids only. Supersede ADR-0010.
- **ADR-0010**: `status: superseded by ADR-0014`.
- **CONTEXT.md** `Self-hosted Backend`: operator-run Docker service exposing `/v1/translate` and `/v1/tts` for cue text into Vietnamese and MP3 speech. Do not name Hy-MT2 or ZeroTTS in the glossary.

## 11. Frontend handoff (not this ticket)

The extension ticket must:

1. Hardcode the eight ZeroTTS ids in the Neural Voice Matrix (no `/v1/voices`).
2. Send `voice` as those ids (`maichi` default). Stop sending Edge Neural names.
3. Raise backend TTS fetch timeout to **30s** (server ceiling is 25s).
4. Stop sending `engine` as a required Piper/Edge switch (harmless if still present).
5. Hide pitch/rate; drop Web Speech / Piper / Edge UI if that ticket still plans to.

Until then, current HUD TTS calls will 400.

## 12. Implementation notes

- `TtsEngine.synthesize(self, text: str, voice: str) -> bytes`. `create_app` must not require `rate`/`engine`.
- `HyMt2Translator.translate_texts(self, texts: list[str], *, source: str) -> list[str]` so cache keys include source. `create_app` passes normalized `source` into the translator.
- Collapse-stutter (`collapse_stutter`) is Marian-specific; delete it.
- Health Ping in Command Center that asserted `ttsFallback` is extension code; this ticket only changes the JSON the Ping would see.

## 13. Success

- `npm` / extension tests are **out of scope**; they may still expect Edge voice ids until the frontend ticket.
- `server` pytest green with fakes.
- Typecheck of the extension is unchanged (no TS edits).
- Operator with GPU: health `translate=ready`, `tts=ready`; `en→vi` and `ja→vi` return items; `POST /v1/tts` with `voice=maichi` returns MP3; `voice=vi-VN-HoaiMyNeural` returns 400.
