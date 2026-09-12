from __future__ import annotations

import logging
from typing import Callable

from app.cache import FileCache

log = logging.getLogger("aetherdub.tts")

PiperFn = Callable[[str, str, str], bytes]
EdgeFn = Callable[[str, str, str], bytes]
Mp3Fn = Callable[[bytes], bytes]


def edge_voice_for(voice: str | None) -> str:
    raw = voice or ""
    if "NamMinh" in raw:
        return "vi-VN-NamMinhNeural"
    return "vi-VN-HoaiMyNeural"


class TtsEngine:
    def __init__(
        self,
        *,
        piper: PiperFn,
        edge: EdgeFn,
        to_mp3: Mp3Fn,
        cache: FileCache,
        piper_timeout_s: float = 2.5,
        edge_timeout_s: float = 8.0,
    ):
        self._piper = piper
        self._edge = edge
        self._to_mp3 = to_mp3
        self._cache = cache
        self.piper_timeout_s = piper_timeout_s
        self.edge_timeout_s = edge_timeout_s
        self._edge_failures = 0
        self._breaker_open = False

    def status(self) -> str:
        return "piper-only" if self._breaker_open else "piper"

    def breaker_state(self) -> str:
        return "open" if self._breaker_open else "closed"

    def synthesize(self, text: str, voice: str, rate: str) -> bytes:
        cache_key = f"{text}|{voice}|{rate}|mp3"
        hit = self._cache.get_bytes(cache_key)
        if hit is not None:
            log.info("tts cache hit chars=%s", len(text))
            return hit

        try:
            wav = self._piper(text, voice, rate)
            if not wav:
                raise RuntimeError("empty piper audio")
            mp3 = self._to_mp3(wav)
            self._cache.set_bytes(cache_key, mp3)
            log.info("tts engine=piper chars=%s", len(text))
            return mp3
        except Exception:
            log.info("tts piper failed chars=%s", len(text))

        if self._breaker_open:
            raise RuntimeError("tts unavailable: piper failed and edge breaker open")

        try:
            audio = self._edge(text, edge_voice_for(voice), rate)
            if not audio:
                raise RuntimeError("empty edge audio")
            mp3 = audio if audio[:3] == b"ID3" or audio[:2] == b"\xff\xfb" else self._to_mp3(audio)
            self._edge_failures = 0
            self._cache.set_bytes(cache_key, mp3)
            log.info("tts engine=edge-tts chars=%s", len(text))
            return mp3
        except Exception:
            self._edge_failures += 1
            if self._edge_failures >= 3:
                self._breaker_open = True
            log.info("tts edge failed chars=%s breaker=%s", len(text), self.breaker_state())
            raise
