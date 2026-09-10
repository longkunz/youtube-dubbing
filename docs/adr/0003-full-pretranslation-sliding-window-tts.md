---
status: accepted
date: 2026-09-08
---

# 3. Full Transcript Pre-Translation with Sliding-Window TTS Synthesis

We decided to translate the entire video Transcript in a single batch pass at video load using `gemini-2.0-flash`, while synthesizing TTS audio incrementally through a rolling Sliding Window (30–60 seconds ahead of playback). Full pre-translation provides the LLM with complete contextual narrative for consistent pronouns and technical terminology at negligible cost and latency (<2 seconds on `gemini-2.0-flash`), while sliding-window audio generation avoids wasting network bandwidth and TTS quotas if the user abandons the video early.

**Model selection (issue #12):** the batch-translation strategy is unchanged. The concrete Gemini model is user-configurable (`UserSettings.geminiModel`, default `gemini-3.8-flash`). On HTTP 404 the client retries a current Flash fallback chain, then `ListModels`, because `gemini-1.5-flash` / `gemini-2.0-flash` are shut down and `gemini-2.5-flash` is unavailable to many new API keys.
