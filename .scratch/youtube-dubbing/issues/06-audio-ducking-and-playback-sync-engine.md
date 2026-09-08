# 06: Audio Ducking & Playback Sync Engine

**What to build:** The core real-time dubbing engine coordinating video playback and speech synthesis. Manages a 30–60s rolling Sliding Window to request TTS ahead of time. During playback, smoothly attenuates YouTube's original video volume to 20% in 150ms using `requestAnimationFrame` volume lerping, plays synthesized speech with dynamic time-stretching (1.0x–1.35x), and restores volume during silence. Synchronizes instantly with pause, seek, and playback rate changes.

**Blocked by:** 01: Project Foundation & Shadow DOM In-Player HUD Mount, 03: Upfront Translation Pipeline with Gemini Flash, 04: Microsoft Edge Neural TTS Streaming via Service Worker

**Status:** ready-for-agent

- [ ] Sliding Window queue dynamically manages pre-synthesis of upcoming segments (30–60 seconds ahead).
- [ ] `AudioDucker` smoothly interpolates `videoElement.volume` down to the configured ducking level (default 20%) over 150ms on speech start and restores to 100% on speech end.
- [ ] `TimeStretcher` dynamically scales TTS audio playback rate between 1.0x and 1.35x to fit the segment window.
- [ ] Video `pause` event pauses dubbed audio; video `play` resumes playback in lockstep.
- [ ] Timeline `seeking` event instantly stops active dub audio and re-centers the sliding window queue.
- [ ] Changing YouTube playback speed (1.25x, 1.5x, 2.0x) scales dub audio rate proportionally.
- [ ] Automated `DubbingOrchestrator` test suite verifies playback synchronization, ducking transitions, seeking, and rate adjustment.
