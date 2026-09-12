def normalize_lang(code: str | None) -> str:
    if not code:
        return ""
    primary = code.strip().lower().replace("_", "-").split("-", 1)[0]
    return primary
