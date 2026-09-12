from app.cache import FileCache


class MarianBatchTranslator:
    """CTranslate2 Marian weights + Hugging Face tokenizer (not source.spm).

    `ct2-transformers-converter` writes model.bin and does not copy SentencePiece
    files. Official CTranslate2 usage is AutoTokenizer.encode → translate_batch.
    """

    HF_MODEL = "Helsinki-NLP/opus-mt-en-vi"

    def __init__(self, ct2, tokenizer):
        self._ct2 = ct2
        self._tokenizer = tokenizer

    @classmethod
    def load(cls, model_path: str, cache_dir: str | None = None):
        import ctranslate2
        from transformers import AutoTokenizer

        ct2 = ctranslate2.Translator(model_path, device="cpu")
        try:
            tokenizer = AutoTokenizer.from_pretrained(model_path)
        except Exception:
            tokenizer = AutoTokenizer.from_pretrained(cls.HF_MODEL, cache_dir=cache_dir)
        return cls(ct2, tokenizer)

    def translate_batch(self, texts: list[str]) -> list[str]:
        tokens = [
            self._tokenizer.convert_ids_to_tokens(self._tokenizer.encode(text))
            for text in texts
        ]
        results = self._ct2.translate_batch(tokens)
        return [
            self._tokenizer.decode(self._tokenizer.convert_tokens_to_ids(item.hypotheses[0]))
            for item in results
        ]


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
