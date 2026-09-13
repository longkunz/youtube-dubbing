# Specification: eJOY English-Style Dual Subtitle Overlay and Draggable Positioning (Issue #20 / ADR-0015)

## 1. Overview & Goals
Upgrade the extension's Parallel Caption Overlay to deliver an eJOY English-grade language-learning subtitle experience on YouTube.
Key goals:
- Prominent, high-contrast bilingual typography (English source on top, Vietnamese translation below).
- Selectable text for easy copying.
- Free-form drag-and-drop repositioning with boundary clamping within `#movie_player`.
- Responsive percentage-based coordinates persisted in extension storage (`settings.ts`).
- Double-click and Command Center position reset to default bottom docking.
- Zero interference with YouTube video play/pause.

## 2. Architecture & Seams

### 2.1 Settings Schema (`src/storage/settings.ts`)
Add `subtitlePosition` to `UserSettings`:
```ts
export interface SubtitlePosition {
  xPercent: number; // 0 to 100 (% from left of player container)
  yPercent: number; // 0 to 100 (% from top of player container)
}

export interface UserSettings {
  // ... existing fields ...
  subtitlePosition?: SubtitlePosition | null; // null = use default bottom docking
}

export const DEFAULT_SETTINGS: UserSettings = {
  // ...
  subtitleLineOrder: 'original-first', // updated default (was 'translated-first')
  subtitlePosition: null,
};
```
Also export helper:
`saveSettings({ subtitlePosition: { xPercent, yPercent } })`
`saveSettings({ subtitlePosition: null })` to reset.

### 2.2 Subtitle Component (`src/components/SubtitleOverlay.tsx`)
1. **Typography & Colors**:
   - `renderOriginal`:
     - Text color: `#ffffff`
     - Font size: `fontSizePx` (18px for standard, 14px for small, 22px for large)
     - Font weight: 600
     - `textShadow: '0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8)'`
     - `letterSpacing: '0.01em'`
   - `renderTranslated`:
     - Text color: `#00f2fe`
     - Font size: `secondaryFontSizePx` (15px for standard, 12px for small, 18px for large)
     - Font weight: 500
     - `textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)'`
     - `letterSpacing: '0.01em'`
   - Pill background:
     - `background: 'rgba(0, 0, 0, 0.78)'`
     - `backdropFilter: 'blur(8px)'`
     - `borderRadius: '6px'`
     - `padding: '6px 14px'`
     - `border: '1px solid rgba(255, 255, 255, 0.12)'`
     - `boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)'`
     - `userSelect: 'text'`
     - `cursor: 'grab'`
2. **Dragging Interaction**:
   - Add `onPositionChange?: (pos: SubtitlePosition) => void`
   - Add `onResetPosition?: () => void`
   - Drag handle: users can drag by clicking and holding on the pill or a drag handle.
   - Mouse handlers:
     - `onMouseDown`: start drag, capture initial mouse position and element offset, add `window.addEventListener('mousemove', ...)` and `window.addEventListener('mouseup', ...)`.
     - Prevent drag if user is highlighting text (e.g. `window.getSelection()?.toString()`).
     - Stop propagation on mouse events (`e.stopPropagation()`) so clicking does not toggle YouTube play/pause.
   - Double click: `onDoubleClick={(e) => { e.stopPropagation(); onResetPosition?.(); }}`.

### 2.3 Subtitle Mount & Dynamic Positioning (`src/entrypoints/content/subtitle-mount.tsx`)
1. Host element position:
   - If `position` is provided (`xPercent`, `yPercent`):
     - `hostEl.style.left = `${position.xPercent}%``
     - `hostEl.style.top = `${position.yPercent}%``
     - `hostEl.style.bottom = 'auto'`
     - `hostEl.style.transform = 'translate(-50%, -50%)'`
   - If `position` is null / unset:
     - `hostEl.style.left = '50%'`
     - `hostEl.style.top = 'auto'`
     - `hostEl.style.bottom = isAutohide ? '56px' : '96px'`
     - `hostEl.style.transform = 'translateX(-50%)'`
2. Shadow DOM style injection:
   - `:host { display: block; pointer-events: auto; }`
   - `.subtitle-overlay { pointer-events: auto; }`
   - `.subtitle-pill { pointer-events: auto; user-select: text; cursor: grab; }`
   - `.subtitle-pill.dragging { cursor: grabbing; }`

### 2.4 Command Center UI (`src/entrypoints/options/OptionsDashboard.tsx` & `InPageCommandCenter.tsx`)
1. Default line order dropdown: `'original-first'`.
2. Add "Reset Subtitle Position" button:
   - Under Section 3 (Parallel Caption Overlay).
   - Resets `subtitlePosition` to `null` in `settings.ts`.
   - Dispatches reset to active subtitle mount instance via `getActiveSubtitleInstance()?.resetPosition()`.

## 3. Verification Gates
- `npm.cmd run typecheck`: 0 errors.
- `npm.cmd test -- --run`: all tests pass including new unit/integration tests for:
  - eJOY bilingual styling (original on top with text-shadow, translated in cyan below).
  - Draggable position calculation and clamping within bounds.
  - Double-click reset to default bottom docking.
  - Storage persistence in `settings.ts`.
  - Command Center reset button action.
