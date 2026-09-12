from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
from pathlib import Path

import io
import logging
import wave

from app.cache import FileCache
from app.translate import CTranslate2Translator, MarianBatchTranslator
from app.tts import TtsEngine

log = logging.getLogger("uvicorn.error")


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


def _float_to_wav_bytes(waveform, sample_rate: int) -> bytes:
    import numpy as np

    audio = waveform.squeeze().detach().cpu().numpy()
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def _cuda_device_present() -> bool:
    """Do not call torch.cuda.is_available() unless a device node exists.

    CUDA wheels on a CPU-only host can hang inside the CUDA probe.
    """
    vis = os.environ.get("CUDA_VISIBLE_DEVICES", "unset")
    if vis in ("", "-1"):
        return False
    return Path("/dev/nvidia0").exists()


def try_load_mms(model_root: Path):
    """Load facebook/mms-tts-vie on CUDA. Returns None without a GPU."""
    if not _cuda_device_present():
        log.info("mms-tts skipped: no NVIDIA device, using Piper for local TTS")
        return None
    try:
        import torch
        from transformers import AutoTokenizer, VitsModel
    except Exception as exc:
        log.info("mms-tts skipped: %s", exc)
        return None
    if not torch.cuda.is_available():
        log.info("mms-tts skipped: CUDA not available, using Piper for local TTS")
        return None
    hf_cache = str(model_root / "hf-cache")
    model = VitsModel.from_pretrained("facebook/mms-tts-vie", cache_dir=hf_cache).to("cuda")
    tokenizer = AutoTokenizer.from_pretrained("facebook/mms-tts-vie", cache_dir=hf_cache)
    model.eval()
    log.info("mms-tts-vie ready on cuda")
    return model, tokenizer


def make_mms_synth(bundle):
    model, tokenizer = bundle

    def mms_synth(text: str, voice: str, rate: str) -> bytes:
        import torch

        inputs = tokenizer(text, return_tensors="pt").to("cuda")
        with torch.no_grad():
            waveform = model(**inputs).waveform
        return _float_to_wav_bytes(waveform, model.config.sampling_rate)

    return mms_synth


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
        hf_cache = str(model_root / "hf-cache")
        live = MarianBatchTranslator.load(str(opus_dir), cache_dir=hf_cache)
        translator = CTranslate2Translator(live, cache=cache)

    mms = try_load_mms(model_root)
    local_synth = make_mms_synth(mms) if mms is not None else piper_synth
    piper_model = model_root / "piper" / "vi_VN-vais1000-medium.onnx"
    tts_engine = None
    if mms is not None or piper_model.is_file():
        tts_engine = TtsEngine(
            piper=local_synth,
            edge=edge_synth,
            to_mp3=wav_to_mp3,
            cache=cache,
            piper_timeout_s=float(os.environ.get("PIPER_TIMEOUT", "8.0" if mms else "2.5")),
            edge_timeout_s=float(os.environ.get("EDGE_TIMEOUT", "8.0")),
        )

    return translator, tts_engine
