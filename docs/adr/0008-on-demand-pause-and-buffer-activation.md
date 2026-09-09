---
status: accepted
date: 2026-09-09
amends: docs/adr/0003-full-pretranslation-sliding-window-tts.md
---

# 8. On-Demand Pause-and-Buffer Activation with Center Preparation Overlay

## Context & Problem Statement

Prior to this decision, `startDubbingPipeline()` executed eagerly and automatically upon YouTube watch page load and SPA navigation (`tryMount()`). While ADR-0003 specified that full Transcript pre-translation occurs "at video load", field testing and operational experience revealed major drawbacks:

1. **Unsolicited API & Token Consumption**: Users browsing YouTube incur LLM translation tokens and TTS bandwidth charges on every video opened, even when they only intend to listen to original audio.
2. **Lifecycle & Timing Race Conditions**: Eager initialization attempts caption extraction before YouTube's player finishes initializing its audio track and Proof-of-Origin token (`pot`) minting.
3. **Mid-Sentence Audio Ducking**: When translation completed several seconds into an already-playing video, original audio was suddenly ducked and synthetic speech overlapped mid-stream without user preparation.

## Decision

We amend ADR-0003: full-transcript pre-translation is retained, but its execution lifecycle is shifted from **eagerly at video load** to **on-demand upon user activation**.

The system adopts an **On-Demand Activation** model governed by a rigorous state machine, a zero-jank fast path, and an explicit cancellation lifecycle.

### 1. State Machine & Lifecycle

```
[ DORMANT / OFF ] ──(Click Toggle ON)──► [ PRE-CHECK: SegmentCache ]
                                                    │
                                   ┌────────────────┴────────────────┐
                              (Cache Hit)                       (Cache Miss)
                                   │                                 │
                                   ▼                                 ▼
                          [ ACTIVE DUBBING ]                 [ PAUSE & BUFFER ]
                          • Zero-jank fastpath               • video.pause()
                          • No pause, no overlay             • Mount PreparationOverlay
                          • Instant orchestrator start       • Arm AbortController & token
                                                                     │
                                                    ┌────────────────┼────────────────┐
                                                (Success)       (Cancel/OFF)     (Error/Timeout)
                                                    │                │                │
                                                    ▼                ▼                ▼
                                            [ AUTO-RESUME ]   [ ABORT & CLEAN ] [ ABORT & WARN ]
                                            • Unmount overlay • Abort in-flight • Abort in-flight
                                            • video.play()    • Unmount overlay • Unmount overlay
                                              (gesture fallback)• video.play()   • NotificationBanner
                                            • Sync Dub Track  • Restore volume  • Reset toggle to OFF
                                                                                • video.play()
                                                                                • Restore volume
```

### 2. Zero-Jank Cache-Hit Fast Path

Before modifying player state:
- Check `SegmentCache` in IndexedDB (`cache.getTranscript(videoId, targetLanguage)`).
- **If cache hits**: Skip the pause entirely. Do not call `video.pause()`, do not mount `PreparationOverlay`. Initialize the `DubbingOrchestrator` synchronously in <10ms and begin Dub Track playback seamlessly.
- **If cache misses**: Enter the Pause-and-Buffer state.

### 3. Pause & Buffer Flow (Cache Miss)

1. **Immediate Pause**: Invoke `video.pause()` on the host `HTMLVideoElement`.
2. **Mount Preparation Overlay**: Attach the `PreparationOverlay` component within the YouTube player container (`#movie_player`), isolated via Shadow DOM (`z-index: 60`, `pointer-events: auto`).
   - Visually blocks accidental clicks to the host video element.
   - Renders a cyber glass backdrop with neon glowing spinner ring and telemetry status: `AETHERDUB // SYNTHESIZING DUB TRACK...`.
   - Provides an accessible `[CANCEL]` action button and listens for the `Escape` key.
3. **Cancellation & Abort Control**:
   - Every activation creates a fresh `AbortController` and monotonically increasing `sessionId`.
   - If the user clicks `[CANCEL]`, toggles Dubbing OFF, or navigates to another video (`yt-navigate-finish`) while buffering:
     - The `AbortController` signals cancellation; all in-flight network requests (caption polling, translation batches) are discarded.
     - The overlay unmounts immediately.
     - The host video volume is restored to its pre-duck baseline.
     - The video resumes playback (`video.play()`).
4. **Autoplay Policy Fallback on Resume**:
   - Asynchronous network calls break the browser user gesture context. If `video.play()` is rejected by Chrome's Autoplay Policy:
     - The Preparation Overlay transitions to a user-gesture prompt: `DUBBING READY — CLICK TO RESUME`.
     - Clicking this prompt provides a synchronous user gesture that calls `video.play()` and unmounts the overlay.
5. **Phase-Based Timeout Budget**:
   - Rather than an arbitrary global timeout, the pipeline enforces coordinated phase budgets matching existing constants:
     - Caption resolution: 8,000ms (`waitForAudioCaptionTracks`).
     - Translation batching: 30,000ms per batch (`TRANSLATE_BATCH_TIMEOUT_MS`).
     - Lookahead TTS priming: 10,000ms.
     - Maximum end-to-end watchdog: 60,000ms.
   - If any phase exceeds its budget, the pipeline aborts, displays a `NotificationBanner` error, resets the toggle to `DUB: OFF`, and resumes video playback.
6. **Pre-Duck Volume Restoration**:
   - When dubbing is toggled OFF or aborted, the video volume is restored to `AudioDucker.baselineVolume` (the user's original volume setting prior to ducking), never a hardcoded 1.0 (100%).

### 4. Split Pill Control

The toolbar button on `.ytp-right-controls` is split into two distinct hit areas:
- **Primary Toggle**: Clicking the pill body or `DUB` label immediately toggles dubbing ON/OFF.
- **Expander Button**: A dedicated icon (gear / chevron) toggles the open/close state of the `CyberCockpit` settings dashboard without toggling dubbing.

## Consequences & Trade-offs

### Positive
- **Zero Waste**: Absolutely zero LLM tokens or TTS bandwidth consumed on videos watched in their native language.
- **Controlled Synchronization**: Eliminates mid-sentence audio ducking by ensuring the initial sliding window is primed before the playhead advances.
- **Resilient UX**: Clear user feedback via `PreparationOverlay`, instant escape hatch via `[CANCEL]` / `Escape`, and robust fallback against autoplay rejections.

### Negative
- **Extra Interaction**: Users must perform one click to activate dubbing on each video.
- **Pause Latency on Cache Miss**: First-time dubbing of a video pauses playback for 2–6 seconds while the first batch translates and primes TTS. (Mitigated by zero-jank fast path on repeat views).

## Alternatives Considered

1. **Hover-Triggered Prefetching**: Triggering pipeline when the user hovers over the player toolbar. *Rejected*: Causes high false-positive token waste when users casually mouse over player controls.
2. **Silent Background Caption Fetching without LLM**: Fetching only captions at load, delaying translation until toggle. *Deferred*: While it saves tokens, it still triggers Proof-of-Origin requests prematurely. Pure on-demand activation provides a cleaner, single-responsibility lifecycle.
3. **Eager Playback with Mid-Stream Ducking**: Letting video play while translating in background, then fading in dubbing. *Rejected*: The viewer misses the first several sentences of translated dialogue or experiences jarring mid-sentence language switches.
