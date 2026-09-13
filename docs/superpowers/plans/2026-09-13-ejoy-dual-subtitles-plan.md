# Implementation Plan: eJOY English-Style Dual Subtitle Overlay and Draggable Positioning (Issue #20 / ADR-0015)

## Target Seams
- `src/storage/settings.ts`: schema extension for `subtitlePosition` and updated default `subtitleLineOrder: 'original-first'`.
- `src/components/SubtitleOverlay.tsx`: eJOY typography (prominent white source text with text-shadow, cyan translation below, translucent pill), selectable text, drag-and-drop listener, double-click reset.
- `src/entrypoints/content/subtitle-mount.tsx`: percentage-based positioning, dynamic bottom fallback when position is null, shadow DOM pointer-events and grab cursor styling, `setPosition` and `resetPosition` instance methods.
- `src/entrypoints/options/OptionsDashboard.tsx`: reset position button under Parallel Caption Overlay section.
- `tests/subtitle-overlay.test.tsx` (or new test file `tests/ejoy-dual-subtitles.test.tsx`): unit and integration tests.

---

### Task 1: Update Settings Schema (`src/storage/settings.ts`)
- [ ] Add `SubtitlePosition` interface `{ xPercent: number; yPercent: number }`.
- [ ] Add `subtitlePosition?: SubtitlePosition | null` to `UserSettings`.
- [ ] Change `DEFAULT_SETTINGS.subtitleLineOrder` from `'translated-first'` to `'original-first'`.
- [ ] Add `DEFAULT_SETTINGS.subtitlePosition = null`.
- [ ] Add unit tests in `tests/storage-settings.test.ts` (or existing settings test) verifying default `subtitleLineOrder === 'original-first'` and `subtitlePosition` persistence.

### Task 2: Update SubtitleOverlay Component (`src/components/SubtitleOverlay.tsx`)
- [ ] Update `renderOriginal`: `#ffffff`, `font-weight: 600`, `text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8)`.
- [ ] Update `renderTranslated`: `#00f2fe`, `font-weight: 500`, `text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8)`.
- [ ] Update `subtitle-pill`: `background: rgba(0, 0, 0, 0.78)`, `backdrop-filter: blur(8px)`, `border-radius: 6px`, `padding: 6px 14px`, `border: 1px solid rgba(255, 255, 255, 0.12)`, `user-select: text`, `cursor: grab`.
- [ ] Implement mouse drag handlers with container bounding box calculation:
  - `onMouseDown`: record starting mouse and element offsets, set `isDragging(true)`.
  - `mousemove` & `mouseup` listeners on `window` to track drag deltas and clamp percentage between 2% and 98%.
  - Call `onPositionChange?.({ xPercent, yPercent })` on drag end.
  - `onDoubleClick`: call `onResetPosition?.()`.
  - Stop event propagation (`e.stopPropagation()`) so dragging and text selecting never toggle video play/pause.

### Task 3: Update Subtitle Mount (`src/entrypoints/content/subtitle-mount.tsx`)
- [ ] Update `SubtitleOverlayInstance` interface to include `setPosition(pos: SubtitlePosition | null): void` and `resetPosition(): void`.
- [ ] In `mountSubtitleOverlay`:
  - Load `subtitlePosition` from `getSettings()` initially.
  - Apply percentage-based coordinates when `subtitlePosition` is set (`hostEl.style.left = ...`, `hostEl.style.top = ...`, `hostEl.style.bottom = 'auto'`, `hostEl.style.transform = 'translate(-50%, -50%)'`).
  - When `subtitlePosition` is null, preserve dynamic bottom docking (`56px` or `96px` based on `ytp-autohide`).
  - Wire `onPositionChange` to call `saveSettings({ subtitlePosition: pos })`.
  - Wire `onResetPosition` to call `saveSettings({ subtitlePosition: null })`.
  - Update shadow DOM stylesheet: `.subtitle-pill { user-select: text; cursor: grab; pointer-events: auto; } .subtitle-pill.is-dragging { cursor: grabbing; }`.

### Task 4: Command Center Integration (`src/entrypoints/options/OptionsDashboard.tsx`)
- [ ] Ensure line order dropdown shows `Original First (Top)` as default.
- [ ] Add "Reset Subtitle Position" button in Section 3 (Parallel Caption Overlay).
- [ ] Clicking the button calls `saveSettings({ subtitlePosition: null })`, triggers `getActiveSubtitleInstance()?.resetPosition()`, and shows brief confirmation badge.

### Task 5: Comprehensive Tests & Verification Gates
- [ ] Write dedicated tests in `tests/ejoy-dual-subtitles.test.tsx` verifying:
  - eJOY bilingual styling and typography hierarchy.
  - Dragging calculations and boundary clamping.
  - Double-click reset to default bottom docking.
  - Persistence in storage settings.
  - Command Center reset button action.
- [ ] Run `npm.cmd run typecheck` (0 errors).
- [ ] Run `npm.cmd test -- --run` (all tests passing).
