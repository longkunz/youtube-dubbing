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
