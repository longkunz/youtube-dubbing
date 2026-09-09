# YouTube Dubbing

Domain glossary for browser-based video translation and synthetic speech dubbing.

## Language

**Segment**:
A discrete slice of spoken dialogue with a defined start timestamp, duration, and source text.
_Avoid_: Caption line, subtitle block, chunk, timestamp unit

**Transcript**:
The ordered sequence of Segments capturing the complete spoken dialogue of a video.
_Avoid_: Subtitle file, closed captions, CC track, srt

**Dub Track**:
The synthetic audio stream containing translated speech aligned to the video timeline.
_Avoid_: Voiceover stream, translation track, secondary audio

**Audio Ducking**:
The automatic attenuation of the original video audio volume while the Dub Track is actively speaking.
_Avoid_: Volume dipping, auto-quieting, background muting, audio dampening

**Audio Crossfade**:
The linear interpolation of video volume over a short transition window to enter and exit Audio Ducking smoothly.
_Avoid_: Smooth mute, volume sliding, audio lerp

**Time Stretching**:
The dynamic adjustment of synthesized speech playback speed to fit within the temporal boundaries of a Segment.
_Avoid_: Speed warp, pacing hack, audio squeezing

**Sliding Window**:
The bounded lookahead interval (e.g., 30–60 seconds ahead of current playback position) used to proactively synthesize TTS audio.
_Avoid_: Buffer queue, rolling cache, prefetch span

**Sentence Restructuring**:
The process of consolidating fragmented auto-caption snippets into coherent sentences with proper punctuation and preserved timeline boundaries.
_Avoid_: Subtitle joining, caption cleaning, text stitching

**Segment Cache**:
Persistent IndexedDB storage of translated text and synthesized audio blobs keyed by video, target language, and voice profile.
_Avoid_: Local database, audio storage, response cache

**Playback Sync Engine**:
The controller coordinating playhead position, dynamic rate scaling, seeking, and pause/resume states between the host video player and the Dub Track.
_Avoid_: Audio tracker, timing manager, player sync loop

**Shadow DOM Mount**:
The isolated DOM subtree attached to the YouTube player toolbar hosting the extension's interactive controls without CSS bleed.
_Avoid_: Injected widget, player iframe, overlay div

**Voice Profile**:
A specific speech synthesis configuration defined by locale, gender, pitch, rate, and engine provider.
_Avoid_: Speaker preset, narrator option, voice persona

**Translation Provider**:
An external LLM backend service or gateway (e.g., OpenAI-Compatible Proxy, Google Gemini) executing batch translation of dialogue segments with conversational speaker diarization.
_Avoid_: Translation API, LLM wrapper, model server

**OpenAI-Compatible Endpoint**:
A REST API gateway conforming to the standard `/v1/chat/completions` specification, accepting customizable base URLs, model identifiers, and optional bearer tokens.
_Avoid_: Custom proxy, chat URL, backend proxy

**On-Demand Activation**:
The lifecycle model where dubbing remains dormant upon video load until explicitly engaged by the user, replacing automatic background pipeline initiation.
_Avoid_: Lazy loading, manual trigger, opt-in start, deferred dubbing

**Preparation Overlay**:
A centered, in-player sci-fi HUD visual indicator rendered while the video is temporarily paused to fetch captions, translate dialogue, and synthesize initial lookahead speech.
_Avoid_: Center spinner, loading modal, buffering popup, wait screen

**Split Pill Control**:
A dual-action control surface on the YouTube player toolbar combining a direct Dub Track toggle action with a dedicated settings expander for the Cyber Cockpit.
_Avoid_: Double button, toggle pill, combined widget


