# Self-hosted EN→VI Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a CPU Docker backend (`POST /v1/translate`, `POST /v1/tts`) and wire the Chrome extension so new installs default to it, TTS never opens Bing WebSocket from Chrome, and Gemini / YouTube Caption Translation stay explicit choices.

**Architecture:** FastAPI in `server/` is a deep module behind two HTTP endpoints (CTranslate2 Opus-MT EN→VI; Piper then Edge TTS on the server). The extension keeps DubbingOrchestrator as the clock. `BackendTranslationClient` implements `TranslationClient`. A `createBackendTtsRouter` in the service worker posts MP3 bytes; session breaker skips cues instead of calling `EdgeTtsClient`.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, CTranslate2, Piper, edge-tts, ffmpeg; WXT + TypeScript + Vitest for the extension.

**Spec:** `docs/superpowers/specs/2026-09-12-self-hosted-backend-design.md`

## Global Constraints

- CPU only — no nvidia runtime, no GPU device reservations, no CUDA env vars.
- V1 translate is EN→VI only (`en`/`en-US` → `en`, `vi`/`vi-VN` → `vi`); other pairs HTTP 400.
- Mutating routes require `Authorization: Bearer <BACKEND_API_KEY>`; `GET /v1/health` is unauthenticated.
- Do not call `EdgeTtsClient` from Chrome in V1. Edge TTS runs only inside the backend.
- Do not auto-switch translation to Gemini when the backend is down.
- Do not return dummy TTS bodies (`web-speech-audio` blobs) into `syncEngine`.
- No live Hugging Face or Microsoft calls in CI; inject fakes.
- Saved `translationProvider: 'gemini'` must not flip to `self-hosted` on merge; only absent keys take new defaults.
- Old stored `ttsProvider: 'edge-tts'` reads as `'backend'`.
- Easy run: `cd server && cp .env.example .env && docker compose up --build` on any Linux Docker host, port 8787.
- Do not log full cue text at info level (id + character count + cache hit + engine only).
- Domain term: **Self-hosted Backend**. Avoid: “the API”, “cloud”, “our server”.

## File map

**Create**
- `server/pyproject.toml`
- `server/Dockerfile`
- `server/compose.yml`
- `server/.env.example`
- `server/.gitignore`
- `server/app/__init__.py`
- `server/app/main.py` — `create_app`, routes
- `server/app/auth.py` — Bearer check
- `server/app/lang.py` — BCP-47 → `en`/`vi`
- `server/app/translate.py` — CTranslate2 wrapper + protocol
- `server/app/tts.py` — Piper → Edge, breaker, ffmpeg
- `server/app/cache.py` — filesystem blob cache
- `server/scripts/download-models.sh`
- `server/tests/conftest.py`
- `server/tests/test_health_auth.py`
- `server/tests/test_translate.py`
- `server/tests/test_tts.py`
- `src/core/translation/backend-client.ts`
- `src/core/tts/backend-tts-router.ts`
- `tests/backend-translation-client.test.ts`
- `tests/backend-tts-router.test.ts`
- `docs/adr/0010-self-hosted-cpu-backend.md`

**Modify**
- `.gitignore` — `server/models/`, `server/cache/`, `server/.env`
- `src/storage/settings.ts` — types, defaults, migrate `edge-tts`, `pingBackendConnection`
- `src/core/translation/factory.ts` — `self-hosted` branch
- `src/core/translation/index.ts` — export client
- `src/entrypoints/background.ts` — TTS router, no `EdgeTtsClient`
- `src/core/tts/background-tts-client.ts` — no in-page Edge fallback
- `src/entrypoints/content/orchestrator-coordinator.ts` — `SELF-HOST` label
- `src/entrypoints/options/OptionsDashboard.tsx` — Self-hosted fields, Ping, TTS select
- `wxt.config.ts` — drop Bing host permissions
- `tests/options-dashboard.test.tsx`, `tests/caption-detection.test.ts`, `tests/openai-translation-client.test.ts`
- `docs/adr/0001-client-side-byok-architecture.md`, `docs/adr/0007-pluggable-translation-openai-compatible-proxy.md`
- `docs/SPEC.md`, `CONTEXT.md`, `README.md`, `.agents/memory/tech-decisions.md`
- `docs/superpowers/specs/2026-09-12-self-hosted-backend-design.md` — status accepted

---

### Task 1: Server app factory, health, Bearer auth

**Files:**
- Create: `server/pyproject.toml`
- Create: `server/app/__init__.py`
- Create: `server/app/auth.py`
- Create: `server/app/main.py`
- Create: `server/tests/conftest.py`
- Create: `server/tests/test_health_auth.py`
- Create: `server/.gitignore`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: spec §6.1 health JSON, §6 Bearer on mutating routes
- Produces: `create_app(*, api_key: str, translator=None, tts_engine=None) -> FastAPI`; `require_bearer(authorization: str | None, expected: str) -> None`; `GET /v1/health` unauthenticated

- [ ] **Step 1: Add Python project files and gitignores**

Root `.gitignore` append:

```
server/models/
server/cache/
server/.env
```

`server/.gitignore`:

```
__pycache__/
.pytest_cache/
.venv/
models/
cache/
.env
```

`server/pyproject.toml`:

```toml
[project]
name = "aetherdub-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "ctranslate2>=4.5",
  "sentencepiece>=0.2",
  "edge-tts>=6.1",
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "httpx>=0.27"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

`server/app/__init__.py` empty.

- [ ] **Step 2: Write failing health/auth tests**

`server/tests/test_health_auth.py`:

```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_is_unauthenticated_and_reports_unavailable_engines():
    app = create_app(api_key="test-key", translator=None, tts_engine=None)
    client = TestClient(app)
    response = client.get("/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["translate"] == "unavailable"
    assert body["tts"] == "unavailable"
    assert body["ttsFallback"] == "edge-tts"
    assert body["breaker"] == "closed"


def test_translate_without_bearer_is_401():
    app = create_app(api_key="test-key")
    client = TestClient(app)
    response = client.post("/v1/translate", json={"source": "en", "target": "vi", "cues": [{"id": "1", "text": "hi"}]})
    assert response.status_code == 401


def test_translate_with_wrong_bearer_is_401():
    app = create_app(api_key="test-key")
    client = TestClient(app)
    response = client.post(
        "/v1/translate",
        headers={"Authorization": "Bearer nope"},
        json={"source": "en", "target": "vi", "cues": [{"id": "1", "text": "hi"}]},
    )
    assert response.status_code == 401
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd server
python -m pip install -e ".[dev]"
python -m pytest tests/test_health_auth.py -v
```

Expected: FAIL — `app.main` / `create_app` not found.

- [ ] **Step 4: Implement auth + create_app + health + stub mutating routes**

`server/app/auth.py`:

```python
from fastapi import HTTPException


def require_bearer(authorization: str | None, expected: str) -> None:
    if not expected:
        raise HTTPException(status_code=500, detail="BACKEND_API_KEY is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization[len("Bearer "):].strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="Invalid bearer token")
```

`server/app/main.py`:

```python
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from app.auth import require_bearer


def create_app(*, api_key: str, translator=None, tts_engine=None) -> FastAPI:
    app = FastAPI(title="AetherDub Self-hosted Backend")
    app.state.api_key = api_key
    app.state.translator = translator
    app.state.tts_engine = tts_engine

    @app.get("/v1/health")
    def health():
        tts = app.state.tts_engine
        return {
            "ok": True,
            "translate": "ready" if app.state.translator is not None else "unavailable",
            "tts": tts.status() if tts is not None else "unavailable",
            "ttsFallback": "edge-tts",
            "breaker": tts.breaker_state() if tts is not None else "closed",
        }

    @app.post("/v1/translate")
    async def translate(request: Request, authorization: str | None = Header(default=None)):
        require_bearer(authorization, app.state.api_key)
        raise HTTPException(status_code=501, detail="translate not implemented")

    @app.post("/v1/tts")
    async def tts(request: Request, authorization: str | None = Header(default=None)):
        require_bearer(authorization, app.state.api_key)
        raise HTTPException(status_code=501, detail="tts not implemented")

    return app


def app_from_env() -> FastAPI:
    import os
    return create_app(api_key=os.environ.get("BACKEND_API_KEY", ""))
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server
python -m pytest tests/test_health_auth.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitignore server/pyproject.toml server/app/__init__.py server/app/auth.py server/app/main.py server/tests/test_health_auth.py server/.gitignore
git commit -m "feat(server): add FastAPI health endpoint and bearer auth"
```

---

### Task 2: Translate engine (EN→VI, cache, 400s)

**Files:**
- Create: `server/app/lang.py`
- Create: `server/app/cache.py`
- Create: `server/app/translate.py`
- Create: `server/tests/test_translate.py`
- Modify: `server/app/main.py`

**Interfaces:**
- Consumes: `create_app`, `require_bearer`
- Produces: `normalize_lang(code: str) -> str`; `FileCache.get/set`; `Translator.translate_cues(source: str, target: str, cues: list[dict]) -> list[dict]`; `POST /v1/translate` contract from spec §6.2

- [ ] **Step 1: Write failing translate tests**

`server/tests/test_translate.py`:

```python
from fastapi.testclient import TestClient

from app.lang import normalize_lang
from app.main import create_app


class FakeTranslator:
    def __init__(self):
        self.calls = []

    def translate_texts(self, texts: list[str]) -> list[str]:
        self.calls.append(list(texts))
        return [f"VI:{t}" for t in texts]


def make_client(translator=None):
    app = create_app(api_key="test-key", translator=translator or FakeTranslator())
    return TestClient(app), app.state.translator


def auth():
    return {"Authorization": "Bearer test-key"}


def test_normalize_lang_strips_region():
    assert normalize_lang("en-US") == "en"
    assert normalize_lang("vi-VN") == "vi"
    assert normalize_lang("EN") == "en"


def test_translate_preserves_ids_and_order():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={
            "source": "en",
            "target": "vi",
            "cues": [
                {"id": "12", "text": "Welcome back"},
                {"id": "13", "text": "Hello"},
            ],
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {"id": "12", "text": "VI:Welcome back"},
            {"id": "13", "text": "VI:Hello"},
        ]
    }
    assert translator.calls == [["Welcome back", "Hello"]]


def test_translate_accepts_en_us_vi_vn():
    client, _ = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en-US", "target": "vi-VN", "cues": [{"id": "1", "text": "Hi"}]},
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["text"] == "VI:Hi"


def test_non_en_vi_pair_is_400():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "ja", "target": "vi", "cues": [{"id": "1", "text": "こんにちは"}]},
    )
    assert response.status_code == 400
    assert "EN→VI" in response.json()["detail"] or "EN->VI" in response.json()["detail"] or "EN" in response.json()["detail"]
    assert translator.calls == []


def test_empty_cues_is_400():
    client, _ = make_client()
    response = client.post("/v1/translate", headers=auth(), json={"source": "en", "target": "vi", "cues": []})
    assert response.status_code == 400


def test_more_than_50_cues_is_400():
    client, _ = make_client()
    cues = [{"id": str(i), "text": "x"} for i in range(51)]
    response = client.post("/v1/translate", headers=auth(), json={"source": "en", "target": "vi", "cues": cues})
    assert response.status_code == 400


def test_empty_text_passthrough_does_not_call_model():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en", "target": "vi", "cues": [{"id": "1", "text": "  "}]},
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["text"] == ""
    assert translator.calls == []


def test_same_source_and_target_passthrough():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "vi", "target": "vi", "cues": [{"id": "1", "text": "Xin chào"}]},
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["text"] == "Xin chào"
    assert translator.calls == []


def test_text_over_2000_chars_is_400():
    client, _ = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en", "target": "vi", "cues": [{"id": "1", "text": "a" * 2001}]},
    )
    assert response.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server
python -m pytest tests/test_translate.py -v
```

Expected: FAIL — `normalize_lang` missing and `/v1/translate` still 501.

- [ ] **Step 3: Implement lang, cache, translator wrapper, route**

`server/app/lang.py`:

```python
def normalize_lang(code: str | None) -> str:
    if not code:
        return ""
    primary = code.strip().lower().replace("_", "-").split("-", 1)[0]
    return primary
```

`server/app/cache.py`:

```python
import hashlib
from pathlib import Path


class FileCache:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.root / digest

    def get_bytes(self, key: str) -> bytes | None:
        path = self.path_for(key)
        if not path.is_file():
            return None
        return path.read_bytes()

    def get_text(self, key: str) -> str | None:
        data = self.get_bytes(key)
        return None if data is None else data.decode("utf-8")

    def set_bytes(self, key: str, data: bytes) -> None:
        self.path_for(key).write_bytes(data)

    def set_text(self, key: str, text: str) -> None:
        self.set_bytes(key, text.encode("utf-8"))
```

`server/app/translate.py`:

```python
from app.cache import FileCache
from app.lang import normalize_lang


class CTranslate2Translator:
    def __init__(self, translator, cache: FileCache | None = None):
        self._translator = translator
        self._cache = cache

    def translate_texts(self, texts: list[str]) -> list[str]:
        results = [None] * len(texts)
        pending_idx = []
        pending_text = []
        for i, text in enumerate(texts):
            if self._cache:
                hit = self._cache.get_text(f"en|vi|{text}")
                if hit is not None:
                    results[i] = hit
                    continue
            pending_idx.append(i)
            pending_text.append(text)
        if pending_text:
            translated = self._translator.translate_batch(pending_text)
            for i, out in zip(pending_idx, translated):
                results[i] = out
                if self._cache:
                    self._cache.set_text(f"en|vi|{texts[i]}", out)
        return results
```

The FastAPI route should not require CTranslate2 in tests: if `app.state.translator` has `translate_texts`, use it.

Replace `POST /v1/translate` in `server/app/main.py`:

```python
    @app.post("/v1/translate")
    async def translate(payload: dict, authorization: str | None = Header(default=None)):
        require_bearer(authorization, app.state.api_key)
        source = normalize_lang(payload.get("source"))
        target = normalize_lang(payload.get("target"))
        cues = payload.get("cues")
        if not isinstance(cues, list) or len(cues) == 0:
            raise HTTPException(status_code=400, detail="cues must be a non-empty list")
        if len(cues) > 50:
            raise HTTPException(status_code=400, detail="cues cannot exceed 50 items")
        if source != "en" or target != "vi":
            if source == target and source:
                items = [{"id": str(c.get("id", "")), "text": str(c.get("text") or "").strip()} for c in cues]
                return {"items": items}
            raise HTTPException(status_code=400, detail="V1 only supports EN→VI translation")
        for cue in cues:
            text = str(cue.get("text") or "")
            if len(text) > 2000:
                raise HTTPException(status_code=400, detail="cue text cannot exceed 2000 characters")
        if app.state.translator is None:
            raise HTTPException(status_code=503, detail="translator unavailable")
        items = []
        to_model = []
        to_model_idx = []
        for i, cue in enumerate(cues):
            raw = str(cue.get("text") or "")
            stripped = raw.strip()
            cue_id = str(cue.get("id", ""))
            if not stripped:
                items.append({"id": cue_id, "text": ""})
                continue
            items.append({"id": cue_id, "text": None})
            to_model.append(stripped)
            to_model_idx.append(len(items) - 1)
        if to_model:
            translated = app.state.translator.translate_texts(to_model)
            for idx, text in zip(to_model_idx, translated):
                items[idx]["text"] = text
        return {"items": items}
```

Import `normalize_lang` in `main.py`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server
python -m pytest tests/test_translate.py tests/test_health_auth.py -v
```

Expected: PASS. If the same-source `vi`/`vi` branch is hit before the EN→VI check, keep that order: passthrough when `source == target`.

- [ ] **Step 5: Commit**

```bash
git add server/app/lang.py server/app/cache.py server/app/translate.py server/app/main.py server/tests/test_translate.py
git commit -m "feat(server): add EN-VI translate contract with cue id preservation"
```

---

### Task 3: TTS engine (Piper → Edge, cache, breaker) + Compose

**Files:**
- Create: `server/app/tts.py`
- Create: `server/tests/test_tts.py`
- Create: `server/Dockerfile`
- Create: `server/compose.yml`
- Create: `server/.env.example`
- Create: `server/scripts/download-models.sh`
- Modify: `server/app/main.py`

**Interfaces:**
- Consumes: `FileCache`, `require_bearer`, `create_app(..., tts_engine=)`
- Produces: `TtsEngine.synthesize(text: str, voice: str, rate: str) -> bytes`; `status() -> str`; `breaker_state() -> str`; `POST /v1/tts` returns `audio/mpeg`

- [ ] **Step 1: Write failing TTS tests**

`server/tests/test_tts.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


class FakeTts:
    def __init__(self):
        self.piper_calls = []
        self.edge_calls = []
        self.fail_piper = False
        self.fail_edge = False
        self._edge_fails = 0
        self._breaker_open = False

    def status(self):
        return "piper-only" if self._breaker_open else "piper"

    def breaker_state(self):
        return "open" if self._breaker_open else "closed"

    def synthesize(self, text: str, voice: str, rate: str) -> bytes:
        if self.fail_piper:
            self.piper_calls.append(text)
            if self._breaker_open:
                raise RuntimeError("piper failed")
            if self.fail_edge:
                self.edge_calls.append(voice)
                self._edge_fails += 1
                if self._edge_fails >= 3:
                    self._breaker_open = True
                raise RuntimeError("edge failed")
            self.edge_calls.append(voice)
            return b"ID3FAKEEDGE"
        self.piper_calls.append(text)
        return b"ID3FAKEPIPER"


def make_client(tts=None):
    engine = tts or FakeTts()
    app = create_app(api_key="test-key", tts_engine=engine)
    return TestClient(app), engine


def auth():
    return {"Authorization": "Bearer test-key"}


def test_tts_returns_mpeg_and_calls_piper():
    client, engine = make_client()
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Chào mừng quay lại", "lang": "vi-VN", "voice": "vi-VN-HoaiMyNeural", "rate": "+0%", "format": "mp3"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert response.content == b"ID3FAKEPIPER"
    assert engine.piper_calls == ["Chào mừng quay lại"]
    assert engine.edge_calls == []


def test_empty_text_is_400():
    client, _ = make_client()
    response = client.post("/v1/tts", headers=auth(), json={"text": "  ", "format": "mp3"})
    assert response.status_code == 400


def test_text_over_500_chars_is_400():
    client, _ = make_client()
    response = client.post("/v1/tts", headers=auth(), json={"text": "a" * 501, "format": "mp3"})
    assert response.status_code == 400


def test_non_mp3_format_is_400():
    client, _ = make_client()
    response = client.post("/v1/tts", headers=auth(), json={"text": "Hi", "format": "wav"})
    assert response.status_code == 400


def test_piper_failure_uses_edge_and_namminh_voice():
    tts = FakeTts()
    tts.fail_piper = True
    client, engine = make_client(tts)
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Xin chào", "voice": "vi-VN-NamMinhNeural", "format": "mp3"},
    )
    assert response.status_code == 200
    assert response.content == b"ID3FAKEEDGE"
    assert engine.edge_calls == ["vi-VN-NamMinhNeural"]


def test_three_edge_failures_open_breaker_and_skip_edge():
    tts = FakeTts()
    tts.fail_piper = True
    tts.fail_edge = True
    client, engine = make_client(tts)
    for _ in range(3):
        response = client.post("/v1/tts", headers=auth(), json={"text": "Hi", "format": "mp3"})
        assert response.status_code == 502
    assert engine.breaker_state() == "open"
    health = client.get("/v1/health").json()
    assert health["tts"] == "piper-only"
    assert health["breaker"] == "open"
    edge_calls_after_open = len(engine.edge_calls)
    response = client.post("/v1/tts", headers=auth(), json={"text": "Hi again", "format": "mp3"})
    assert response.status_code == 502
    assert len(engine.edge_calls) == edge_calls_after_open
```

The last assertion depends on `TtsEngine` skipping Edge when breaker is open. Implement that inside `TtsEngine.synthesize`, not only in the fake: the fake models the real class. After Task 3 implementation, use the real `TtsEngine` with injected piper/edge callables in a second test module if the FakeTts tests only cover the HTTP adapter.

Prefer testing the real `TtsEngine` class directly:

```python
from app.tts import TtsEngine
from app.cache import FileCache


def test_tts_engine_cache_skips_piper(tmp_path):
    piper_calls = []

    def piper(text, voice, rate):
        piper_calls.append(text)
        return b"WAVPIPER"

    def edge(text, voice, rate):
        raise AssertionError("edge should not run")

    def to_mp3(data):
        return b"ID3" + data

    engine = TtsEngine(piper=piper, edge=edge, to_mp3=to_mp3, cache=FileCache(tmp_path), piper_timeout_s=2.5)
    first = engine.synthesize("Hello", "vi-VN-HoaiMyNeural", "+0%")
    second = engine.synthesize("Hello", "vi-VN-HoaiMyNeural", "+0%")
    assert first == second == b"ID3WAVPIPER"
    assert piper_calls == ["Hello"]
```

Put this in `test_tts.py` as well.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server
python -m pytest tests/test_tts.py -v
```

Expected: FAIL — `TtsEngine` missing; `/v1/tts` is 501.

- [ ] **Step 3: Implement TtsEngine and `/v1/tts`**

`server/app/tts.py`:

```python
from __future__ import annotations

import logging
from typing import Callable

from app.cache import FileCache

log = logging.getLogger("aetherdub.tts")

PiperFn = Callable[[str, str, str], bytes]
EdgeFn = Callable[[str, str, str], bytes]
Mp3Fn = Callable[[bytes], bytes]


def edge_voice_for(voice: str | None) -> str:
    raw = voice or ""
    if "NamMinh" in raw:
        return "vi-VN-NamMinhNeural"
    return "vi-VN-HoaiMyNeural"


class TtsEngine:
    def __init__(
        self,
        *,
        piper: PiperFn,
        edge: EdgeFn,
        to_mp3: Mp3Fn,
        cache: FileCache,
        piper_timeout_s: float = 2.5,
        edge_timeout_s: float = 8.0,
    ):
        self._piper = piper
        self._edge = edge
        self._to_mp3 = to_mp3
        self._cache = cache
        self.piper_timeout_s = piper_timeout_s
        self.edge_timeout_s = edge_timeout_s
        self._edge_failures = 0
        self._breaker_open = False

    def status(self) -> str:
        return "piper-only" if self._breaker_open else "piper"

    def breaker_state(self) -> str:
        return "open" if self._breaker_open else "closed"

    def synthesize(self, text: str, voice: str, rate: str) -> bytes:
        cache_key = f"{text}|{voice}|{rate}|mp3"
        hit = self._cache.get_bytes(cache_key)
        if hit is not None:
            log.info("tts cache hit chars=%s", len(text))
            return hit

        try:
            wav = self._piper(text, voice, rate)
            if not wav:
                raise RuntimeError("empty piper audio")
            mp3 = self._to_mp3(wav)
            self._cache.set_bytes(cache_key, mp3)
            log.info("tts engine=piper chars=%s", len(text))
            return mp3
        except Exception:
            log.info("tts piper failed chars=%s", len(text))

        if self._breaker_open:
            raise RuntimeError("tts unavailable: piper failed and edge breaker open")

        try:
            audio = self._edge(text, edge_voice_for(voice), rate)
            if not audio:
                raise RuntimeError("empty edge audio")
            mp3 = audio if audio[:3] == b"ID3" or audio[:2] == b"\xff\xfb" else self._to_mp3(audio)
            self._edge_failures = 0
            self._cache.set_bytes(cache_key, mp3)
            log.info("tts engine=edge-tts chars=%s", len(text))
            return mp3
        except Exception:
            self._edge_failures += 1
            if self._edge_failures >= 3:
                self._breaker_open = True
            log.info("tts edge failed chars=%s breaker=%s", len(text), self.breaker_state())
            raise
```

Wire `/v1/tts` in `main.py`:

```python
    @app.post("/v1/tts")
    async def tts(payload: dict, authorization: str | None = Header(default=None)):
        require_bearer(authorization, app.state.api_key)
        text = str(payload.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required")
        if len(text) > 500:
            raise HTTPException(status_code=400, detail="text cannot exceed 500 characters")
        fmt = str(payload.get("format") or "mp3").lower()
        if fmt != "mp3":
            raise HTTPException(status_code=400, detail="format must be mp3")
        if app.state.tts_engine is None:
            raise HTTPException(status_code=503, detail="tts unavailable")
        try:
            audio = app.state.tts_engine.synthesize(
                text,
                str(payload.get("voice") or "vi-VN-HoaiMyNeural"),
                str(payload.get("rate") or "+0%"),
            )
        except Exception:
            raise HTTPException(status_code=502, detail="tts synthesis failed")
        return Response(content=audio, media_type="audio/mpeg")
```

HTTP adapter tests that used FakeTts: either keep FakeTts as a duck-typed engine (it already has `synthesize/status/breaker_state`) **or** switch those tests to real `TtsEngine`. Keep FakeTts for HTTP 400/200 wiring; add the cache unit test against real `TtsEngine`.

For the breaker HTTP test, FakeTts must skip Edge after open — the snippet already does that.

- [ ] **Step 4: Add Docker / compose / download script (no GPU)**

`server/.env.example`:

```
BACKEND_API_KEY=change-me
```

`server/scripts/download-models.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="${MODEL_ROOT:-/models}"
mkdir -p "$ROOT/opus-mt-en-vi" "$ROOT/piper"
if [ ! -f "$ROOT/opus-mt-en-vi/model.bin" ]; then
  ct2-transformers-converter --model Helsinki-NLP/opus-mt-en-vi --output_dir "$ROOT/opus-mt-en-vi" --quantization int8 --force
fi
VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/vi/vi_VN/vais1000/medium"
if [ ! -f "$ROOT/piper/vi_VN-vais1000-medium.onnx" ]; then
  curl -L "$VOICE_BASE/vi_VN-vais1000-medium.onnx" -o "$ROOT/piper/vi_VN-vais1000-medium.onnx"
  curl -L "$VOICE_BASE/vi_VN-vais1000-medium.onnx.json" -o "$ROOT/piper/vi_VN-vais1000-medium.onnx.json"
fi
```

`server/Dockerfile`:

```dockerfile
FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl bash \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml /app/pyproject.toml
COPY app /app/app
COPY scripts /app/scripts
RUN pip install --no-cache-dir . \
    && chmod +x /app/scripts/download-models.sh
ENV MODEL_ROOT=/models
ENV CACHE_ROOT=/cache
ENV PORT=8787
EXPOSE 8787
CMD ["bash", "-lc", "/app/scripts/download-models.sh && uvicorn app.main:app_from_env --host 0.0.0.0 --port 8787"]
```

`server/compose.yml`:

```yaml
services:
  api:
    build: .
    ports:
      - "8787:8787"
    env_file:
      - .env
    environment:
      MODEL_ROOT: /models
      CACHE_ROOT: /cache
    volumes:
      - ./models:/models
      - ./cache:/cache
    restart: unless-stopped
```

Do **not** add `deploy.resources.reservations.devices` or `runtime: nvidia`.

`app_from_env` may still construct `translator=None, tts_engine=None` until a later wiring step in this same task: add a `server/app/runtime.py` that builds CTranslate2 + Piper subprocess + edge-tts + ffmpeg only when `MODEL_ROOT` exists. If models are missing, health stays `unavailable` (acceptable for CI). Live Docker is operator-verified, not CI.

Minimal Piper subprocess (in `runtime.py`, used only by `app_from_env`):

```python
import subprocess, tempfile, os
from pathlib import Path

def piper_synth(text: str, voice: str, rate: str) -> bytes:
    model = Path(os.environ["MODEL_ROOT"]) / "piper" / "vi_VN-vais1000-medium.onnx"
    out = Path(tempfile.mkstemp(suffix=".wav")[1])
    subprocess.run(
        ["piper", "--model", str(model), "--output_file", str(out)],
        input=text.encode("utf-8"),
        check=True,
        timeout=float(os.environ.get("PIPER_TIMEOUT", "2.5")),
    )
    return out.read_bytes()
```

Install piper binary in Dockerfile via pip `piper-tts` if that provides the `piper` CLI; otherwise document the binary. Prefer `pip install piper-tts` in `pyproject.toml` dependencies so the CLI exists in the image.

Add `"piper-tts>=1.2"` to `pyproject.toml` dependencies.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server
python -m pytest -v
```

Expected: PASS (no Docker required).

- [ ] **Step 6: Commit**

```bash
git add server/app/tts.py server/app/main.py server/tests/test_tts.py server/Dockerfile server/compose.yml server/.env.example server/scripts/download-models.sh server/pyproject.toml server/app/runtime.py
git commit -m "feat(server): add Piper-then-Edge TTS, disk cache, and CPU Compose"
```

---

### Task 4: Extension settings — `self-hosted` default, TTS migration, Ping

**Files:**
- Modify: `src/storage/settings.ts`
- Modify: `tests/options-dashboard.test.tsx`
- Test: `tests/options-dashboard.test.tsx` (extend) or `tests/settings-self-hosted.test.ts`

**Interfaces:**
- Consumes: spec §9.1
- Produces: `TranslationProvider` includes `'self-hosted'`; `TtsProvider = 'backend' | 'web-speech'`; `UserSettings.backendUrl`, `backendApiKey`; `normalizeSettings(partial)`; `pingBackendConnection(url, apiKey, fetchFn?)`

- [ ] **Step 1: Write failing settings tests**

Add to `tests/options-dashboard.test.tsx` (keep `resetSettingsForTesting` in `beforeEach`):

```tsx
it('defaults new installs to self-hosted backend TTS', async () => {
  const settings = await getSettings();
  expect(settings.translationProvider).toBe('self-hosted');
  expect(settings.ttsProvider).toBe('backend');
  expect(settings.backendUrl).toBe('http://127.0.0.1:8787');
  expect(settings.backendApiKey).toBe('');
});

it('does not rewrite a stored gemini translation provider', async () => {
  await saveSettings({ translationProvider: 'gemini', geminiApiKey: 'abc' });
  const settings = await getSettings();
  expect(settings.translationProvider).toBe('gemini');
  expect(settings.geminiApiKey).toBe('abc');
});

it('migrates stored edge-tts provider to backend', async () => {
  await saveSettings({ ttsProvider: 'edge-tts' as any });
  const settings = await getSettings();
  expect(settings.ttsProvider).toBe('backend');
});
```

Change the existing default assertions that expect `ttsProvider === 'edge-tts'` to `'backend'`.

Add Ping test (can live in the same file):

```tsx
import { pingBackendConnection } from '../src/storage/settings';

it('pings health then one-cue translate', async () => {
  const fetchFn = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, tts: 'piper', breaker: 'closed' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ id: 'ping', text: 'ok' }] }),
    });
  const result = await pingBackendConnection('http://127.0.0.1:8787', 'k', fetchFn);
  expect(result.ok).toBe(true);
  expect(result.tts).toBe('piper');
  expect(String(fetchFn.mock.calls[0][0])).toContain('/v1/health');
  expect(String(fetchFn.mock.calls[1][0])).toContain('/v1/translate');
  expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer k');
});
```

- [ ] **Step 2: Run the failing tests**

```bash
npm test -- tests/options-dashboard.test.tsx
```

Expected: FAIL — default still `gemini` / `edge-tts`; `pingBackendConnection` missing.

- [ ] **Step 3: Implement settings**

In `src/storage/settings.ts`:

```ts
export type TranslationProvider =
  | 'self-hosted'
  | 'gemini'
  | 'openai-compatible'
  | 'youtube-caption-translation';

export type TtsProvider = 'backend' | 'web-speech';

export interface UserSettings {
  translationProvider: TranslationProvider;
  geminiApiKey: string;
  geminiModel: string;
  openaiEndpoint: string;
  openaiModel: string;
  openaiApiKey: string;
  groqApiKey: string;
  targetLanguage: string;
  ttsPitch?: string;
  ttsRate?: string;
  ttsProvider: TtsProvider;
  enableFallback: boolean;
  backendUrl: string;
  backendApiKey: string;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  translationProvider: 'self-hosted',
  geminiApiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  openaiEndpoint: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  openaiApiKey: '',
  groqApiKey: '',
  targetLanguage: 'vi',
  ttsPitch: '+0Hz',
  ttsRate: '+0%',
  ttsProvider: 'backend',
  enableFallback: true,
  backendUrl: 'http://127.0.0.1:8787',
  backendApiKey: '',
};

export function normalizeSettings(input: Partial<UserSettings> | undefined): UserSettings {
  const merged: UserSettings = { ...DEFAULT_USER_SETTINGS, ...(input ?? {}) };
  if ((input as { ttsProvider?: string } | undefined)?.ttsProvider === 'edge-tts') {
    merged.ttsProvider = 'backend';
  }
  return merged;
}
```

Use `normalizeSettings(stored)` in `getSettings` instead of `{ ...DEFAULT_USER_SETTINGS, ...stored }` so the `edge-tts` migration runs. `saveSettings` should persist the normalized `ttsProvider`.

`pingBackendConnection`:

```ts
export async function pingBackendConnection(
  url: string,
  apiKey: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<{ ok: boolean; latencyMs?: number; error?: string; tts?: string }> {
  const base = url.replace(/\/+$/, '');
  const started = Date.now();
  try {
    const healthRes = await fetchFn(`${base}/v1/health`);
    if (!healthRes.ok) {
      return { ok: false, error: `health HTTP ${healthRes.status}` };
    }
    const health = await healthRes.json();
    const translateRes = await fetchFn(`${base}/v1/translate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source: 'en', target: 'vi', cues: [{ id: 'ping', text: 'ok' }] }),
    });
    if (!translateRes.ok) {
      return { ok: false, latencyMs: Date.now() - started, error: `translate HTTP ${translateRes.status}`, tts: health.tts };
    }
    return { ok: true, latencyMs: Date.now() - started, tts: health.tts };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/options-dashboard.test.tsx
```

Expected: PASS. Fix any other test files that assert default `gemini` or `edge-tts` (`grep` `ttsProvider` / `DEFAULT_USER_SETTINGS`).

- [ ] **Step 5: Commit**

```bash
git add src/storage/settings.ts tests/options-dashboard.test.tsx
git commit -m "feat(settings): default self-hosted provider and migrate Chrome Edge TTS"
```

---

### Task 5: `BackendTranslationClient` + factory

**Files:**
- Create: `src/core/translation/backend-client.ts`
- Create: `tests/backend-translation-client.test.ts`
- Modify: `src/core/translation/factory.ts`
- Modify: `src/core/translation/index.ts`
- Modify: `tests/openai-translation-client.test.ts` if it assumes unknown provider → Gemini only

**Interfaces:**
- Consumes: `TranslationClient`, `FetchFn`, `UserSettings.backendUrl/backendApiKey`
- Produces: `BackendTranslationClient`; `createTranslationClient` returns it when `translationProvider === 'self-hosted'`

- [ ] **Step 1: Write failing client/factory tests**

`tests/backend-translation-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackendTranslationClient, createTranslationClient } from '../src/core/translation/index';
import type { Segment } from '../src/types/domain';

const segments: Segment[] = [
  { id: '12', startTime: 0, endTime: 2, duration: 2, sourceText: 'Welcome back' },
  { id: '13', startTime: 2, endTime: 4, duration: 2, sourceText: 'Hello' },
];

describe('BackendTranslationClient', () => {
  it('posts cues and maps items onto translatedText by id without speakerGender', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: '13', text: 'Xin chào' },
          { id: '12', text: 'Chào mừng quay lại' },
        ],
      }),
    });
    const client = new BackendTranslationClient({
      baseUrl: 'http://127.0.0.1:8787/',
      apiKey: 'secret',
      fetchFn,
    });
    const out = await client.translateSegments(segments, { targetLanguage: 'vi' });
    expect(out[0].translatedText).toBe('Chào mừng quay lại');
    expect(out[1].translatedText).toBe('Xin chào');
    expect(out[0].speakerGender).toBeUndefined();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/v1/translate');
    expect(init.headers.Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body);
    expect(body.source).toBe('en');
    expect(body.target).toBe('vi');
    expect(body.cues).toEqual([
      { id: '12', text: 'Welcome back' },
      { id: '13', text: 'Hello' },
    ]);
  });
});

describe('createTranslationClient self-hosted', () => {
  it('does not construct Gemini when provider is self-hosted', () => {
    const fetchFn = vi.fn();
    const client = createTranslationClient(
      { translationProvider: 'self-hosted', backendUrl: 'http://127.0.0.1:8787', backendApiKey: 'k' },
      { fetchFn },
    );
    expect(client).toBeInstanceOf(BackendTranslationClient);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/backend-translation-client.test.ts
```

Expected: FAIL — export missing.

- [ ] **Step 3: Implement client + factory**

`src/core/translation/backend-client.ts`:

```ts
import type { Segment, Transcript } from '../../types/domain';
import { defaultFetch } from '../default-fetch';
import { TranslationError, TranslationErrorCode } from './errors';
import type { FetchFn, TranslateOptions, TranslationClient } from './types';

export interface BackendTranslationClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: FetchFn;
  sourceLanguage?: string;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export class BackendTranslationClient implements TranslationClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchFn;
  private readonly sourceLanguage: string;

  constructor(options: BackendTranslationClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || 'http://127.0.0.1:8787');
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? defaultFetch;
    this.sourceLanguage = options.sourceLanguage || 'en';
  }

  async translateTranscript(transcript: Transcript, options?: TranslateOptions): Promise<Transcript> {
    const segments = await this.translateSegments(transcript.segments, options);
    return { ...transcript, targetLanguage: options?.targetLanguage ?? 'vi', segments };
  }

  async translateSegments(segments: Segment[], options?: TranslateOptions): Promise<Segment[]> {
    const target = options?.targetLanguage ?? 'vi';
    const response = await this.fetchFn(`${this.baseUrl}/v1/translate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: this.sourceLanguage,
        target,
        cues: segments.map((s) => ({ id: s.id, text: s.sourceText || '' })),
      }),
    });
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? TranslationErrorCode.AUTH_ERROR
          : TranslationErrorCode.NETWORK_ERROR;
      throw new TranslationError(code, `Self-hosted translate failed: HTTP ${response.status}`, response.status);
    }
    const payload = await response.json();
    const byId = new Map<string, string>(
      (payload.items || []).map((item: { id: string; text: string }) => [item.id, item.text]),
    );
    return segments.map((segment) => {
      const translatedText = byId.get(segment.id);
      if (translatedText === undefined) return { ...segment };
      return { ...segment, translatedText };
    });
  }
}
```

Use existing `TranslationErrorCode.AUTH_ERROR` for HTTP 401/403 and `TranslationErrorCode.NETWORK_ERROR` for every other non-OK status. Pass `httpStatus` as the third constructor argument. Do not add a new error enum member.

Factory:

```ts
  if (provider === 'self-hosted') {
    return new BackendTranslationClient({
      baseUrl: settings?.backendUrl ?? 'http://127.0.0.1:8787',
      apiKey: settings?.backendApiKey ?? '',
      fetchFn: overrides?.fetchFn,
    });
  }
```

Export from `src/core/translation/index.ts`.

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/backend-translation-client.test.ts tests/openai-translation-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/translation/backend-client.ts src/core/translation/factory.ts src/core/translation/index.ts tests/backend-translation-client.test.ts
git commit -m "feat(translation): add self-hosted BackendTranslationClient"
```

---

### Task 6: Background TTS router — drop Chrome Edge happy path

**Files:**
- Create: `src/core/tts/backend-tts-router.ts`
- Create: `tests/backend-tts-router.test.ts`
- Modify: `src/entrypoints/background.ts`
- Modify: `src/core/tts/background-tts-client.ts`
- Modify: `wxt.config.ts`

**Interfaces:**
- Consumes: `UserSettings.backendUrl/backendApiKey/ttsProvider`, `VoiceProfile`
- Produces: `createBackendTtsRouter({ fetchFn, getSettings })` with `synthesize(text, voice): Promise<SynthesizeTtsResult>` and `resetBreaker()`; error codes `WEB_SPEECH_REQUIRED` and `BACKEND_TTS_UNAVAILABLE`

- [ ] **Step 1: Write failing router tests**

`tests/backend-tts-router.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createBackendTtsRouter } from '../src/core/tts/backend-tts-router';
import { DEFAULT_HOAI_MY_VOICE } from '../src/core/tts/voices';

function mp3Response() {
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x01]);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer,
    headers: { get: () => 'audio/mpeg' },
  };
}

describe('createBackendTtsRouter', () => {
  it('posts /v1/tts and returns base64 mp3', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mp3Response());
    const router = createBackendTtsRouter({
      fetchFn,
      getSettings: async () => ({
        backendUrl: 'http://127.0.0.1:8787',
        backendApiKey: 'k',
        ttsProvider: 'backend',
      }),
    });
    const result = await router.synthesize('Xin chào', DEFAULT_HOAI_MY_VOICE);
    expect(result.success).toBe(true);
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.audioBase64).toBeTruthy();
    expect(String(fetchFn.mock.calls[0][0])).toBe('http://127.0.0.1:8787/v1/tts');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
  });

  it('returns WEB_SPEECH_REQUIRED when ttsProvider is web-speech', async () => {
    const fetchFn = vi.fn();
    const router = createBackendTtsRouter({
      fetchFn,
      getSettings: async () => ({
        backendUrl: 'http://127.0.0.1:8787',
        backendApiKey: 'k',
        ttsProvider: 'web-speech',
      }),
    });
    const result = await router.synthesize('Hi', DEFAULT_HOAI_MY_VOICE);
    expect(result.success).toBe(false);
    expect(result.code).toBe('WEB_SPEECH_REQUIRED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('opens breaker after 3 consecutive failures and stops fetching', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('down'));
    const router = createBackendTtsRouter({
      fetchFn,
      getSettings: async () => ({
        backendUrl: 'http://127.0.0.1:8787',
        backendApiKey: 'k',
        ttsProvider: 'backend',
      }),
    });
    for (let i = 0; i < 3; i++) {
      const result = await router.synthesize('Hi', DEFAULT_HOAI_MY_VOICE);
      expect(result.code).toBe('BACKEND_TTS_UNAVAILABLE');
    }
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const fourth = await router.synthesize('Hi', DEFAULT_HOAI_MY_VOICE);
    expect(fourth.code).toBe('BACKEND_TTS_UNAVAILABLE');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    router.resetBreaker();
    fetchFn.mockResolvedValueOnce(mp3Response());
    const recovered = await router.synthesize('Hi', DEFAULT_HOAI_MY_VOICE);
    expect(recovered.success).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});
```

Also add a test that `BackgroundDubbingTtsClient` does not import-call Edge on messaging failure: the simplest assertion is to read that `background-tts-client.ts` no longer constructs `EdgeTtsClient`. After implementation, a unit test:

```ts
it('throws BACKEND_TTS_UNAVAILABLE instead of constructing EdgeTtsClient', async () => {
  // mock sendExtensionMessage to reject with "Receiving end does not exist"
});
```

Mock `sendExtensionMessage` via `vi.mock('@/core/extension-runtime')` or the relative path the test importer uses.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/backend-tts-router.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement router, wire background, strip Edge from content TTS client**

`src/core/tts/backend-tts-router.ts`: implement `createBackendTtsRouter` with a `consecutiveFailures` counter, 8_000 ms AbortController timeout on fetch, `btoa` of response bytes (in tests use the same encoding helper as `background.ts` `arrayBufferToBase64` — extract that helper into `src/core/tts/base64.ts` if `btoa` on binary is fragile in Node; Vitest/jsdom has `btoa`).

`src/entrypoints/background.ts`:

- Remove `import { EdgeTtsClient }` and `const edgeTtsClient = new EdgeTtsClient(...)`.
- Create one router: `const ttsRouter = createBackendTtsRouter({ getSettings })`.
- `SYNTHESIZE_TTS` calls `ttsRouter.synthesize(text, voice)` and `sendResponse` the result.
- Successful `pingBackendConnection` path (if Ping is later handled in SW) calls `ttsRouter.resetBreaker()`. For V1, also reset breaker on any successful synthesize.
- Keep `TRANSLATE_SEGMENTS` using `createTranslationClient(settings)` (self-hosted now flows automatically).

`src/core/tts/background-tts-client.ts`: on `!response.success`, throw `new Error(response.error || response.code)`. On messaging failure (`unavailable|Receiving end does not exist|Extension context invalidated`), throw the same error — **do not** construct `EdgeTtsClient`. Orchestrator already skips cues with no blob if synthesize throws (confirm `requestSegmentSynthesis` catch). If it does not, leave that as existing behavior: throwing is enough to avoid fake blobs.

`wxt.config.ts` `host_permissions`: delete

```
'https://speech.platform.bing.com/*',
'wss://speech.platform.bing.com/*',
```

Keep `*://*/*`.

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/backend-tts-router.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tts/backend-tts-router.ts src/entrypoints/background.ts src/core/tts/background-tts-client.ts wxt.config.ts tests/backend-tts-router.test.ts
git commit -m "feat(tts): route synthesis to self-hosted backend and drop Chrome Edge TTS"
```

---

### Task 7: Command Center, HUD label, banners

**Files:**
- Modify: `src/entrypoints/options/OptionsDashboard.tsx`
- Modify: `src/entrypoints/content/orchestrator-coordinator.ts` (`resolveEngineLabel`)
- Modify: `tests/options-dashboard.test.tsx`
- Modify: `tests/caption-detection.test.ts`
- Modify: `tests/youtube-caption-translation.test.ts` only if label tests collide

**Interfaces:**
- Consumes: `pingBackendConnection`, `TranslationProvider` including `self-hosted`
- Produces: HUD label `SELF-HOST`; options Self-hosted fields; Gemini credentials not required when Self-hosted selected

- [ ] **Step 1: Write failing UI/label tests**

In `tests/caption-detection.test.ts` `resolveEngineLabel` describe:

```ts
it('returns SELF-HOST for the self-hosted provider', () => {
  expect(resolveEngineLabel({ translationProvider: 'self-hosted' } as any)).toBe('SELF-HOST');
});
```

Keep existing tests: `undefined` / `null` still return `GEMINI-3.8-FLASH` because no `translationProvider` is set (do not treat missing provider as self-hosted in the HUD helper — settings load is what defaults the provider).

In `tests/options-dashboard.test.tsx` follow the YouTube CC select test around the `fireEvent.change` on `#translation-provider-select`:

```tsx
it('saves self-hosted backend url and key and does not require gemini', async () => {
  render(<OptionsDashboard />);
  await waitFor(() => screen.getByLabelText('Translation Provider'));
  fireEvent.change(screen.getByLabelText('Translation Provider'), {
    target: { value: 'self-hosted' },
  });
  fireEvent.change(screen.getByLabelText('Backend URL'), {
    target: { value: 'http://192.168.1.10:8787' },
  });
  fireEvent.change(screen.getByLabelText('Backend API Key'), {
    target: { value: 'secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(async () => {
    const saved = await getSettings();
    expect(saved.translationProvider).toBe('self-hosted');
    expect(saved.backendUrl).toBe('http://192.168.1.10:8787');
    expect(saved.backendApiKey).toBe('secret');
  });
});
```

Use the same Save button name the dashboard already has (`/save/i` or the existing test’s matcher — copy from the YouTube CC save test in the same file).

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/caption-detection.test.ts tests/options-dashboard.test.tsx
```

Expected: FAIL — no `SELF-HOST`, no Backend URL field.

- [ ] **Step 3: Implement HUD + options**

`resolveEngineLabel`:

```ts
export function resolveEngineLabel(settings?: Partial<UserSettings> | null): string {
  if (settings?.translationProvider === 'self-hosted') {
    return 'SELF-HOST';
  }
  if (settings?.translationProvider === YOUTUBE_CAPTION_TRANSLATION) {
    return 'YOUTUBE-CC';
  }
  if (settings?.translationProvider === 'openai-compatible') {
    const model = settings.openaiModel?.trim();
    return model ? model.toUpperCase() : 'OPENAI';
  }
  const geminiModel = settings?.geminiModel?.trim();
  return (geminiModel || DEFAULT_GEMINI_MODEL).toUpperCase();
}
```

`OptionsDashboard.tsx`:

- Default `useState<TranslationProvider>('self-hosted')`.
- Add `<option value="self-hosted">Self-hosted Backend (EN→VI)</option>` as the first option.
- State: `backendUrl`, `backendApiKey` loaded from `getSettings`.
- When `translationProvider === 'self-hosted'`, show Backend URL, Backend API key, Ping Backend (calls `pingBackendConnection`), and hide Gemini key requirement the same way YouTube CC already hides it (`translationProvider !== 'youtube-caption-translation'` → extend to `!== 'self-hosted' && !== 'youtube-caption-translation'` for Gemini ping/key required UI).
- TTS `<select>`: `backend` | `web-speech` only. Remove `edge-tts` option. Label Backend vs Web Speech (degraded).
- `handleSaveCredentials` includes `backendUrl`, `backendApiKey`, `ttsProvider`.

Copy existing input classNames. `aria-label="Backend URL"` and `aria-label="Backend API Key"` must match tests.

Self-hosted dubbing failure already uses `instance.updateProps?.({ hasCaptions: false, isNoCaptions: true })` when translate throws — do not add Gemini fallback in `translateViaBackground`.

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/options/OptionsDashboard.tsx src/entrypoints/content/orchestrator-coordinator.ts tests/caption-detection.test.ts tests/options-dashboard.test.tsx
git commit -m "feat(options): add Self-hosted provider UI and SELF-HOST HUD badge"
```

---

### Task 8: ADRs, SPEC, README, memory

**Files:**
- Create: `docs/adr/0010-self-hosted-cpu-backend.md`
- Modify: `docs/adr/0001-client-side-byok-architecture.md`
- Modify: `docs/adr/0007-pluggable-translation-openai-compatible-proxy.md`
- Modify: `docs/SPEC.md`
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `.agents/memory/tech-decisions.md`
- Modify: `.agents/memory/MEMORY.md`
- Modify: `.agents/memory/project-conventions.md`
- Modify: `docs/superpowers/specs/2026-09-12-self-hosted-backend-design.md` (status: accepted)

**Interfaces:**
- Consumes: locked decisions in spec §15
- Produces: docs an agent can follow without reading the plan

- [ ] **Step 1: Write ADR-0010**

```md
---
status: accepted
date: 2026-09-12
---

# 10. Self-hosted CPU backend for EN→VI translation and TTS

We added an operator-run Docker Compose service (FastAPI, CPU only) exposing `POST /v1/translate` (CTranslate2 Opus-MT en-vi) and `POST /v1/tts` (Piper, then Edge TTS on the server). The Chrome extension no longer uses Bing WebSocket for TTS. New installs default to Translation Provider `self-hosted`. Gemini, OpenAI-compatible, and YouTube Caption Translation remain explicit choices. GPU is unused. The documented run path is `docker compose up --build` on any Linux Docker host.
```

- [ ] **Step 2: Amend ADR-0001 and ADR-0007**

ADR-0001: replace “without a dedicated backend server” with: no vendor SaaS is required; the default topology is a Self-hosted Backend the operator runs; BYOK Gemini/OpenAI/Groq remain optional; Chrome must not speak Edge TTS.

ADR-0007: add that `TranslationClient` includes `BackendTranslationClient` for `self-hosted`. YouTube Caption Translation remains outside this interface (ADR-0009).

- [ ] **Step 3: Update SPEC, CONTEXT, README, memory, spec status**

`CONTEXT.md` glossary:

```
**Self-hosted Backend**:
Operator-run Docker service exposing `/v1/translate` and `/v1/tts` for EN→VI cue text and MP3 speech.
_Avoid_: the API, cloud, our server
```

`README.md` run book:

```
cd server
cp .env.example .env   # set BACKEND_API_KEY
docker compose up --build
```

Point Command Center Backend URL at `http://<docker-host-ip>:8787`.

SPEC user stories: default Self-hosted; TTS via backend MP3; Chrome does not open `wss://speech.platform.bing.com`.

Set the design spec status line to `accepted`.

- [ ] **Step 4: There are no unit tests for docs. Grep for leftover “100% client-side” claims that contradict ADR-0001.**

```bash
# use the repo search tools; fix contradictions in README/SPEC only
```

- [ ] **Step 5: Commit**

```bash
git add docs CONTEXT.md README.md .agents/memory
git commit -m "docs(adr): accept self-hosted CPU backend as default topology"
```

---

## Spec coverage (self-review)

| Spec section | Task |
|---|---|
| §6.1 health unauthenticated | 1 |
| §6 Bearer 401 | 1 |
| §6.2 translate EN→VI, 50 cues, empty passthrough, 2000 chars | 2 |
| §6.3–6.4 TTS Piper→Edge, 500 chars, mp3, NamMinh hint, breaker | 3 |
| §7 Compose CPU, Dockerfile, download script | 3 |
| §8 models | 3 (`download-models.sh`) |
| §9.1 settings default + migration | 4 |
| §9.2 factory + BackendTranslationClient, no speakerGender | 5 |
| §9.3 background TTS, no Chrome Edge, breaker, no fake blob | 6 |
| §9.4 HUD SELF-HOST, coordinator uses factory | 7 (label) + 5 (factory) |
| §9.5 Command Center | 7 |
| §9.6 drop Bing host_permissions | 6 |
| §10 no Gemini auto-fallback | 5/7 (do not add fallback) |
| §11 tests | each task |
| §12 docs | 8 |
| §14 acceptance (Docker health, no Bing WS) | 3 + 6; live 10-minute dub is operator manual |

No GPU, no Whisper rewrite, no NLLB, no Cloudflare Worker.
