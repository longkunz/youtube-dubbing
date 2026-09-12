from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
from pathlib import Path

from app.cache import FileCache
from app.translate import CTranslate2Translator
from app.tts import TtsEngine


def piper_synth(text: str, voice: str, rate: str) -> bytes:
    model_root = Path(os.environ.get("MODEL_ROOT", "/models"))
    model = model_root / "piper" / "vi_VN-vais1000-medium.onnx"
    fd, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    out = Path(out_path)
    try:
        subprocess.run(
            ["piper", "--model", str(model), "--output_file", str(out)],
            input=text.encode("utf-8"),
            check=True,
            timeout=float(os.environ.get("PIPER_TIMEOUT", "2.5")),
        )
        return out.read_bytes()
    finally:
        if out.exists():
            out.unlink()


def edge_synth(text: str, voice: str, rate: str) -> bytes:
    import edge_tts

    async def _run():
        communicate = edge_tts.Communicate(text, voice, rate=rate)
        audio = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
        return bytes(audio)

    timeout_s = float(os.environ.get("EDGE_TIMEOUT", "8.0"))
    return asyncio.run(asyncio.wait_for(_run(), timeout=timeout_s))


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


def build_runtime(model_root_str: str | None = None, cache_root_str: str | None = None):
    model_root_str = model_root_str or os.environ.get("MODEL_ROOT", "/models")
    cache_root_str = cache_root_str or os.environ.get("CACHE_ROOT", "/cache")
    model_root = Path(model_root_str)
    cache = FileCache(cache_root_str)

    translator = None
    opus_dir = model_root / "opus-mt-en-vi"
    if (opus_dir / "model.bin").is_file():
        import ctranslate2
        import sentencepiece

        class LiveTranslator:
            def __init__(self, model_path: str):
                self.ct2 = ctranslate2.Translator(model_path, device="cpu")
                self.sp_src = sentencepiece.SentencePieceProcessor()
                self.sp_src.load(os.path.join(model_path, "source.spm"))
                self.sp_tgt = sentencepiece.SentencePieceProcessor()
                self.sp_tgt.load(os.path.join(model_path, "target.spm"))

            def translate_batch(self, texts: list[str]) -> list[str]:
                tokens = [self.sp_src.encode(t, out_type=str) for t in texts]
                results = self.ct2.translate_batch(tokens)
                return [self.sp_tgt.decode(r.hypotheses[0]) for r in results]

        translator = CTranslate2Translator(LiveTranslator(str(opus_dir)), cache=cache)

    tts_engine = None
    piper_model = model_root / "piper" / "vi_VN-vais1000-medium.onnx"
    if piper_model.is_file():
        tts_engine = TtsEngine(
            piper=piper_synth,
            edge=edge_synth,
            to_mp3=wav_to_mp3,
            cache=cache,
            piper_timeout_s=float(os.environ.get("PIPER_TIMEOUT", "2.5")),
            edge_timeout_s=float(os.environ.get("EDGE_TIMEOUT", "8.0")),
        )

    return translator, tts_engine
