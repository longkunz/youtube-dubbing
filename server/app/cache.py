import hashlib
from pathlib import Path


class FileCache:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.root / digest

    def get_bytes(self, key: str) -> bytes | None:
        path = self.path_for(key)
        if not path.is_file():
            return None
        return path.read_bytes()

    def get_text(self, key: str) -> str | None:
        data = self.get_bytes(key)
        return None if data is None else data.decode("utf-8")

    def set_bytes(self, key: str, data: bytes) -> None:
        self.path_for(key).write_bytes(data)

    def set_text(self, key: str, text: str) -> None:
        self.set_bytes(key, text.encode("utf-8"))
