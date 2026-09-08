# 07: Gentle Subtitle Overlay & Full Cyber Cockpit Integration

**What to build:** The complete user-facing playback presentation. Renders clean, gentle YouTube-style subtitles (`rgba(8, 8, 8, 0.84)` rounded black pill with crisp white text) on the video canvas synchronized with spoken dialogue, with an optional secondary original language preview line. Binds all interactive controls in the Cyber Cockpit (on/off toggle switch, target language selector, voice cards for Hoài My and Nam Minh, real-time Audio Ducking slider, and animated equalizer waves) directly to the underlying `DubbingOrchestrator`.

**Blocked by:** 01: Project Foundation & Shadow DOM In-Player HUD Mount, 06: Audio Ducking & Playback Sync Engine

**Status:** ready-for-agent

- [ ] Subtitle overlay component renders translated text with native YouTube CC styling (`rgba(8, 8, 8, 0.84)` semi-transparent black pill, crisp `#ffffff` text, zero neon glare).
- [ ] Subtitles appear and disappear strictly in lockstep with the currently active Dub Track segment.
- [ ] Optional secondary original text preview line displays source language caption below translated text in 13px soft gray.
- [ ] Target language selector in Cyber Cockpit allows switching target translation language (default: `Tiếng Việt`).
- [ ] Cockpit on/off switch dynamically enables or disables the Dub Track and restores normal video audio.
- [ ] Selecting Hoài My or Nam Minh voice cards switches the active voice profile for subsequent synthesis.
- [ ] Interactive volume slider updates ducking attenuation level in real time.
- [ ] Equalizer spectrum wave animates dynamically during active Dub Track playback.
- [ ] Component integration tests verify that UI interactions correctly update the orchestrator state.
