---
status: accepted
date: 2026-09-08
---

# 3. Full Transcript Pre-Translation with Sliding-Window TTS Synthesis

We decided to translate the entire video Transcript in a single batch pass at video load using `gemini-2.0-flash`, while synthesizing TTS audio incrementally through a rolling Sliding Window (30–60 seconds ahead of playback). Full pre-translation provides the LLM with complete contextual narrative for consistent pronouns and technical terminology at negligible cost and latency (<2 seconds on `gemini-2.0-flash`), while sliding-window audio generation avoids wasting network bandwidth and TTS quotas if the user abandons the video early.
