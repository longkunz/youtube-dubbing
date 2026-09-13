---
status: accepted
date: 2026-09-12
---

# 12. Parallel Caption Overlay and Sub-Only Mode

We decoupled subtitle display from Dub Track audio, introducing an independent Sub-Only Mode alongside simultaneous dubbing. Subtitles are rendered by a unified bilingual Parallel Caption Overlay mounted directly inside `#movie_player` via an isolated Shadow DOM host, replacing scattered in-controls positioning. The overlay displays synchronized target translation above source dialogue and hides YouTube's native CC via scoped CSS while active. In Sub-Only Mode, TTS synthesis is bypassed entirely, delivering fast transcript translation without audio compute overhead; videos lacking native captions report unavailable status without engaging Whisper fallback. Position adapts dynamically between 56px and 96px from the bottom based on player control visibility (`ytp-autohide`), updates immediately on scrub, and exposes mode, line ordering, and font size options in the Command Center.
