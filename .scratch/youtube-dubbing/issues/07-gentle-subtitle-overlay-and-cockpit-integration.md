# 07: Gentle Subtitle Overlay & Full Cyber Cockpit Integration

**What to build:** The complete user-facing playback presentation. Renders clean, gentle YouTube-style subtitles (`rgba(8, 8, 8, 0.84)` rounded black pill with crisp white text) on the video canvas synchronized with spoken dialogue. Binds all interactive controls in the Cyber Cockpit (on/off toggle switch, voice selector cards for Hoài My and Nam Minh, real-time Audio Ducking slider, and animated equalizer waves) directly to the underlying `DubbingOrchestrator`.

**Blocked by:** 01: Project Foundation & Shadow DOM In-Player HUD Mount, 06: Audio Ducking & Playback Sync Engine

**Status:** ready-for-agent

- [ ] Subtitle overlay component renders translated text with native YouTube CC styling (semi-transparent black pill, white text, zero neon glare).
- [ ] Subtitles appear and disappear strictly in lockstep with the currently active speech segment.
- [ ] Cockpit on/off switch dynamically enables or disables dubbing and restores normal video audio.
- [ ] Selecting Hoài My or Nam Minh voice cards switches the active voice profile for subsequent synthesis.
- [ ] Interactive volume slider updates ducking attenuation level in real time.
- [ ] Equalizer spectrum wave animates dynamically during active speech playback.
- [ ] Component integration tests verify that UI interactions correctly update the orchestrator state.
