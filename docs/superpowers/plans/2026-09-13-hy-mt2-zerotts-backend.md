# Hy-MT2 + ZeroTTS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Self-hosted Backend engines with in-process Hy-MT2-1.8B (CUDA) and ZeroTTS (CPU), no Piper/Edge/MMS/Opus-MT fallbacks, without changing the Chrome extension.

**Architecture:** FastAPI stays the deep module behind `POST /v1/translate`, `POST /v1/tts`, and `GET /v1/health`. Hy-MT2 delimiter-batches cues under a GPU lock; ZeroTTS synthesizes WAV under a CPU lock and ffmpeg encodes MP3. `create_app(api_key, translator, tts_engine)` remains the HTTP test seam. No files under `src/` or `tests/*.ts`.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, transformers ≥5.6, PyTorch CUDA, zerotts, ffmpeg, pytest.

**Spec:** `docs/superpowers/specs/2026-09-13-hy-mt2-zerotts-backend-design.md`

## Global Constraints

- Do not edit `src/`, `tests/*.ts`, HUD, Command Center, or Voice Profile UI.
- No `GET /v1/voices`. No mapping of `vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural` to ZeroTTS ids (those voices → HTTP 400).
- Target language after `normalize_lang` must be `vi`. Source must be in the Hy-MT2 primary-code set. `zh-Hant` collapses to `zh`.
- No second translate or TTS engine. Delimiter mismatch and engine errors → 502, never retry per-cue.
- No CUDA → translator unloaded → `/v1/translate` 503. ZeroTTS still loads on CPU.
- Mutating routes require `Authorization: Bearer <BACKEND_API_KEY>`. `GET /v1/health` is unauthenticated and must not include `ttsFallback` or `breaker`.
- Hy-MT2 sampling: `temperature=0.7`, `top_p=0.6`, `top_k=20`, `repetition_penalty=1.05`, `max_new_tokens=4096`. No system prompt.
- Call `normalize_vi_text` before ZeroTTS `synthesize`. Default `cfg_scale` only.
- TTS HTTP path: `asyncio.wait_for(asyncio.to_thread(...), 25)`.
- CI: never download Hy-MT2 or ZeroTTS; inject fakes.
- Run server tests from `server/`: `python -m pytest tests/<file>.py -v` (use `server/.venv/Scripts/python.exe` if that venv exists).
- Domain term: **Self-hosted Backend**. Do not add Hy-MT2 as a glossary term.

## File map

**Create**
- `server/tests/test_lang.py`
- `docs/adr/0014-hy-mt2-zerotts-gpu-backend.md`

**Modify**
- `server/app/lang.py` — Hy-MT2 code set + English names
- `server/app/translate.py` — replace Marian/CTranslate2 with `HyMt2Translator`
- `server/app/tts.py` — ZeroTTS `TtsEngine`, eight voice ids
- `server/app/main.py` — health, translate, tts contracts
- `server/app/runtime.py` — CUDA Hy-MT2 + ZeroTTS load; delete MMS/Piper/Edge
- `server/tests/test_translate.py`
- `server/tests/test_tts.py`
- `server/tests/test_health_auth.py`
- `server/pyproject.toml`
- `server/Dockerfile`
- `server/compose.yml`
- `server/scripts/download-models.sh`
- `docs/adr/0010-self-hosted-cpu-backend.md` — superseded
- `CONTEXT.md` — Self-hosted Backend definition
- `docs/superpowers/specs/2026-09-13-hy-mt2-zerotts-backend-design.md` — status accepted

**Unchanged**
- `server/app/auth.py`, `server/app/cache.py`, `server/app/__init__.py`

---

### Task 1: Hy-MT2 language table

**Files:**
- Modify: `server/app/lang.py`
- Create: `server/tests/test_lang.py`

**Interfaces:**
- Consumes: existing `normalize_lang(code: str | None) -> str`
- Produces: `HY_MT2_SOURCE_CODES: frozenset[str]`, `HY_MT2_ENGLISH_NAMES: dict[str, str]`, `is_supported_source(code: str) -> bool`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_lang.py`:

```python
from app.lang import (
    HY_MT2_ENGLISH_NAMES,
    HY_MT2_SOURCE_CODES,
    is_supported_source,
    normalize_lang,
)


def test_normalize_lang_strips_region():
    assert normalize_lang("en-US") == "en"
    assert normalize_lang("vi-VN") == "vi"
    assert normalize_lang("EN") == "en"
    assert normalize_lang("zh-Hant") == "zh"
    assert normalize_lang(None) == ""


def test_hy_mt2_source_set_includes_en_ja_vi_zh():
    for code in ("ar", "bn", "bo", "cs", "de", "en", "es", "fa", "fr", "gu", "he", "hi",
                 "id", "it", "ja", "kk", "km", "ko", "mn", "mr", "ms", "my", "nl", "pl",
                 "pt", "ru", "ta", "te", "th", "tl", "tr", "ug", "uk", "ur", "vi", "yue", "zh"):
        assert code in HY_MT2_SOURCE_CODES
        assert is_supported_source(code) is True
    assert is_supported_source("xx") is False
    assert is_supported_source("zh-Hant") is False


def test_english_names_cover_every_source_code():
    assert set(HY_MT2_ENGLISH_NAMES) == set(HY_MT2_SOURCE_CODES)
    assert HY_MT2_ENGLISH_NAMES["en"] == "English"
    assert HY_MT2_ENGLISH_NAMES["vi"] == "Vietnamese"
    assert HY_MT2_ENGLISH_NAMES["zh"] == "Chinese"
    assert HY_MT2_ENGLISH_NAMES["ja"] == "Japanese"
    assert HY_MT2_ENGLISH_NAMES["tl"] == "Filipino"
```

Move `test_normalize_lang_strips_region` out of `test_translate.py` in Task 3 (do not delete it from `test_translate.py` until then).

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_lang.py -v` from `server/`

Expected: FAIL (`HY_MT2_SOURCE_CODES` not defined, or import error)

- [ ] **Step 3: Implement `server/app/lang.py`**

Keep `normalize_lang` unchanged. Add:

```python
HY_MT2_ENGLISH_NAMES = {
    "ar": "Arabic",
    "bn": "Bengali",
    "bo": "Tibetan",
    "cs": "Czech",
    "de": "German",
    "en": "English",
    "es": "Spanish",
    "fa": "Persian",
    "fr": "French",
    "gu": "Gujarati",
    "he": "Hebrew",
    "hi": "Hindi",
    "id": "Indonesian",
    "it": "Italian",
    "ja": "Japanese",
    "kk": "Kazakh",
    "km": "Khmer",
    "ko": "Korean",
    "mn": "Mongolian",
    "mr": "Marathi",
    "ms": "Malay",
    "my": "Burmese",
    "nl": "Dutch",
    "pl": "Polish",
    "pt": "Portuguese",
    "ru": "Russian",
    "ta": "Tamil",
    "te": "Telugu",
    "th": "Thai",
    "tl": "Filipino",
    "tr": "Turkish",
    "ug": "Uyghur",
    "uk": "Ukrainian",
    "ur": "Urdu",
    "vi": "Vietnamese",
    "yue": "Cantonese",
    "zh": "Chinese",
}

HY_MT2_SOURCE_CODES = frozenset(HY_MT2_ENGLISH_NAMES)


def is_supported_source(code: str) -> bool:
    return code in HY_MT2_SOURCE_CODES
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_lang.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app/lang.py server/tests/test_lang.py
git commit -m "feat(server): add Hy-MT2 source language table"
```

---

### Task 2: `HyMt2Translator` delimiter batch

**Files:**
- Modify: `server/app/translate.py` (replace entire file)
- Modify: `server/tests/test_translate.py` (add unit tests for the translator class; HTTP tests stay until Task 3)

**Interfaces:**
- Consumes: `FileCache.get_text` / `set_text`, `CUESEP = "<CUESEP>"`
- Produces:
  - `class DelimiterMismatchError(Exception)`
  - `join_cues(texts: list[str]) -> str`
  - `split_translation(output: str) -> list[str]`
  - `build_translate_prompt(joined: str) -> str`
  - `class HyMt2Translator` with `translate_texts(self, texts: list[str], *, source: str) -> list[str]`
  - Constructor: `HyMt2Translator(generate: Callable[[str], str], cache: FileCache | None = None, lock: threading.Lock | None = None)`

- [ ] **Step 1: Write the failing unit tests**

Append to `server/tests/test_translate.py` (keep existing HTTP tests for now):

```python
import pytest

from app.cache import FileCache
from app.translate import DelimiterMismatchError, HyMt2Translator, build_translate_prompt, join_cues, split_translation


def test_join_and_split_roundtrip():
    joined = join_cues(["Welcome back", "Hello"])
    assert joined == "Welcome back\n<CUESEP>\nHello"
    assert split_translation("Chào mừng quay lại\n<CUESEP>\nXin chào") == [
        "Chào mừng quay lại",
        "Xin chào",
    ]


def test_split_counts_inline_and_empty_pieces():
    assert len(split_translation("A<CUESEP>B<CUESEP>")) == 3


def test_build_translate_prompt_uses_official_delimiter_instruction():
    prompt = build_translate_prompt("Hello\n<CUESEP>\nWorld")
    assert prompt.startswith("Please accurately translate the following text into Vietnamese.")
    assert "retain the exact same number of delimiters" in prompt
    assert prompt.endswith("Hello\n<CUESEP>\nWorld")


def test_hymt2_translate_texts_uses_generate_and_source_cache(tmp_path):
    calls = []

    def generate(prompt: str) -> str:
        calls.append(prompt)
        return "VI:Welcome back\n<CUESEP>\nVI:Hello"

    translator = HyMt2Translator(generate, cache=FileCache(tmp_path))
    out = translator.translate_texts(["Welcome back", "Hello"], source="en")
    assert out == ["VI:Welcome back", "VI:Hello"]
    assert len(calls) == 1
    cached = translator.translate_texts(["Welcome back", "Hello"], source="en")
    assert cached == out
    assert len(calls) == 1


def test_hymt2_partial_cache_only_sends_misses(tmp_path):
    cache = FileCache(tmp_path)
    cache.set_text("en|vi|Welcome back", "Đã cache")
    calls = []

    def generate(prompt: str) -> str:
        calls.append(prompt)
        assert "<CUESEP>" not in prompt.split("placement.")[-1]
        return "VI:Hello"

    translator = HyMt2Translator(generate, cache=cache)
    out = translator.translate_texts(["Welcome back", "Hello"], source="en")
    assert out == ["Đã cache", "VI:Hello"]
    assert len(calls) == 1


def test_hymt2_mismatch_raises_and_does_not_write_cache(tmp_path):
    cache = FileCache(tmp_path)

    def generate(prompt: str) -> str:
        return "only one piece"

    translator = HyMt2Translator(generate, cache=cache)
    with pytest.raises(DelimiterMismatchError):
        translator.translate_texts(["A", "B"], source="ja")
    assert cache.get_text("ja|vi|A") is None
    assert cache.get_text("ja|vi|B") is None
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python -m pytest tests/test_translate.py::test_join_and_split_roundtrip tests/test_translate.py::test_hymt2_mismatch_raises_and_does_not_write_cache -v`

Expected: FAIL (import error for `HyMt2Translator` / `DelimiterMismatchError`)

- [ ] **Step 3: Replace `server/app/translate.py`**

Delete `collapse_stutter`, `MarianBatchTranslator`, `CTranslate2Translator`. Implement:

```python
from __future__ import annotations

import threading
from collections.abc import Callable

from app.cache import FileCache

CUESEP = "<CUESEP>"

_PROMPT_PREFIX = (
    "Please accurately translate the following text into Vietnamese.\n"
    "You must retain the exact same number of delimiters in the translation. "
    "Strictly do not omit, escape, or translate these symbols, and pay close "
    "attention to their placement.\n\n"
)


class DelimiterMismatchError(Exception):
    """Hy-MT2 returned a different number of <CUESEP> pieces than non-empty cues."""


def join_cues(texts: list[str]) -> str:
    return f"\n{CUESEP}\n".join(texts)


def split_translation(output: str) -> list[str]:
    return [part.strip() for part in output.split(CUESEP)]


def build_translate_prompt(joined: str) -> str:
    return _PROMPT_PREFIX + joined


class HyMt2Translator:
    def __init__(
        self,
        generate: Callable[[str], str],
        cache: FileCache | None = None,
        lock: threading.Lock | None = None,
    ):
        self._generate = generate
        self._cache = cache
        self._lock = lock or threading.Lock()

    def translate_texts(self, texts: list[str], *, source: str) -> list[str]:
        results: list[str | None] = [None] * len(texts)
        pending_idx: list[int] = []
        pending_text: list[str] = []
        for i, text in enumerate(texts):
            if self._cache:
                hit = self._cache.get_text(f"{source}|vi|{text}")
                if hit is not None:
                    results[i] = hit
                    continue
            pending_idx.append(i)
            pending_text.append(text)
        if pending_text:
            prompt = build_translate_prompt(join_cues(pending_text))
            with self._lock:
                raw = self._generate(prompt)
            pieces = split_translation(raw)
            if len(pieces) != len(pending_text):
                raise DelimiterMismatchError(
                    f"expected {len(pending_text)} pieces, got {len(pieces)}"
                )
            for i, out in zip(pending_idx, pieces):
                results[i] = out
                if self._cache:
                    self._cache.set_text(f"{source}|vi|{texts[i]}", out)
        return results  # type: ignore[return-value]
```

- [ ] **Step 4: Run the new unit tests**

Run: `python -m pytest tests/test_translate.py::test_join_and_split_roundtrip tests/test_translate.py::test_split_counts_inline_and_empty_pieces tests/test_translate.py::test_build_translate_prompt_uses_official_delimiter_instruction tests/test_translate.py::test_hymt2_translate_texts_uses_generate_and_source_cache tests/test_translate.py::test_hymt2_partial_cache_only_sends_misses tests/test_translate.py::test_hymt2_mismatch_raises_and_does_not_write_cache -v`

Expected: PASS

Existing HTTP tests in the same file may FAIL until Task 3 (`MarianBatchTranslator` gone, `translate_texts` now requires `source=`). That is expected; do not revert Task 2 to keep Marian.

- [ ] **Step 5: Commit**

```bash
git add server/app/translate.py server/tests/test_translate.py
git commit -m "feat(server): replace Marian with Hy-MT2 delimiter translator"
```

---

### Task 3: `/v1/translate` HTTP contract

**Files:**
- Modify: `server/app/main.py` (`health` can wait until Task 4; this task changes `translate` and the translator call)
- Modify: `server/tests/test_translate.py` — rewrite HTTP tests; delete Marian/stutter tests

**Interfaces:**
- Consumes: `normalize_lang`, `is_supported_source`, `HyMt2Translator.translate_texts(texts, *, source)`, `DelimiterMismatchError`
- Produces: HTTP 400 `target must be vi` / `unsupported source language`; 502 `delimiter count mismatch` / `translation failed`; 503 `translator unavailable`; `source == target == vi` echo; `ja→vi` allowed

- [ ] **Step 1: Rewrite HTTP tests in `server/tests/test_translate.py`**

Replace `FakeTranslator`, `make_client`, and the HTTP tests. Delete `test_marian_batch_translator_uses_hf_tokenizer_not_spm`, `test_collapse_stutter_stops_bye_loops`, `_FakeTokenizer`, `_FakeCt2`, and `test_non_en_vi_pair_is_400`. Keep the Task 2 unit tests. HTTP section:

```python
from fastapi.testclient import TestClient

from app.lang import normalize_lang
from app.main import create_app
from app.translate import DelimiterMismatchError


class FakeTranslator:
    def __init__(self):
        self.calls = []

    def translate_texts(self, texts: list[str], *, source: str) -> list[str]:
        self.calls.append((source, list(texts)))
        return [f"VI:{t}" for t in texts]


def make_client(translator=None):
    app = create_app(api_key="test-key", translator=translator or FakeTranslator())
    return TestClient(app), app.state.translator


def auth():
    return {"Authorization": "Bearer test-key"}


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
    assert translator.calls == [("en", ["Welcome back", "Hello"])]


def test_translate_accepts_en_us_vi_vn():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en-US", "target": "vi-VN", "cues": [{"id": "1", "text": "Hi"}]},
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["text"] == "VI:Hi"
    assert translator.calls == [("en", ["Hi"])]


def test_ja_to_vi_is_200():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "ja", "target": "vi", "cues": [{"id": "1", "text": "こんにちは"}]},
    )
    assert response.status_code == 200
    assert translator.calls == [("ja", ["こんにちは"])]


def test_non_vi_target_is_400():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "fr", "target": "en", "cues": [{"id": "1", "text": "bonjour"}]},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "target must be vi"
    assert translator.calls == []


def test_unsupported_source_is_400():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "xx", "target": "vi", "cues": [{"id": "1", "text": "hi"}]},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "unsupported source language"
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


def test_same_source_and_target_vi_passthrough():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "vi", "target": "vi", "cues": [{"id": "1", "text": "Xin chào"}]},
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["text"] == "Xin chào"
    assert translator.calls == []


def test_en_to_en_is_400_not_echo():
    client, translator = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en", "target": "en", "cues": [{"id": "1", "text": "Hi"}]},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "target must be vi"
    assert translator.calls == []


def test_text_over_2000_chars_is_400():
    client, _ = make_client()
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en", "target": "vi", "cues": [{"id": "1", "text": "a" * 2001}]},
    )
    assert response.status_code == 400


def test_translator_none_is_503():
    app = create_app(api_key="test-key", translator=None)
    client = TestClient(app)
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en", "target": "vi", "cues": [{"id": "1", "text": "Hi"}]},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "translator unavailable"


def test_delimiter_mismatch_is_502():
    class BadTranslator:
        def translate_texts(self, texts, *, source):
            raise DelimiterMismatchError("expected 2 pieces, got 1")

    client, _ = make_client(BadTranslator())
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en", "target": "vi", "cues": [{"id": "1", "text": "A"}, {"id": "2", "text": "B"}]},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "delimiter count mismatch"


def test_generate_failure_is_502():
    class BoomTranslator:
        def translate_texts(self, texts, *, source):
            raise RuntimeError("cuda oom")

    client, _ = make_client(BoomTranslator())
    response = client.post(
        "/v1/translate",
        headers=auth(),
        json={"source": "en", "target": "vi", "cues": [{"id": "1", "text": "A"}]},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "translation failed"
```

- [ ] **Step 2: Run HTTP tests to verify they fail**

Run: `python -m pytest tests/test_translate.py::test_ja_to_vi_is_200 tests/test_translate.py::test_non_vi_target_is_400 tests/test_translate.py::test_delimiter_mismatch_is_502 -v`

Expected: FAIL (`ja→vi` still 400, or `translate_texts` TypeError missing `source`)

- [ ] **Step 3: Update `translate` in `server/app/main.py`**

Replace the language-pair block and the `translate_texts` call. After cue length checks:

```python
from app.lang import is_supported_source, normalize_lang
from app.translate import DelimiterMismatchError
```

Logic:

```python
        source = normalize_lang(payload.get("source"))
        target = normalize_lang(payload.get("target"))
        # ... cues empty / >50 / >2000 unchanged ...
        if target != "vi":
            raise HTTPException(status_code=400, detail="target must be vi")
        if source == "vi":
            items = [{"id": str(c.get("id", "")), "text": str(c.get("text") or "").strip()} for c in cues]
            return {"items": items}
        if not is_supported_source(source):
            raise HTTPException(status_code=400, detail="unsupported source language")
        if app.state.translator is None:
            raise HTTPException(status_code=503, detail="translator unavailable")
        # build items / to_model as today
        if to_model:
            try:
                translated = app.state.translator.translate_texts(to_model, source=source)
            except DelimiterMismatchError:
                raise HTTPException(status_code=502, detail="delimiter count mismatch")
            except Exception:
                log.exception("translate failed source=%s count=%s", source, len(to_model))
                raise HTTPException(status_code=502, detail="translation failed")
            for idx, text in zip(to_model_idx, translated):
                items[idx]["text"] = text
        return {"items": items}
```

Delete the old `source != "en" or target != "vi"` / `V1 only supports EN→VI` branch.

- [ ] **Step 4: Run all translate tests**

Run: `python -m pytest tests/test_translate.py tests/test_lang.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app/main.py server/tests/test_translate.py
git commit -m "feat(server): accept Hy-MT2 sources with vi target only"
```

---

### Task 4: ZeroTTS `/v1/tts` + health payload

**Files:**
- Modify: `server/app/tts.py` (replace entire file)
- Modify: `server/app/main.py` — `health`, `tts` voice check, `synthesize(text, voice)`, 25s `wait_for`
- Modify: `server/tests/test_tts.py` (replace entire file)
- Modify: `server/tests/test_health_auth.py`

**Interfaces:**
- Consumes: `FileCache`, injectable `normalize`, `synthesize_wav`, `to_mp3`
- Produces:
  - `ZERO_TTS_VOICES: frozenset[str]`
  - `is_zerotts_voice(voice: str) -> bool`
  - `TtsEngine.synthesize(self, text: str, voice: str) -> bytes`
  - `TtsEngine.status(self) -> str` returns `"ready"`
  - Health JSON: `{ok, translate, tts}` only (`ready` | `unavailable`)

- [ ] **Step 1: Write failing TTS and health tests**

Replace `server/tests/test_tts.py` with:

```python
import pytest
from fastapi.testclient import TestClient

from app.cache import FileCache
from app.main import create_app
from app.tts import ZERO_TTS_VOICES, TtsEngine, is_zerotts_voice

VOICES = (
    "maichi",
    "baotrang",
    "kimoanh",
    "hamy",
    "giahuy",
    "huuduc",
    "quangminh",
    "tiendat",
)


class FakeTts:
    def __init__(self):
        self.calls = []
        self.fail = False

    def status(self):
        return "ready"

    def synthesize(self, text: str, voice: str) -> bytes:
        self.calls.append((text, voice))
        if self.fail:
            raise RuntimeError("tts failed")
        return b"ID3FAKEZERO"


def make_client(tts=None):
    engine = tts or FakeTts()
    app = create_app(api_key="test-key", tts_engine=engine)
    return TestClient(app), engine


def auth():
    return {"Authorization": "Bearer test-key"}


def test_zero_tts_voice_set():
    assert set(VOICES) == set(ZERO_TTS_VOICES)
    assert is_zerotts_voice("maichi") is True
    assert is_zerotts_voice("vi-VN-HoaiMyNeural") is False


@pytest.mark.parametrize("voice", VOICES)
def test_tts_returns_mpeg_for_each_zerotts_voice(voice):
    client, engine = make_client()
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Chào mừng quay lại", "lang": "vi-VN", "voice": voice, "rate": "+0%", "format": "mp3"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert response.content == b"ID3FAKEZERO"
    assert engine.calls == [("Chào mừng quay lại", voice)]


def test_legacy_edge_voice_is_400():
    client, engine = make_client()
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Xin chào", "voice": "vi-VN-HoaiMyNeural", "format": "mp3"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "unknown voice"
    assert engine.calls == []


def test_missing_voice_is_400():
    client, engine = make_client()
    response = client.post("/v1/tts", headers=auth(), json={"text": "Xin chào", "format": "mp3"})
    assert response.status_code == 400
    assert response.json()["detail"] == "unknown voice"
    assert engine.calls == []


def test_empty_text_is_400():
    client, _ = make_client()
    response = client.post("/v1/tts", headers=auth(), json={"text": "  ", "voice": "maichi", "format": "mp3"})
    assert response.status_code == 400


def test_text_over_500_chars_is_truncated_not_rejected():
    client, engine = make_client()
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": ("bây " * 200).strip(), "voice": "maichi", "format": "mp3"},
    )
    assert response.status_code == 200
    assert engine.calls
    assert len(engine.calls[0][0]) <= 500


def test_non_mp3_format_is_400():
    client, _ = make_client()
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Hi", "voice": "maichi", "format": "wav"},
    )
    assert response.status_code == 400


def test_engine_piper_is_ignored():
    client, engine = make_client()
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Xin chào", "voice": "giahuy", "format": "mp3", "engine": "piper"},
    )
    assert response.status_code == 200
    assert engine.calls == [("Xin chào", "giahuy")]


def test_synthesize_runs_off_event_loop():
    class NestedLoopTts:
        def status(self):
            return "ready"

        def synthesize(self, text: str, voice: str) -> bytes:
            import asyncio

            async def _go():
                return b"ID3FROMLOOP"

            return asyncio.run(_go())

    app = create_app(api_key="test-key", tts_engine=NestedLoopTts())
    client = TestClient(app)
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Xin chào", "voice": "maichi", "format": "mp3"},
    )
    assert response.status_code == 200
    assert response.content == b"ID3FROMLOOP"


def test_tts_engine_none_is_503():
    app = create_app(api_key="test-key", tts_engine=None)
    client = TestClient(app)
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Hi", "voice": "maichi", "format": "mp3"},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "tts unavailable"


def test_tts_failure_is_502():
    tts = FakeTts()
    tts.fail = True
    client, _ = make_client(tts)
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Hi", "voice": "maichi", "format": "mp3"},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "tts synthesis failed"


def test_tts_engine_normalizes_and_caches(tmp_path):
    synth_calls = []

    def synthesize_wav(text: str, voice: str):
        synth_calls.append((text, voice))
        return b"WAV"

    def to_mp3(data: bytes) -> bytes:
        return b"ID3" + data

    def normalize(text: str) -> str:
        return text.replace("23/8", "hai ba thang tam")

    engine = TtsEngine(
        synthesize_wav=synthesize_wav,
        to_mp3=to_mp3,
        normalize=normalize,
        cache=FileCache(tmp_path),
    )
    first = engine.synthesize("Ngay 23/8", "maichi")
    second = engine.synthesize("Ngay 23/8", "maichi")
    assert first == second == b"ID3WAV"
    assert synth_calls == [("hai ba thang tam", "maichi")]
```

Replace health assertions in `server/tests/test_health_auth.py`:

```python
def test_health_is_unauthenticated_and_reports_unavailable_engines():
    app = create_app(api_key="test-key", translator=None, tts_engine=None)
    client = TestClient(app)
    response = client.get("/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["translate"] == "unavailable"
    assert body["tts"] == "unavailable"
    assert "ttsFallback" not in body
    assert "breaker" not in body
```

Add (same file):

```python
def test_health_ready_when_engines_injected():
    class Ready:
        def status(self):
            return "ready"

    app = create_app(api_key="test-key", translator=object(), tts_engine=Ready())
    body = TestClient(app).get("/v1/health").json()
    assert body == {"ok": True, "translate": "ready", "tts": "ready"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_tts.py::test_legacy_edge_voice_is_400 tests/test_health_auth.py::test_health_is_unauthenticated_and_reports_unavailable_engines -v`

Expected: FAIL (legacy voice 200, or `ttsFallback` still present)

- [ ] **Step 3: Implement `server/app/tts.py` and wire `main.py`**

`server/app/tts.py`:

```python
from __future__ import annotations

import logging
import threading
from collections.abc import Callable

from app.cache import FileCache

log = logging.getLogger("aetherdub.tts")

ZERO_TTS_VOICES = frozenset(
    {
        "maichi",
        "baotrang",
        "kimoanh",
        "hamy",
        "giahuy",
        "huuduc",
        "quangminh",
        "tiendat",
    }
)

NormalizeFn = Callable[[str], str]
SynthFn = Callable[[str, str], bytes]
Mp3Fn = Callable[[bytes], bytes]


def is_zerotts_voice(voice: str) -> bool:
    return voice in ZERO_TTS_VOICES


class TtsEngine:
    def __init__(
        self,
        *,
        synthesize_wav: SynthFn,
        to_mp3: Mp3Fn,
        normalize: NormalizeFn,
        cache: FileCache,
        lock: threading.Lock | None = None,
    ):
        self._synthesize_wav = synthesize_wav
        self._to_mp3 = to_mp3
        self._normalize = normalize
        self._cache = cache
        self._lock = lock or threading.Lock()

    def status(self) -> str:
        return "ready"

    def synthesize(self, text: str, voice: str) -> bytes:
        normalized = self._normalize(text)
        cache_key = f"zerotts|{voice}|{normalized}|mp3"
        hit = self._cache.get_bytes(cache_key)
        if hit is not None:
            log.info("tts cache hit chars=%s voice=%s", len(text), voice)
            return hit
        with self._lock:
            wav = self._synthesize_wav(normalized, voice)
            if not wav:
                raise RuntimeError("empty zerotts audio")
            mp3 = self._to_mp3(wav)
        self._cache.set_bytes(cache_key, mp3)
        log.info("tts engine=zerotts chars=%s voice=%s", len(text), voice)
        return mp3
```

In `create_app` health:

```python
        tts = app.state.tts_engine
        return {
            "ok": True,
            "translate": "ready" if app.state.translator is not None else "unavailable",
            "tts": tts.status() if tts is not None else "unavailable",
        }
```

In `tts` route: after format check, **before** engine None check:

```python
        voice = str(payload.get("voice") or "").strip()
        if not is_zerotts_voice(voice):
            raise HTTPException(status_code=400, detail="unknown voice")
```

Replace the `to_thread` call:

```python
        try:
            audio = await asyncio.wait_for(
                asyncio.to_thread(app.state.tts_engine.synthesize, text, voice),
                timeout=25,
            )
        except Exception:
            log.exception("tts synthesis failed voice=%s chars=%s", voice, len(text))
            raise HTTPException(status_code=502, detail="tts synthesis failed")
```

Import `is_zerotts_voice` from `app.tts`. Do not default `voice` to `vi-VN-HoaiMyNeural`. Ignore `engine` / `rate`.

Map `asyncio.TimeoutError` into the same 502 (it is an `Exception`).

- [ ] **Step 4: Run TTS, health, and translate tests**

Run: `python -m pytest tests/test_tts.py tests/test_health_auth.py tests/test_translate.py tests/test_lang.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app/tts.py server/app/main.py server/tests/test_tts.py server/tests/test_health_auth.py
git commit -m "feat(server): ZeroTTS-only /v1/tts and slim health payload"
```

---

### Task 5: Runtime load + Docker GPU image

**Files:**
- Modify: `server/app/runtime.py` (replace entire file)
- Create tests in `server/tests/test_runtime.py`
- Modify: `server/pyproject.toml`
- Modify: `server/Dockerfile`
- Modify: `server/compose.yml`
- Modify: `server/scripts/download-models.sh`

**Interfaces:**
- Consumes: `HyMt2Translator`, `TtsEngine`, `FileCache`, `_cuda_device_present`
- Produces: `build_runtime(model_root_str=None, cache_root_str=None, *, load_translator=None, load_tts=None) -> tuple[HyMt2Translator | None, TtsEngine | None]`
  - `load_translator(cache: FileCache) -> HyMt2Translator | None`
  - `load_tts(cache: FileCache) -> TtsEngine | None`
  - Default factories perform real Hub loads (not called in pytest)

- [ ] **Step 1: Write failing runtime tests**

Create `server/tests/test_runtime.py`:

```python
from app.runtime import build_runtime


class FakeTranslator:
    pass


class FakeTts:
    def status(self):
        return "ready"


def test_build_runtime_without_translator_factory_returns_none(tmp_path):
    tts = FakeTts()
    translator, engine = build_runtime(
        model_root_str=str(tmp_path / "models"),
        cache_root_str=str(tmp_path / "cache"),
        load_translator=lambda cache: None,
        load_tts=lambda cache: tts,
    )
    assert translator is None
    assert engine is tts


def test_build_runtime_uses_injected_translator(tmp_path):
    tr = FakeTranslator()
    tts = FakeTts()
    translator, engine = build_runtime(
        model_root_str=str(tmp_path / "models"),
        cache_root_str=str(tmp_path / "cache"),
        load_translator=lambda cache: tr,
        load_tts=lambda cache: tts,
    )
    assert translator is tr
    assert engine is tts


def test_build_runtime_swallows_tts_load_failure(tmp_path):
    def load_tts(cache):
        raise RuntimeError("hub down")

    translator, engine = build_runtime(
        model_root_str=str(tmp_path / "models"),
        cache_root_str=str(tmp_path / "cache"),
        load_translator=lambda cache: None,
        load_tts=load_tts,
    )
    assert translator is None
    assert engine is None
```

The swallow-failure behavior must live **inside** `build_runtime` around the default/injected factories: wrap `load_tts` / `load_translator` in try/except, log, return `None`.

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_runtime.py -v`

Expected: FAIL (`load_translator` unexpected kwarg)

- [ ] **Step 3: Implement runtime, deps, image, download script**

`server/app/runtime.py` outline (no Piper, Edge, MMS):

```python
def _cuda_device_present() -> bool:
    vis = os.environ.get("CUDA_VISIBLE_DEVICES", "unset")
    if vis in ("", "-1"):
        return False
    return Path("/dev/nvidia0").exists()


def wav_to_mp3(data: bytes) -> bytes:
    fd_in, in_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd_in)
    fd_out, out_path = tempfile.mkstemp(suffix=".mp3")
    os.close(fd_out)
    inp = Path(in_path)
    out = Path(out_path)
    try:
        inp.write_bytes(data)
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(inp), "-codec:a", "libmp3lame", "-b:a", "128k", str(out)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return out.read_bytes()
    finally:
        if inp.exists():
            inp.unlink()
        if out.exists():
            out.unlink()


def _float32_to_wav_bytes(audio, sample_rate: int) -> bytes:
    import numpy as np
    import io, wave
    pcm = (np.clip(np.asarray(audio).reshape(-1), -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def default_load_translator(cache: FileCache):
    if not _cuda_device_present():
        log.info("hy-mt2 skipped: no NVIDIA device")
        return None
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from app.translate import HyMt2Translator

    model_id = "tencent/Hy-MT2-1.8B"
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        dtype=torch.bfloat16,
        device_map="cuda",
        trust_remote_code=True,
    )
    model.eval()
    lock = threading.Lock()

    def generate(prompt: str) -> str:
        messages = [{"role": "user", "content": prompt}]
        input_ids = tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, return_tensors="pt"
        )
        if hasattr(input_ids, "to"):
            input_ids = input_ids.to(model.device)
            outputs = model.generate(
                input_ids,
                max_new_tokens=4096,
                temperature=0.7,
                top_p=0.6,
                top_k=20,
                repetition_penalty=1.05,
            )
            new_tokens = outputs[0][input_ids.shape[-1] :]
        else:
            inputs = {k: v.to(model.device) for k, v in input_ids.items()}
            outputs = model.generate(
                **inputs,
                max_new_tokens=4096,
                temperature=0.7,
                top_p=0.6,
                top_k=20,
                repetition_penalty=1.05,
            )
            new_tokens = outputs[0][inputs["input_ids"].shape[-1] :]
        return tokenizer.decode(new_tokens, skip_special_tokens=True)

    log.info("hy-mt2-1.8b ready on cuda")
    return HyMt2Translator(generate, cache=cache, lock=lock)


def default_load_tts(cache: FileCache):
    from zerotts import ZeroTTS, normalize_vi_text
    from zerotts.chunking import chunk_text, clean_segment_punctuation, normalize_punctuation
    from app.tts import TtsEngine

    tts = ZeroTTS.from_pretrained("zeroweight-ai/ZeroTTS")

    def synthesize_wav(text: str, voice: str) -> bytes:
        segments = [
            clean_segment_punctuation(s)
            for s in chunk_text(normalize_punctuation(text), max_chunk_sec=15)
        ] or [text]
        chunks = []
        for segment in segments:
            audio = tts.synthesize(segment, voice=voice)
            chunks.append(audio.reshape(-1))
        import numpy as np
        waveform = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        return _float32_to_wav_bytes(waveform, tts.sample_rate)

    return TtsEngine(
        synthesize_wav=synthesize_wav,
        to_mp3=wav_to_mp3,
        normalize=normalize_vi_text,
        cache=cache,
    )


def build_runtime(
    model_root_str: str | None = None,
    cache_root_str: str | None = None,
    *,
    load_translator=None,
    load_tts=None,
):
    cache_root_str = cache_root_str or os.environ.get("CACHE_ROOT", "/cache")
    cache = FileCache(cache_root_str)
    load_translator = load_translator or default_load_translator
    load_tts = load_tts or default_load_tts
    translator = None
    tts_engine = None
    try:
        translator = load_translator(cache)
    except Exception as exc:
        log.info("translator unavailable: %s", exc)
        translator = None
    try:
        tts_engine = load_tts(cache)
    except Exception as exc:
        log.info("tts unavailable: %s", exc)
        tts_engine = None
    return translator, tts_engine
```

`HyMt2Translator` already locks around `_generate`. `default_load_translator` may pass the same lock; do not double-lock inside `generate` itself — the translator holds the lock. **Do not** wrap `generate` in another lock if the translator lock already covers `_generate`. Pass `lock` into `HyMt2Translator` only.

`server/pyproject.toml` dependencies (dev extra unchanged):

```toml
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "zerotts",
  "transformers>=5.6.0",
  "huggingface_hub>=0.26",
]
```

Remove `ctranslate2`, `sentencepiece`, `edge-tts`, `piper-tts`.

`server/Dockerfile`: keep `python:3.11-slim-bookworm`, `ffmpeg`, torch CUDA `cu124` install, `pip install .` (now pulls zerotts + transformers). Remove the comment about ct2 if stale. Keep `download-models.sh` + uvicorn CMD. Do not install piper.

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
      HF_HOME: /models/hf-cache
      PYTHONUNBUFFERED: "1"
      NVIDIA_VISIBLE_DEVICES: all
    gpus: all
    volumes:
      - ./models:/models
      - ./cache:/cache
    restart: unless-stopped
```

Comment at top of `compose.yml`: NVIDIA Container Toolkit required for `/v1/translate`; without a GPU the container still starts and TTS may be ready.

`server/scripts/download-models.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="${MODEL_ROOT:-/models}"
export HF_HOME="${HF_HOME:-$ROOT/hf-cache}"
mkdir -p "$HF_HOME"
python - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download("tencent/Hy-MT2-1.8B")
snapshot_download("zeroweight-ai/ZeroTTS")
print("models ready")
PY
```

Do not download Opus-MT or Piper.

- [ ] **Step 4: Run server pytest (no Hub downloads)**

Run: `python -m pytest tests -v`

Expected: PASS (runtime tests use injected factories only)

- [ ] **Step 5: Commit**

```bash
git add server/app/runtime.py server/tests/test_runtime.py server/pyproject.toml server/Dockerfile server/compose.yml server/scripts/download-models.sh
git commit -m "feat(server): load Hy-MT2 on CUDA and ZeroTTS on CPU"
```

---

### Task 6: ADR-0014 + glossary

**Files:**
- Create: `docs/adr/0014-hy-mt2-zerotts-gpu-backend.md`
- Modify: `docs/adr/0010-self-hosted-cpu-backend.md`
- Modify: `CONTEXT.md` (Self-hosted Backend entry only)
- Modify: `docs/superpowers/specs/2026-09-13-hy-mt2-zerotts-backend-design.md` — set `Status: accepted`

**Interfaces:**
- Consumes: decisions in the spec
- Produces: ADR-0014 accepted; ADR-0010 superseded; glossary without Hy-MT2 as a term

- [ ] **Step 1: Write ADR-0014**

```markdown
---
status: accepted
date: 2026-09-13
---

# 14. GPU Hy-MT2 and CPU ZeroTTS for the Self-hosted Backend

We replaced the ADR-0010 CPU stack (CTranslate2 Opus-MT, Piper, Edge TTS, optional MMS) with a single translation model and a single TTS model and no server-side fallback. `POST /v1/translate` runs Tencent Hy-MT2-1.8B in-process with transformers BF16 on NVIDIA CUDA; source may be any Hy-MT2 language and target must be Vietnamese. `POST /v1/tts` runs ZeroTTS on CPU and returns MP3; voice must be one of the eight published ZeroTTS ids. Missing GPU leaves translate unavailable (503) rather than loading a second MT model. This supersedes ADR-0010.
```

- [ ] **Step 2: Mark ADR-0010 superseded**

In `docs/adr/0010-self-hosted-cpu-backend.md` frontmatter:

```yaml
status: superseded by ADR-0014
date: 2026-09-12
```

- [ ] **Step 3: Update CONTEXT.md Self-hosted Backend**

Replace the Self-hosted Backend definition with:

```markdown
**Self-hosted Backend**:
Operator-run Docker service exposing `/v1/translate` and `/v1/tts` for cue text into Vietnamese and MP3 speech.
_Avoid_: the API, cloud, our server
```

Do not add a Hy-MT2 glossary term. Leave the existing **ZeroTTS Engine** term in place (already defined).

Set spec status to `accepted`.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0014-hy-mt2-zerotts-gpu-backend.md docs/adr/0010-self-hosted-cpu-backend.md CONTEXT.md docs/superpowers/specs/2026-09-13-hy-mt2-zerotts-backend-design.md
git commit -m "docs(adr-0014): Hy-MT2 GPU + ZeroTTS CPU self-hosted backend"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| Hy-MT2 source set, `zh-Hant` → `zh` | 1 |
| Delimiter batch, cache keys, mismatch no-write | 2 |
| HTTP translate 400/502/503, `ja→vi`, `vi→vi` echo, `en→en` 400 | 3 |
| ZeroTTS ids only, ignore engine, 25s wait_for, health without fallback fields, TTS cache | 4 |
| CUDA load, ZeroTTS load, ffmpeg, compose GPU, Hub prefetch, pyproject | 5 |
| ADR-0014, supersede 0010, CONTEXT | 6 |
| No `src/` edits, no `/v1/voices`, no Edge voice map | Global + every task |
| Frontend 30s timeout / 8-voice HUD | Out of scope (spec §11) |
