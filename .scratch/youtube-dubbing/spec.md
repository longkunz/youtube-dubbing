# Spec: YouTube Dubbing Web Extension

Status: ready-for-agent

## Problem Statement

Users consuming foreign-language content on YouTube (e.g. English, Japanese, Korean) struggle with reading text subtitles while trying to focus on visuals, coding tutorials, gaming streams, or lectures. Standard YouTube auto-translated subtitles are fragmented, poorly punctuated, and force viewers to constantly keep their eyes glued to the bottom of the screen. Existing third-party dubbing extensions are either expensive subscription services with remote server tracking, have robotic text-to-speech voices, or suffer from desynchronization, abrupt volume cutting, and laggy controls.

## Solution

A high-performance, 100% client-side Chrome/Web extension (built with WXT, React, TypeScript, and TailwindCSS) that translates and dubs YouTube videos into natural, fluent Vietnamese (and other target languages) in real time. The extension uses Bring Your Own Key (BYOK) for LLM translation (Google Gemini Flash) and leverages Microsoft Edge Neural TTS for free, expressive, high-fidelity voices (Hoài My & Nam Minh). It provides smooth Audio Ducking to keep background audio intact, dynamic Time Stretching to fit timeline segments, an IndexedDB local cache for zero-latency replay, and an eye-catching Hyper Sci-Fi Audio HUD embedded via Shadow DOM alongside gentle, distraction-free YouTube-style captions.

## User Stories

1. As a viewer, I want to toggle AI dubbing on and off directly from a floating HUD pill on the YouTube player, so that I can switch between original audio and dubbing without navigating away.
2. As a viewer, I want the extension to automatically extract YouTube's auto-generated or manual captions, so that dubbing starts instantly without needing to download heavy raw video/audio files.
3. As a viewer, I want fragmented caption segments to be restructured into grammatically coherent sentences before translation, so that the translated dialogue sounds natural and avoids awkward pauses.
4. As a viewer, I want the entire transcript to be translated upfront using Gemini Flash upon video load, so that pronouns and contextual terminology remain consistent across the entire video.
5. As a viewer, I want speech synthesis (TTS) to be generated on-demand using a 30–60 second sliding window, so that network bandwidth and TTS quotas are not wasted if I abandon the video early.
6. As a viewer, I want the original video audio to smoothly duck (attenuate to ~20%) over 150ms when the dubbed voice speaks and fade back up when silent, so that I can clearly hear the translation while still enjoying background music and sound effects.
7. As a viewer, I want the synthesized speech speed to dynamically scale (Time Stretching 1.0x–1.35x) to fit the original spoken duration, so that dialogue stays synchronized with speaker lip movements and scene transitions.
8. As a viewer, I want dubbing playback to pause immediately when I pause the YouTube video, so that audio never continues playing in the background out of sync.
9. As a viewer, I want dubbing playback to immediately cease and re-align when I seek (scrub) forward or backward on the timeline, so that I do not hear mismatched stale audio.
10. As a viewer, I want dubbing speed to automatically adapt when I change YouTube playback speed (e.g. 1.25x, 1.5x, 2.0x), so that dubbing stays in lockstep with fast-forwarded video.
11. As a viewer, I want to choose between expressive female (Hoài My) and studio male (Nam Minh) voice profiles from a quick cockpit panel, so that I can personalize the narration style.
12. As a viewer, I want an optional Multi-Speaker auto-detection mode that switches between male and female voices based on dialogue context, so that conversational videos and interviews feel immersive.
13. As a viewer, I want translated subtitles to appear on-screen in a gentle, native YouTube-like aesthetic (semi-transparent black pill with crisp white text), so that reading remains comfortable without eye strain or neon distractions.
14. As a viewer, I want translated transcripts and generated audio clips to be saved in browser IndexedDB storage, so that replaying or scrubbing previously watched segments costs 0ms latency and 0 API tokens.
15. As a user, I want a Command Center settings page to securely enter and validate my Google Gemini API Key and optional Groq/OpenAI STT keys, so that I control my own credentials with complete privacy.
16. As a user, I want a connection test button ("Ping Connection") on the settings page, so that I can verify my API key validity and network latency immediately.
17. As a user, I want a cache management panel displaying stored videos and disk usage with a one-click "Purge Cache" button, so that I can reclaim local disk space whenever needed.
18. As a viewer, I want a clear, friendly notification if a video has no available captions, suggesting adding a Groq/OpenAI key to activate automatic Whisper STT, so that I understand why dubbing cannot proceed.
19. As a viewer, I want Edge-TTS WebSocket disconnects to automatically retry up to 3 times with exponential backoff and fall back gracefully to Web Speech API, so that audio playback is never permanently broken by temporary network hiccups.
20. As a user, I want all in-player UI components to be isolated within a Shadow DOM, so that YouTube's internal stylesheet changes never break the extension UI and extension styles never pollute the video page.

## Implementation Decisions

### Modules and Architecture

The extension is organized into deep, decoupled modules placed at clean seams:

```text
src/
├── core/
│   ├── orchestrator/          # DubbingOrchestrator: Highest seam coordinating the pipeline
│   ├── transcript/            # TranscriptFetcher & SentenceMerger (gap < 0.4s heuristic)
│   ├── translation/           # GeminiTranslationClient (batch translation & timestamp preservation)
│   ├── tts/                   # EdgeTtsClient (WebSocket transport, chunk assembly, blob generation)
│   └── player/                # DubPlayer: SyncEngine, AudioDucker (lerp volume), TimeStretcher
├── storage/                   # IndexedDbCache: persistent storage for transcripts & audio blobs
├── components/                # React UI: CyberCockpit, FloatingPill, SubtitleOverlay, Settings
└── entrypoints/
    ├── content.ts             # Mounts Shadow DOM into .ytp-right-controls and binds video events
    ├── background.ts          # Edge-TTS WebSocket proxy & cross-origin fetch coordinator
    └── options/               # Standalone Command Center dashboard
```

### Key Technical Decisions (from ADRs)

1. **100% Client-Side BYOK (ADR-0001)**: No backend server. Extension runs purely in-browser using Manifest V3. Users supply their own Gemini API key for translation; Edge TTS provides high-quality speech synthesis for free via Background Service Worker WebSockets.
2. **Direct Volume Lerp for Audio Ducking (ADR-0002)**: Avoid Web Audio API `MediaElementAudioSourceNode` due to YouTube cross-origin audio streaming restrictions (`*.googlevideo.com`). Smoothly lerp `HTMLMediaElement.volume` between 1.0 and 0.2 over 150ms using `requestAnimationFrame`.
3. **Full Pre-Translation with Sliding-Window TTS (ADR-0003)**: Entire transcript translated upfront in one pass via Gemini 1.5/2.0 Flash (<$0.001 cost, <2s latency) for coherent global context; TTS audio synthesized JIT in a 30–60 second rolling window.
4. **Shadow DOM In-Player Controls (ADR-0004)**: Extension controls injected into `.ytp-right-controls` inside an isolated Shadow DOM container to ensure zero CSS bleed with YouTube.
5. **Hyper Sci-Fi Audio HUD with Gentle YouTube Subtitles (ADR-0006 & DESIGN.md)**: Floating pill and expandable cockpit panel styled in futuristic glassmorphism and neon accents, while video subtitle overlays strictly adhere to clean, gentle YouTube-native black pill styling for zero eye fatigue.

### Data Types Contract

From `CONTEXT.md`:

```typescript
export interface Segment {
  id: string;
  startTime: number;     // in seconds
  endTime: number;       // in seconds
  duration: number;      // in seconds
  sourceText: string;
  translatedText?: string;
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
}
```

## Testing Decisions

### What Makes a Good Test
- Tests must verify external behavior through the highest possible seam, not internal implementation trivia.
- Avoid asserting on internal private state, DOM element class names, or specific timer IDs.
- Assert on observable outcomes: given video timeline events, is original volume ducked? Is the correct dubbed audio played at the expected timestamp? Is seeking properly reflected in playback state?

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
       getState(): OrchestratorState;
       destroy(): void;
     }
     ```
   - **Test Strategy**: Test the entire dubbing lifecycle by feeding fixture transcripts (real YouTube CC format) and mock LLM/TTS adapters. Verify that:
     - Full transcript is parsed and merged into sentences.
     - Translation is triggered and mapped back to segments with timestamps.
     - Sliding window queues the correct audio segments ahead of `currentTime`.
     - When `currentTime` enters a segment, `AudioDucker` receives volume drop and the segment audio plays.
     - When `handleSeek` is called, currently playing audio immediately terminates and the buffer re-centers.
     - When `handleRateChange(1.5)` is called, playback rate scales proportionally.

2. **Secondary Component Seams**:
   - `SentenceMerger`: Pure function test suite ensuring consecutive fragments separated by <0.4s are merged into coherent sentences while preserving overall start/end boundaries.
   - `SegmentCache (IndexedDB)`: Repository test suite using `fake-indexeddb` verifying store, retrieve, key indexing (`videoId_language_voiceId`), and purge operations.
   - `EdgeTtsProtocol`: Message framing test suite verifying SSML payload generation and binary WebSocket chunk assembly into valid audio blobs.

## Out of Scope

- Video platforms other than YouTube (e.g. Netflix, Coursera, Udemy) for MVP.
- Server-side centralized audio caching or user accounts (100% client-side BYOK).
- Real-time video voice cloning / custom zero-shot voice training (rely on pre-trained neural models from Edge TTS / ElevenLabs).
- Video frame lip-sync modification (Wav2Lip) — this is an audio dubbing extension, not video generation.

## Further Notes

- WXT provides `createShadowRootUi` which handles attaching and destroying the Shadow DOM container seamlessly across YouTube SPA page transitions (`yt-navigate-finish`).
- Microsoft Edge TTS uses public endpoints (`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`) with `TrustedClientToken`. Must be routed through the Background Service Worker with appropriate `host_permissions`.
