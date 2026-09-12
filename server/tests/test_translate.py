from fastapi.testclient import TestClient

from app.lang import normalize_lang
from app.main import create_app
from app.translate import MarianBatchTranslator, collapse_stutter


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


class _FakeTokenizer:
    def encode(self, text: str):
        return [1, 2]

    def convert_ids_to_tokens(self, ids):
        return ["▁Hello", "</s>"]

    def convert_tokens_to_ids(self, tokens):
        return [3, 4]

    def decode(self, ids):
        return "Xin chào"


class _FakeCt2:
    def translate_batch(self, tokens, **kwargs):
        class _Result:
            hypotheses = [["▁Xin", "▁chào"]]

        assert tokens == [["▁Hello", "</s>"]]
        assert kwargs.get("max_decoding_length") == 80
        assert kwargs.get("no_repeat_ngram_size") == 3
        return [_Result()]


def test_marian_batch_translator_uses_hf_tokenizer_not_spm():
    translator = MarianBatchTranslator(_FakeCt2(), _FakeTokenizer())
    assert translator.translate_batch(["Hello"]) == ["Xin chào"]


def test_collapse_stutter_stops_bye_loops():
    assert collapse_stutter("Vì vậy, bây bây bây bây bây bây bây bây.") == "Vì vậy, bây."
