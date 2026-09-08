# 3. Full Transcript Pre-Translation with Sliding-Window TTS Synthesis

We decided to translate the entire video Transcript in a single batch pass at video load, while synthesizing TTS audio incrementally through a rolling Sliding Window (30-60 seconds ahead of playback). Full pre-translation provides the LLM with complete contextual narrative for consistent pronouns and technical terminology at negligible cost and latency (<2 seconds on Gemini Flash), while sliding-window audio generation avoids wasting network bandwidth and TTS quotas if the user abandons the video early.
