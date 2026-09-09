## Problem Statement

When opening a YouTube watch page or navigating via Single Page Application (SPA) links, the extension currently initiates the dubbing pipeline eagerly and automatically per ADR-0003. This behavior incurs unsolicited API token charges (transcript fetching, LLM translation, TTS generation) for videos the user only intends to watch in their original audio, introduces race conditions before player Proof-of-Origin tokens (`pot`) are minted, and causes jarring mid-sentence audio ducking before lookahead speech is adequately prepared.

## Solution

Implement an **On-Demand Activation** model (Amending ADR-0003) with a pause-and-buffer UX:
1. **Dormant Mount**: Mount in-player controls into the YouTube toolbar in an idle/dormant state (`DUB: OFF`) on page load and SPA navigation without triggering background translation or speech synthesis.
2. **Split Pill Control**: Upgrade the toolbar `FloatingPill` into a dual-action control with a primary 1-click Dub Track toggle and a dedicated expander button for the Cyber Cockpit settings panel.
3. **Zero-Jank Cache-Hit Fast Path**: When the user toggles dubbing ON, first query `SegmentCache` (IndexedDB). If already translated, immediately attach `DubbingOrchestrator` without pausing the video and without mounting the Preparation Overlay.
4. **Pause & Preparation (Cache Miss)**: On cache miss, immediately pause the host video (`video.pause()`) and display a centered, cyber-styled **Preparation Overlay** over the video player (`AETHERDUB // SYNTHESIZING DUB TRACK...`) with full pointer-event click interception and an accessible `[CANCEL]` / `Escape` action.
5. **AbortController & Session Cancellation**: Every activation session is armed with an `AbortController`. If the user clicks `[CANCEL]`, toggles Dubbing OFF, or navigates to another video while buffering, all in-flight requests are aborted, the overlay unmounts, volume restores to the user's pre-duck baseline, and video playback resumes.
6. **Autoplay Policy Handling on Resume**: If the browser's autoplay policy rejects `video.play()` after asynchronous network operations, the Preparation Overlay transitions to an interactive `DUBBING READY — CLICK TO RESUME` prompt to supply a fresh user gesture.
7. **Phase-Based Timeouts**: Replace arbitrary global timeouts with coordinated phase budgets matching existing constants: 8s caption resolution, 30s per-batch translation (`TRANSLATE_BATCH_TIMEOUT_MS`), 10s TTS priming, and a 60s overall watchdog.
8. **Fail-Safe Recovery**: If caption resolution fails, an API error occurs, or timeout expires, the overlay dismisses, a `NotificationBanner` is shown, the toggle resets to `DUB: OFF`, and the original video automatically resumes playback at its pre-duck volume level.
9. **Smooth Teardown**: When the user toggles dubbing OFF during playback, the Dub Track immediately stops, audio ducking restores original video volume to its pre-duck baseline, and the video continues playing without interruption.

## User Stories

1. As a viewer, I want the extension to remain dormant when I open a YouTube video, so that I don't waste API tokens or have my audio altered on videos I want to watch in their original language.
2. As a viewer, I want to see a clear `DUB: OFF` status indicator on the YouTube player toolbar, so that I know dubbing is available but not active.
3. As a viewer, I want to click directly on the toolbar pill to activate dubbing with a single click, so that I don't have to navigate through popup menus.
4. As a viewer, I want a separate settings button on the toolbar pill, so that I can open the Cyber Cockpit without accidentally toggling dubbing on or off.
5. As a viewer, I want cached videos to play dubbing instantly without pausing or showing a loading screen, so that repeated viewing is seamless.
6. As a viewer, I want the video to pause immediately when I turn dubbing on for an uncached video, so that I don't miss dialogue while the audio track is being generated.
7. As a viewer, I want a sci-fi Preparation Overlay displayed in the center of the video while dubbing is loading, so that I have clear visual feedback that the system is working.
8. As a viewer, I want accidental clicks on the video to be blocked while the Preparation Overlay is displayed, so that playback doesn't desynchronize before dubbing is ready.
9. As a viewer, I want an accessible Cancel button and Escape key support on the Preparation Overlay, so that I can abort the dubbing process immediately and resume watching if I change my mind.
10. As a viewer, I want all in-flight network requests cancelled immediately if I cancel or toggle off during preparation, so that background tasks do not continue consuming resources or pop up unexpectedly.
11. As a viewer, I want the video to automatically resume playback once dubbing is ready, so that I don't have to manually press play under normal browser conditions.
12. As a viewer, I want a clear "Click to Resume" button if the browser's autoplay policy blocks unprompted playback, so that I can easily resume playback with full audio.
13. As a viewer, I want dubbing audio to be perfectly synchronized with video playback as soon as it resumes, so that the viewing experience feels seamless.
14. As a viewer, I want the video to automatically resume and show a NotificationBanner if the video has no captions, so that I am never stuck in a paused state on unsupported videos.
15. As a viewer, I want phase-coordinated timeouts that account for long batch translations without hanging indefinitely, so that my player is protected against unresponsive APIs.
16. As a viewer, I want to turn dubbing off with a single click while the video is playing, so that I can immediately switch back to the original audio.
17. As a viewer, I want turning dubbing off to restore my original video volume to its exact pre-duck baseline level without pausing the video, so that my viewing volume preference is preserved.
18. As a viewer, I want dubbing to reset to `DUB: OFF` whenever I navigate to a new YouTube video, so that I can choose which videos to dub on a per-video basis.

## Implementation Decisions

1. **Passive Lifecycle Seam**:
   - In `src/entrypoints/content/index.ts`, `tryMount()` and the `aetherdub:player-response-ready` event listener will mount the toolbar HUD in a dormant state and will no longer invoke `startDubbingPipeline()` automatically.
   - The coordinator state tracks initialization state and active video ID without eager pipeline launches.

2. **Split Pill Control Component**:
   - Upgrade `src/components/FloatingPill.tsx` into a split pill:
     - Primary hit area: Toggles Dub Track state (`isEnabled`), triggering the pause-and-prepare flow when turned ON, and teardown when turned OFF.
     - Secondary hit area: Toggles the `isOpen` state of the Cyber Cockpit settings panel.
     - Visual badge indicates state (`DUB: OFF` / `DUB: ON` / `SYNTHESIZING...`).

3. **Fast-Path Cache Inspection**:
   - When activation is triggered, query `SegmentCache` first.
   - If present in IndexedDB: initialize orchestrator immediately, bind video listeners, sync playback, and leave video unpaused.

4. **Preparation Overlay Component & Container Mounting**:
   - Introduce `PreparationOverlay` mounted inside `#movie_player` via Shadow DOM:
     - Semi-transparent dark glass backdrop (`z-index: 60`, `pointer-events: auto`).
     - Cyan glowing spinner ring and telemetry status readout.
     - Accessible `[CANCEL]` action button and `Escape` keyboard listener.
     - Autoplay fallback state: renders `DUBBING READY — CLICK TO RESUME` button if `video.play()` rejection occurs.

5. **AbortController & Session Lifecycle**:
   - Armed per activation attempt.
   - `stopDubbingPipeline()` aborts in-flight caption polling and translation tasks, unmounts `PreparationOverlay`, restores `video.volume = baselineVolume`, and calls `video.play()` if paused during preparation.

6. **Phase-Based Timeout Coordination**:
   - Caption phase: 8s.
   - Translation phase: 30s per batch (`TRANSLATE_BATCH_TIMEOUT_MS`).
   - TTS priming: 10s.
   - Watchdog: 60s max.

7. **Pre-Duck Volume Restoration**:
   - Restores volume to `AudioDucker.baselineVolume` upon toggle OFF or error.

## Testing Decisions

1. **What Makes a Good Test**:
   - Tests must exercise external behavior and public component/module seams, asserting DOM attributes, video element interactions (`pause()`, `play()`, `volume`), and user-visible HUD states.

2. **Target Seams & Modules to Test**:
   - **HUD Container & Split Pill**: Test dual-action click events (primary toggle vs. settings expansion) and badge label transitions.
   - **Mount & Lifecycle**: Verify that `tryMount()` attaches the host element to `.ytp-right-controls` without starting the dubbing pipeline or pausing the video.
   - **Fast Path**: Verify that if a transcript is already in `SegmentCache`, dubbing initializes without invoking `video.pause()`.
   - **Preparation Flow**: Verify that uncached activation calls `video.pause()`, mounts the Preparation Overlay, blocks pointer events, and resumes playback with `video.play()` upon pipeline completion.
   - **Cancellation & In-Flight Abort**: Verify that clicking Cancel or Escape aborts in-flight tasks, dismisses the overlay, restores pre-duck volume, and calls `video.play()`.
   - **Autoplay Rejection Fallback**: Mock `video.play()` returning a rejected Promise and verify that the overlay displays the click-to-resume prompt.
   - **Teardown Flow**: Verify that triggering dubbing OFF cleans up the pipeline without invoking `video.pause()`.

## Out of Scope

1. Automatic channel-based whitelisting or remembering ON state across video navigations.
2. Modifying YouTube's native video buffering or resolution controls.
3. Offline pre-caching of entire videos prior to user activation.

## Further Notes

- Formally amends ADR-0003 and defines ADR-0008 (`docs/adr/0008-on-demand-pause-and-buffer-activation.md`).
- Conforms strictly to domain glossary defined in `CONTEXT.md`.
