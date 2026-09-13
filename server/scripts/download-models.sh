#!/usr/bin/env bash
set -euo pipefail
ROOT="${MODEL_ROOT:-/models}"
export HF_HOME="${HF_HOME:-$ROOT/hf-cache}"
mkdir -p "$HF_HOME"
python - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download("tencent/Hy-MT2-1.8B")
snapshot_download("zeroweight-ai/ZeroTTS")
print("models ready")
PY
