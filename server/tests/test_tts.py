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
    first = engine.synthesize("23/8", "maichi")
    second = engine.synthesize("23/8", "maichi")
    assert first == second == b"ID3WAV"
    assert synth_calls == [("hai ba thang tam", "maichi")]
