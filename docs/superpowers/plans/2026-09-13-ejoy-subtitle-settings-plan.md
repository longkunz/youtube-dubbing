# Implementation Plan: eJOY-Style Subtitle Configuration and Learning Tools (Issue #21 / ADR-0016)

## Target Seams
- `src/storage/settings.ts`: Schema extensions for `subtitleOriginalFontSize`, `subtitleTranslatedFontSize`, `subtitleOriginalColor`, `subtitleTranslatedColor`, `subtitleBackgroundOpacity`, `subtitleTextShadow`, `subtitleAutoPause`, `subtitleHotkeysEnabled`.
- `src/components/SubtitleOverlay.tsx`: Props and styling for custom font sizes, colors, background opacity, and text shadow.
- `src/entrypoints/content/subtitle-mount.tsx`: Wiring settings into SubtitleOverlay, auto-pause monitoring, and A/S/D navigation hotkeys.
- `src/entrypoints/options/OptionsDashboard.tsx`: Section 3 UI enhancements with dual font sliders, color pickers, opacity slider, text-shadow toggle, live preview, and learning toggles.
- `tests/ejoy-subtitle-settings.test.tsx`: Comprehensive unit & integration tests.

---

### Task 1: Update Settings Schema (`src/storage/settings.ts`)
- [ ] Add new fields to `UserSettings`:
  - `subtitleOriginalFontSize: number` (default 18)
  - `subtitleTranslatedFontSize: number` (default 15)
  - `subtitleOriginalColor: string` (default '#ffffff')
  - `subtitleTranslatedColor: string` (default '#00f2fe')
  - `subtitleBackgroundOpacity: number` (default 78)
  - `subtitleTextShadow: boolean` (default true)
  - `subtitleAutoPause: boolean` (default false)
  - `subtitleHotkeysEnabled: boolean` (default false)
- [ ] Update `DEFAULT_SETTINGS` with these defaults.
- [ ] Update `normalizeSettings` to validate and clamp numeric ranges and hex color values.
- [ ] Write unit tests verifying schema defaults, normalization, and bounds clamping.

### Task 2: Enhance SubtitleOverlay Component (`src/components/SubtitleOverlay.tsx`)
- [ ] Extend `SubtitleOverlayProps` with custom styling props (`originalFontSize`, `translatedFontSize`, `originalColor`, `translatedColor`, `backgroundOpacity`, `textShadowEnabled`).
- [ ] Apply custom font sizes, colors, opacity, and text-shadow dynamically in `renderOriginal`, `renderTranslated`, and the pill container.
- [ ] Ensure backward compatibility with existing `fontSizeScale` ('small', 'standard', 'large') when custom props are not provided.
- [ ] Add unit tests verifying custom styling props take precedence.

### Task 3: Implement Auto-Pause and Hotkeys in Subtitle Mount (`src/entrypoints/content/subtitle-mount.tsx`)
- [ ] Track current settings via `onSettingsChange` or initial load.
- [ ] Pass custom styling props from settings to `SubtitleOverlay`.
- [ ] Auto-Pause logic:
  - When `settings.subtitleAutoPause` is enabled, check video time against active segment's `endSec`.
  - Pause playback cleanly once per segment at end boundary.
- [ ] Navigation Hotkeys (`A` / `S` / `D`):
  - Listen for keydown events on `window`.
  - Guard against editable targets (`input`, `textarea`, `contenteditable`).
  - Seek video to previous (`A`), current (`S`), or next (`D`) segment.
  - Proper listener cleanup on unmount.
- [ ] Write integration tests for Auto-Pause and hotkey navigation.

### Task 4: Enhance Command Center Section 3 (`src/entrypoints/options/OptionsDashboard.tsx`)
- [ ] Add state for custom font sizes, colors, opacity, text-shadow, auto-pause, and hotkeys.
- [ ] Add independent font size sliders with real-time numeric readouts.
- [ ] Add color preset buttons (#ffffff, #ffeb3b, #00f2fe, #00ff88, #cbd5e1) and native color pickers for both lines.
- [ ] Add background opacity slider (0% to 100%).
- [ ] Add text-shadow toggle switch.
- [ ] Add interactive Live Subtitle Preview box demonstrating current visual styling.
- [ ] Add switches for Auto-Pause and Subtitle Navigation Hotkeys.
- [ ] Write tests verifying all controls persist their values to `settings.ts`.

### Task 5: Full Verification Gates
- [ ] Run `npm.cmd run typecheck` (0 errors).
- [ ] Run `npm.cmd test -- --run` (all tests passing).
