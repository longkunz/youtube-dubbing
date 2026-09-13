from __future__ import annotations

import logging
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from app.cache import FileCache

log = logging.getLogger("uvicorn.error")


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
    import io
    import wave
    import numpy as np

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
