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
