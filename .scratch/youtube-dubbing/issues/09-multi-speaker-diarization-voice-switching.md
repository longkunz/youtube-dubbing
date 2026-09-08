# 09: Multi-Speaker Diarization & Dynamic Voice Switching

**What to build:** Automatic multi-speaker detection and voice profile switching during video playback. Enhances the Gemini translation prompt to tag dialogue segments with speaker gender (`speakerGender: 'female' | 'male'`), and connects the Cyber Cockpit's "Multi-Speaker Diarization Scanner" toggle so that playback dynamically alternates between female (`Hoài My`) and male (`Nam Minh`) voice profiles based on conversational context.

**Blocked by:** 03: Upfront Translation Pipeline with Gemini Flash, 07: Gentle Subtitle Overlay & Full Cyber Cockpit Integration

**Status:** ready-for-agent

- [ ] Gemini translation prompt instructs `gemini-2.0-flash` to output `speakerGender` tags alongside translated text.
- [ ] Pipeline populates `speakerGender` on each enriched `Segment`.
- [ ] Cyber Cockpit's Multi-Speaker toggle enables/disables automatic voice switching mode.
- [ ] Sliding-window TTS synthesis dispatches female voice (`Hoài My`) for female speaker segments and male voice (`Nam Minh`) for male speaker segments.
- [ ] Automated integration tests verify that a multi-speaker transcript alternates TTS voice synthesis correctly.
