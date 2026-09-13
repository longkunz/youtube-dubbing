from __future__ import annotations

import threading
from collections.abc import Callable

from app.cache import FileCache

CUESEP = "<CUESEP>"

_PROMPT_PREFIX = (
    "Please accurately translate the following text into Vietnamese.\n"
    "You must retain the exact same number of delimiters in the translation. "
    "Strictly do not omit, escape, or translate these symbols, and pay close "
    "attention to their placement.\n\n"
)


class DelimiterMismatchError(Exception):
    """Hy-MT2 returned a different number of <CUESEP> pieces than non-empty cues."""


def join_cues(texts: list[str]) -> str:
    return f"\n{CUESEP}\n".join(texts)


def split_translation(output: str) -> list[str]:
    return [part.strip() for part in output.split(CUESEP)]


def build_translate_prompt(joined: str) -> str:
    return _PROMPT_PREFIX + joined


class HyMt2Translator:
    def __init__(
        self,
        generate: Callable[[str], str],
        cache: FileCache | None = None,
        lock: threading.Lock | None = None,
    ):
        self._generate = generate
        self._cache = cache
        self._lock = lock or threading.Lock()

    def translate_texts(self, texts: list[str], *, source: str) -> list[str]:
        results: list[str | None] = [None] * len(texts)
        pending_idx: list[int] = []
        pending_text: list[str] = []
        for i, text in enumerate(texts):
            if self._cache:
                hit = self._cache.get_text(f"{source}|vi|{text}")
                if hit is not None:
                    results[i] = hit
                    continue
            pending_idx.append(i)
            pending_text.append(text)
        if pending_text:
            prompt = build_translate_prompt(join_cues(pending_text))
            with self._lock:
                raw = self._generate(prompt)
            pieces = split_translation(raw)
            if len(pieces) != len(pending_text):
                raise DelimiterMismatchError(
                    f"expected {len(pending_text)} pieces, got {len(pieces)}"
                )
            for i, out in zip(pending_idx, pieces):
                results[i] = out
                if self._cache:
                    self._cache.set_text(f"{source}|vi|{texts[i]}", out)
        return results  # type: ignore[return-value]
