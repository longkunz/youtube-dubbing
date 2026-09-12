FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl bash \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install heavy wheels first so code edits do not re-download torch/transformers.
COPY pyproject.toml /app/pyproject.toml
RUN mkdir -p /app/app && printf "# placeholder for pip install .\n" > /app/app/__init__.py
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu124
RUN pip install --no-cache-dir . \
    && pip install --no-cache-dir transformers sentencepiece sacremoses

COPY app /app/app
COPY scripts /app/scripts
RUN sed -i 's/\r$//' /app/scripts/*.sh \
    && chmod +x /app/scripts/*.sh

ENV MODEL_ROOT=/models
ENV CACHE_ROOT=/cache
ENV HF_HOME=/models/hf-cache
ENV PORT=8787
EXPOSE 8787
ENV PYTHONUNBUFFERED=1
CMD ["bash", "-lc", "echo starting model check && /app/scripts/download-models.sh && echo starting uvicorn && uvicorn app.main:app_from_env --host 0.0.0.0 --port 8787"]
