from __future__ import annotations

import logging
import threading
from collections.abc import Callable

from app.cache import FileCache

log = logging.getLogger("aetherdub.tts")

ZERO_TTS_VOICES = frozenset(
    {
        "maichi",
        "baotrang",
        "kimoanh",
        "hamy",
        "giahuy",
        "huuduc",
        "quangminh",
        "tiendat",
    }
)

NormalizeFn = Callable[[str], str]
SynthFn = Callable[[str, str], bytes]
Mp3Fn = Callable[[bytes], bytes]


def is_zerotts_voice(voice: str) -> bool:
    return voice in ZERO_TTS_VOICES


class TtsEngine:
    def __init__(
        self,
        *,
        synthesize_wav: SynthFn,
        to_mp3: Mp3Fn,
        normalize: NormalizeFn,
        cache: FileCache,
        lock: threading.Lock | None = None,
    ):
        self._synthesize_wav = synthesize_wav
        self._to_mp3 = to_mp3
        self._normalize = normalize
        self._cache = cache
        self._lock = lock or threading.Lock()

    def status(self) -> str:
        return "ready"

    def synthesize(self, text: str, voice: str) -> bytes:
        normalized = self._normalize(text)
        cache_key = f"zerotts|{voice}|{normalized}|mp3"
        hit = self._cache.get_bytes(cache_key)
        if hit is not None:
            log.info("tts cache hit chars=%s voice=%s", len(text), voice)
            return hit
        with self._lock:
            wav = self._synthesize_wav(normalized, voice)
            if not wav:
                raise RuntimeError("empty zerotts audio")
            mp3 = self._to_mp3(wav)
        self._cache.set_bytes(cache_key, mp3)
        log.info("tts engine=zerotts chars=%s voice=%s", len(text), voice)
        return mp3
