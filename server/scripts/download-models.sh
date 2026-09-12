#!/usr/bin/env bash
set -euo pipefail
ROOT="${MODEL_ROOT:-/models}"
mkdir -p "$ROOT/opus-mt-en-vi" "$ROOT/piper"
if [ ! -f "$ROOT/opus-mt-en-vi/model.bin" ]; then
  ct2-transformers-converter --model Helsinki-NLP/opus-mt-en-vi --output_dir "$ROOT/opus-mt-en-vi" --quantization int8 --force
fi
VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/vi/vi_VN/vais1000/medium"
if [ ! -f "$ROOT/piper/vi_VN-vais1000-medium.onnx" ]; then
  curl -L "$VOICE_BASE/vi_VN-vais1000-medium.onnx" -o "$ROOT/piper/vi_VN-vais1000-medium.onnx"
  curl -L "$VOICE_BASE/vi_VN-vais1000-medium.onnx.json" -o "$ROOT/piper/vi_VN-vais1000-medium.onnx.json"
fi
