from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from app.auth import require_bearer
from app.lang import normalize_lang


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

    @app.post("/v1/tts")
    async def tts(payload: dict, authorization: str | None = Header(default=None)):
        require_bearer(authorization, app.state.api_key)
        text = str(payload.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required")
        if len(text) > 500:
            text = text[:500].rsplit(" ", 1)[0] or text[:500]
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

    return app


def app_from_env() -> FastAPI:
    import os
    from app.runtime import build_runtime
    api_key = os.environ.get("BACKEND_API_KEY", "")
    translator, tts_engine = build_runtime()
    return create_app(api_key=api_key, translator=translator, tts_engine=tts_engine)
