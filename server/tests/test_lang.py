from app.lang import (
    HY_MT2_ENGLISH_NAMES,
    HY_MT2_SOURCE_CODES,
    is_supported_source,
    normalize_lang,
)


def test_normalize_lang_strips_region():
    assert normalize_lang("en-US") == "en"
    assert normalize_lang("vi-VN") == "vi"
    assert normalize_lang("EN") == "en"
    assert normalize_lang("zh-Hant") == "zh"
    assert normalize_lang(None) == ""


def test_hy_mt2_source_set_includes_en_ja_vi_zh():
    for code in ("ar", "bn", "bo", "cs", "de", "en", "es", "fa", "fr", "gu", "he", "hi",
                 "id", "it", "ja", "kk", "km", "ko", "mn", "mr", "ms", "my", "nl", "pl",
                 "pt", "ru", "ta", "te", "th", "tl", "tr", "ug", "uk", "ur", "vi", "yue", "zh"):
        assert code in HY_MT2_SOURCE_CODES
        assert is_supported_source(code) is True
    assert is_supported_source("xx") is False
    assert is_supported_source("zh-Hant") is False


def test_english_names_cover_every_source_code():
    assert set(HY_MT2_ENGLISH_NAMES) == set(HY_MT2_SOURCE_CODES)
    assert HY_MT2_ENGLISH_NAMES["en"] == "English"
    assert HY_MT2_ENGLISH_NAMES["vi"] == "Vietnamese"
    assert HY_MT2_ENGLISH_NAMES["zh"] == "Chinese"
    assert HY_MT2_ENGLISH_NAMES["ja"] == "Japanese"
    assert HY_MT2_ENGLISH_NAMES["tl"] == "Filipino"
