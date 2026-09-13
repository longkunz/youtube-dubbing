import pytest
from fastapi.testclient import TestClient

from app.cache import FileCache
from app.lang import normalize_lang
from app.main import create_app
from app.translate import (
    DelimiterMismatchError,
    HyMt2Translator,
    build_translate_prompt,
    join_cues,
    split_translation,
)


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
