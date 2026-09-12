# Spec: YouTube Dubbing Web Extension

Status: ready-for-agent

## Problem Statement

Users consuming foreign-language content on YouTube (e.g. English, Japanese, Korean) struggle with reading text subtitles while trying to focus on visuals, coding tutorials, gaming streams, or lectures. Standard YouTube auto-translated subtitles are fragmented, poorly punctuated, and force viewers to constantly keep their eyes glued to the bottom of the screen. Existing third-party dubbing extensions are either expensive subscription services with remote server tracking, have robotic text-to-speech voices, or suffer from desynchronization, abrupt volume cutting, and laggy controls.

## Solution

A high-performance Chrome/Web extension (built with WXT, React, TypeScript, and TailwindCSS) that translates and dubs YouTube videos into natural, fluent Vietnamese and other target languages in real time. New installs default to a **Self-hosted Backend** (CPU Docker: CTranslate2 Opus-MT EN→VI and Piper then Edge TTS on the server). Optional Bring Your Own Key (BYOK) covers LLM translation (configurable Gemini Flash, default `gemini-3.8-flash`, plus OpenAI-compatible proxies) and **YouTube Caption Translation**. Chrome does not open Bing WebSocket; Edge Neural voices run inside the Self-hosted Backend. Dubbing stays dormant until On-Demand Activation. It provides smooth Audio Ducking, dynamic Time Stretching, a `SegmentCache` (IndexedDB via `idb`), and an eye-catching Hyper Sci-Fi Audio HUD embedded via Shadow DOM alongside gentle, distraction-free YouTube-style captions.

## User Stories

1. As a viewer, I want to toggle AI dubbing on and off directly from a floating HUD pill on the YouTube player, so that I can switch between original audio and the Dub Track without navigating away.
2. As a viewer, I want the extension to automatically extract YouTube's auto-generated or manual captions, so that dubbing starts instantly without needing to download heavy raw video/audio files.
3. As a viewer, I want fragmented caption segments to be restructured into grammatically coherent sentences before translation, so that the translated dialogue sounds natural and avoids awkward pauses.
4. As a viewer, I want the entire transcript to be translated upfront using the configured Gemini Flash model (default `gemini-3.8-flash`) when I turn dubbing ON, so that pronouns and contextual terminology remain consistent across the entire video without spending tokens on videos I watch in the original language.
5. As a viewer, I want speech synthesis (TTS) to be generated on-demand using a 30–60 second sliding window, so that network bandwidth and TTS quotas are not wasted if I abandon the video early.
6. As a viewer, I want the original video audio to smoothly duck (attenuate to ~20%) over 150ms when the Dub Track speaks and fade back up when silent, so that I can clearly hear the translation while still enjoying background music and sound effects.
7. As a viewer, I want the synthesized speech speed to dynamically scale (Time Stretching 1.0x–1.35x) to fit the original spoken duration, so that dialogue stays synchronized with speaker lip movements and scene transitions.
8. As a viewer, I want Dub Track playback to pause immediately when I pause the YouTube video, so that audio never continues playing in the background out of sync.
9. As a viewer, I want Dub Track playback to immediately cease and re-align when I seek (scrub) forward or backward on the timeline, so that I do not hear mismatched stale audio.
10. As a viewer, I want Dub Track playback speed to automatically adapt when I change YouTube playback speed (e.g. 1.25x, 1.5x, 2.0x), so that dubbing stays in lockstep with fast-forwarded video.
11. As a viewer, I want to choose between expressive female (`Hoài My`) and studio male (`Nam Minh`) voice profiles from a quick cockpit panel, so that I can personalize the narration style.
12. As a viewer, I want to select my target language (default: `Tiếng Việt [vi]`, with options for `English [en]`, `日本語 [ja]`, `中文 [zh]`, `Español [es]`) from the Cyber Cockpit, so that cache lookup, translation, and Dub Track synthesis all use that language.
13. As a viewer, I want an optional Multi-Speaker auto-detection mode that uses LLM speaker diarization tags to automatically alternate between male and female voices based on dialogue context, so that conversational videos and interviews feel immersive.
14. As a viewer, I want translated subtitles to appear on-screen in a gentle, native YouTube-like aesthetic (`rgba(8, 8, 8, 0.84)` rounded black pill with crisp white text), so that reading remains comfortable without eye strain or neon distractions.
15. As a viewer, I want an optional secondary preview line displaying the original foreign-language caption (13px soft gray text) directly beneath the translated subtitle, so that I can compare translations or learn language.
16. As a viewer, I want translated transcripts and generated audio clips to be saved in browser IndexedDB storage (`SegmentCache`), so that replaying or scrubbing previously watched segments costs 0ms latency and 0 API tokens.
17. As a user, I want a Command Center settings page to securely enter and validate my Google Gemini API Key and optional Groq/OpenAI STT keys, so that I control my own credentials with complete privacy.
18. As a user, I want a connection test button ("Ping Connection") on the settings page, so that I can verify my API key validity and network latency immediately.
19. As a user, I want a cache management panel displaying stored videos and disk usage with a one-click "Purge Cache" button, so that I can reclaim local disk space whenever needed.
20. As a viewer, I want a clear, friendly notification if captions cannot be downloaded, and if I have added a Groq API key I want Whisper Fallback to attempt transcription from an unsigned player audio URL, so that dubbing can still proceed when timedtext fails.
21. As a viewer, I want Edge-TTS WebSocket disconnects to automatically retry up to 3 times with exponential backoff and fall back gracefully to Web Speech API, so that audio playback is never permanently broken by temporary network hiccups.
22. As a user, I want all in-player UI components to be isolated within a Shadow DOM, so that YouTube's internal stylesheet changes never break the extension UI and extension styles never pollute the video page.
23. As a viewer, I want to select YouTube Caption Translation in Command Center as a peer Translation Provider (default remains Gemini), so that I can dub without LLM tokens or a Gemini API key.
24. As a viewer using YouTube Caption Translation, I want an existing target-language Caption Track used when available, otherwise YouTube machine translation of a translatable source Caption Track, so that the cheap path still produces a Dub Track.
25. As a viewer using YouTube Caption Translation, I want Sentence Restructuring, original-language preview (dual-fetch aligned by time), On-Demand Activation, and Sliding Window TTS to keep working, so that only the translation source changes.
26. As a viewer, I want Segment Cache keys to include Translation Provider, so that Gemini and YouTube Caption Translation never overwrite each other.
27. As a viewer, if YouTube Caption Translation cannot obtain translated cues, I want a clear failure and no silent LLM fallback, so that I do not spend tokens I did not request.

## Implementation Decisions

### Modules and Architecture

The extension is organized into deep, decoupled modules placed at clean seams:

```text
src/
├── core/
│   ├── orchestrator/          # DubbingOrchestrator: Highest seam coordinating the pipeline
│   ├── transcript/            # TranscriptFetcher & SentenceMerger (gap < 0.4s heuristic)
│   ├── translation/           # GeminiTranslationClient + OpenAI-compatible factory (configurable Flash model)
│   ├── tts/                   # EdgeTtsClient (WebSocket transport, SSML pitch/rate, chunk assembly)
│   └── player/                # DubPlayer: SyncEngine, AudioDucker (lerp volume), TimeStretcher
├── storage/                   # SegmentCache: persistent storage (idb library) for transcripts & audio blobs
├── components/                # React UI: CyberCockpit, FloatingPill, SubtitleOverlay, Settings
└── entrypoints/
    ├── content.ts             # Mounts Shadow DOM into .ytp-right-controls and binds video events
    ├── background.ts          # Edge-TTS WebSocket proxy & cross-origin fetch coordinator
    └── options/               # Standalone Command Center dashboard
```

### Key Technical Decisions (from ADRs)

1. **100% Client-Side BYOK (ADR-0001)**: No backend server. Extension runs purely in-browser using Manifest V3. Users supply their own Gemini API key for translation; Edge TTS provides high-quality speech synthesis for free via Background Service Worker WebSockets.
2. **Direct Volume Lerp for Audio Ducking (ADR-0002)**: Avoid Web Audio API `MediaElementAudioSourceNode` due to YouTube cross-origin audio streaming restrictions (`*.googlevideo.com`). Smoothly lerp `HTMLMediaElement.volume` between 1.0 and 0.2 over 150ms using `requestAnimationFrame`. Equalizer animations in the UI are event-driven rather than live FFT PCM analyzers.
3. **Full Pre-Translation with Sliding-Window TTS (ADR-0003, amended by ADR-0008)**: Entire transcript translated upfront in one pass via the configured Gemini Flash model when the user activates dubbing; TTS audio synthesized JIT in a 30–60 second rolling window.
4. **Shadow DOM In-Player Controls (ADR-0004)**: Extension controls injected into `.ytp-right-controls` inside an isolated Shadow DOM container to ensure zero CSS bleed with YouTube.
5. **Hyper Sci-Fi Audio HUD with Gentle YouTube Subtitles (ADR-0006 & DESIGN.md)**: Floating pill and expandable cockpit panel styled in futuristic glassmorphism and neon accents, while video subtitle overlays strictly adhere to clean, gentle YouTube-native black pill styling (`rgba(8, 8, 8, 0.84)` with `#ffffff` text) for zero eye fatigue.
6. **Persistent Storage Library**: Uses Jake Archibald's lightweight, promise-based `idb` library to interact with IndexedDB for storing audio blobs and transcript segments.
7. **Pluggable Translation (ADR-0007)**: Gemini or an OpenAI-compatible `/v1/chat/completions` proxy. LLM-only seam; YouTube Caption Translation does not implement `TranslationClient`.
8. **On-Demand Activation (ADR-0008)**: Pipeline stays dormant until the Split Pill toggle; cache-hit is zero-jank, cache-miss pauses with a Preparation Overlay.
9. **YouTube Caption Translation (ADR-0009)**: Peer Command Center provider. Caption acquisition via TranscriptFetcher (target-language track or machine-translated source), not LLM batches. Cache keys include Translation Provider. Fail visibly; no auto-fallback to Gemini. HUD label `YOUTUBE-CC`.

### Domain TypeScript Definitions (formalizing CONTEXT.md domain concepts)

```typescript
export interface Segment {
  id: string;
  startTime: number;     // in seconds
  endTime: number;       // in seconds
  duration: number;      // in seconds
  sourceText: string;
  translatedText?: string;
  speakerGender?: 'female' | 'male'; // from LLM diarization
  voiceProfileId?: string;
  audioBlob?: Blob;
  audioUrl?: string;
}

export interface Transcript {
  videoId: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: Segment[];
}

export interface VoiceProfile {
  id: string;
  name: string;
  gender: 'female' | 'male';
  locale: string;
  provider: 'edge-tts' | 'elevenlabs' | 'web-speech';
  voiceKey: string;
  pitch?: string; // e.g. "+0Hz", "+5Hz" (SSML pitch parameter)
  rate?: string;  // e.g. "+0%", "+10%" (SSML prosody rate parameter)
}
```

## Testing Decisions

### What Makes a Good Test
- Tests must verify external behavior through the highest possible seam, not internal implementation trivia.
- Avoid asserting on internal private state, DOM element class names, or specific timer IDs.
- Assert on observable outcomes: given video timeline events, is original volume ducked? Is the correct Dub Track played at the expected timestamp? Is seeking properly reflected in playback state?

### Testing Seams

1. **The Primary Seam: `DubbingOrchestrator`**
   - **Interface**:
     ```typescript
     interface DubbingOrchestrator {
       init(videoId: string, config: OrchestratorConfig): Promise<void>;
       handleTimeUpdate(currentTime: number): void;
       handleSeek(newTime: number): void;
       handleRateChange(newRate: number): void;
       handlePlay(): void;
       handlePause(): void;
       setTargetLanguage(languageCode: string): Promise<void>;
       setDiarizationEnabled(enabled: boolean): void;
       getState(): OrchestratorState;
       destroy(): void;
     }
     ```
   - **Test Strategy**: Test the entire dubbing lifecycle by feeding fixture transcripts (real YouTube CC format) and mock LLM/TTS adapters. Verify that:
     - Full transcript is parsed and merged into sentences.
     - Translation is triggered and mapped back to segments with timestamps and diarization tags.
     - Sliding window queues the correct audio segments ahead of `currentTime`.
     - When `currentTime` enters a segment, `AudioDucker` receives volume drop and the segment Dub Track plays.
     - When `handleSeek` is called, currently playing Dub Track audio immediately terminates and the buffer re-centers.
     - When `handleRateChange(1.5)` is called, playback rate scales proportionally.

2. **Secondary Component Seams**:
   - `SentenceMerger`: Pure function test suite ensuring consecutive fragments separated by <0.4s are merged into coherent sentences while preserving overall start/end boundaries.
   - `SegmentCache (IndexedDB via idb)`: Repository test suite using `fake-indexeddb` verifying store, retrieve, key indexing (`videoId_language_voiceId` plus Translation Provider), and purge operations.
   - `EdgeTtsProtocol`: Message framing test suite verifying SSML payload generation (including `pitch` and `rate` tags) and binary WebSocket chunk assembly into valid audio blobs.
   - **YouTube Caption Translation:** `OrchestratorCoordinator` pipeline is the primary seam (skip LLM, caption-acquisition Transcript, cache-by-provider, visible failure). `TranscriptFetcher` and Command Center are secondary. DubbingOrchestrator is unchanged (TTS/sync only).

## Out of Scope

- Video platforms other than YouTube (e.g. Netflix, Coursera, Udemy).
- Multi-tenant public SaaS, user accounts, or uploading video/audio to the Self-hosted Backend.
- Real-time video voice cloning / custom zero-shot voice training.
- Video frame lip-sync modification (Wav2Lip) — this is an audio dubbing extension, not video generation.
- Paid commercial TTS providers (ElevenLabs, OpenAI TTS): Self-hosted Piper then server-side Edge TTS is the default; ElevenLabs / OpenAI TTS stay deferred as secondary BYOK plugins.
- Google Cloud Translate / DeepL / scraping translate.google.com as Translation Providers.
- Automatic fallback from YouTube Caption Translation to an LLM.
- Solving YouTube `signatureCipher` / n-sig audio URLs for Whisper Fallback. Ciphered streams are skipped.

## Further Notes

- WXT provides `createShadowRootUi` which handles attaching and destroying the Shadow DOM container seamlessly across YouTube SPA page transitions (`yt-navigate-finish`).
- Microsoft Edge TTS uses public endpoints (`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`) with `TrustedClientToken`. Must be routed through the Background Service Worker with appropriate `host_permissions`.
