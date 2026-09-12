FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl bash \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml /app/pyproject.toml
COPY app /app/app
COPY scripts /app/scripts
RUN pip install --no-cache-dir . \
    && chmod +x /app/scripts/download-models.sh
ENV MODEL_ROOT=/models
ENV CACHE_ROOT=/cache
ENV PORT=8787
EXPOSE 8787
CMD ["bash", "-lc", "/app/scripts/download-models.sh && uvicorn app.main:app_from_env --host 0.0.0.0 --port 8787"]
