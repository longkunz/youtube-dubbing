import pytest
from fastapi.testclient import TestClient

from app.cache import FileCache
from app.main import create_app
from app.tts import TtsEngine


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

    def synthesize(self, text: str, voice: str, rate: str, engine: str = "auto") -> bytes:
        self.last_engine = engine
        if engine == "edge":
            self.edge_calls.append(voice)
            return b"ID3FAKEEDGE"
        if engine == "piper" and self.fail_piper:
            self.piper_calls.append(text)
            raise RuntimeError("piper failed")
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


def test_text_over_500_chars_is_truncated_not_rejected():
    client, engine = make_client()
    response = client.post("/v1/tts", headers=auth(), json={"text": ("bây " * 200).strip(), "format": "mp3"})
    assert response.status_code == 200
    assert engine.piper_calls
    assert len(engine.piper_calls[0]) <= 500


def test_non_mp3_format_is_400():
    client, _ = make_client()
    response = client.post("/v1/tts", headers=auth(), json={"text": "Hi", "format": "wav"})
    assert response.status_code == 400


def test_edge_engine_allows_asyncio_run_inside_synthesize():
    """edge-tts uses asyncio.run; that must not run on uvicorn's event loop."""

    class NestedLoopTts:
        def status(self):
            return "piper"

        def breaker_state(self):
            return "closed"

        def synthesize(self, text: str, voice: str, rate: str, engine: str = "auto") -> bytes:
            import asyncio

            async def _go():
                return b"ID3FROMLOOP"

            return asyncio.run(_go())

    app = create_app(api_key="test-key", tts_engine=NestedLoopTts())
    client = TestClient(app)
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Xin chào", "format": "mp3", "engine": "edge"},
    )
    assert response.status_code == 200
    assert response.content == b"ID3FROMLOOP"


def test_engine_edge_skips_piper():
    client, engine = make_client()
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Xin chào", "voice": "vi-VN-NamMinhNeural", "format": "mp3", "engine": "edge"},
    )
    assert response.status_code == 200
    assert response.content == b"ID3FAKEEDGE"
    assert engine.piper_calls == []
    assert engine.edge_calls == ["vi-VN-NamMinhNeural"]


def test_engine_piper_does_not_fall_back_to_edge():
    tts = FakeTts()
    tts.fail_piper = True
    client, engine = make_client(tts)
    response = client.post(
        "/v1/tts",
        headers=auth(),
        json={"text": "Xin chào", "format": "mp3", "engine": "piper"},
    )
    assert response.status_code == 502
    assert engine.edge_calls == []


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
