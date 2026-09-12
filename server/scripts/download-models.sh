#!/usr/bin/env bash
set -euo pipefail
ROOT="${MODEL_ROOT:-/models}"
mkdir -p "$ROOT/opus-mt-en-vi" "$ROOT/piper" "$ROOT/hf-cache"
export HF_HOME="${HF_HOME:-$ROOT/hf-cache}"
OPUS="$ROOT/opus-mt-en-vi"
need_opus=0
if [ ! -f "$OPUS/model.bin" ]; then
  need_opus=1
fi
# Converter writes weights only; tokenizer files are required for a complete tree.
if [ ! -f "$OPUS/tokenizer_config.json" ] && [ ! -f "$OPUS/source.spm" ]; then
  need_opus=1
fi
if [ "$need_opus" -eq 1 ]; then
  rm -rf "$OPUS"
  mkdir -p "$OPUS"
  ct2-transformers-converter \
    --model Helsinki-NLP/opus-mt-en-vi \
    --output_dir "$OPUS" \
    --quantization int8 \
    --force \
    --copy_files source.spm target.spm tokenizer_config.json vocab.json
fi
VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/vi/vi_VN/vais1000/medium"
if [ ! -f "$ROOT/piper/vi_VN-vais1000-medium.onnx" ]; then
  curl -L "$VOICE_BASE/vi_VN-vais1000-medium.onnx" -o "$ROOT/piper/vi_VN-vais1000-medium.onnx"
  curl -L "$VOICE_BASE/vi_VN-vais1000-medium.onnx.json" -o "$ROOT/piper/vi_VN-vais1000-medium.onnx.json"
fi
