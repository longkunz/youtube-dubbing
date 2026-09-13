from app.runtime import build_runtime


class FakeTranslator:
    pass


class FakeTts:
    def status(self):
        return "ready"


def test_build_runtime_without_translator_factory_returns_none(tmp_path):
    tts = FakeTts()
    translator, engine = build_runtime(
        model_root_str=str(tmp_path / "models"),
        cache_root_str=str(tmp_path / "cache"),
        load_translator=lambda cache: None,
        load_tts=lambda cache: tts,
    )
    assert translator is None
    assert engine is tts


def test_build_runtime_uses_injected_translator(tmp_path):
    tr = FakeTranslator()
    tts = FakeTts()
    translator, engine = build_runtime(
        model_root_str=str(tmp_path / "models"),
        cache_root_str=str(tmp_path / "cache"),
        load_translator=lambda cache: tr,
        load_tts=lambda cache: tts,
    )
    assert translator is tr
    assert engine is tts


def test_build_runtime_swallows_tts_load_failure(tmp_path):
    def load_tts(cache):
        raise RuntimeError("hub down")

    translator, engine = build_runtime(
        model_root_str=str(tmp_path / "models"),
        cache_root_str=str(tmp_path / "cache"),
        load_translator=lambda cache: None,
        load_tts=load_tts,
    )
    assert translator is None
    assert engine is None
