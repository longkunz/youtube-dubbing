from app.cache import FileCache
from app.lang import normalize_lang


class CTranslate2Translator:
    def __init__(self, translator, cache: FileCache | None = None):
        self._translator = translator
        self._cache = cache

    def translate_texts(self, texts: list[str]) -> list[str]:
        results = [None] * len(texts)
        pending_idx = []
        pending_text = []
        for i, text in enumerate(texts):
            if self._cache:
                hit = self._cache.get_text(f"en|vi|{text}")
                if hit is not None:
                    results[i] = hit
                    continue
            pending_idx.append(i)
            pending_text.append(text)
        if pending_text:
            translated = self._translator.translate_batch(pending_text)
            for i, out in zip(pending_idx, translated):
                results[i] = out
                if self._cache:
                    self._cache.set_text(f"en|vi|{texts[i]}", out)
        return results
