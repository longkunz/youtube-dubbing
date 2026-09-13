# Specification: eJOY-Style Subtitle Configuration and Learning Tools (Issue #21 / ADR-0016)

## 1. Overview & Goals
Provide comprehensive eJOY English-grade subtitle configuration directly inside Section 3 (*Parallel Caption Overlay*) of the In-Page Command Center drawer, accompanied by language-learning features (auto-pause and A/S/D hotkeys).

## 2. Technical Architecture & Interfaces

### 2.1 Settings Schema (`src/storage/settings.ts`)
Add new fields to `UserSettings`:
```ts
export interface UserSettings {
  // ... existing fields ...
  subtitleOriginalFontSize: number;      // 12 - 36 px, default: 18
  subtitleTranslatedFontSize: number;    // 10 - 30 px, default: 15
  subtitleOriginalColor: string;          // hex color, default: '#ffffff'
  subtitleTranslatedColor: string;        // hex color, default: '#00f2fe'
  subtitleBackgroundOpacity: number;      // 0 - 100 %, default: 78
  subtitleTextShadow: boolean;            // default: true
  subtitleAutoPause: boolean;             // default: false
  subtitleHotkeysEnabled: boolean;        // default: false
}
```
Normalize functions will ensure boundaries:
- `subtitleOriginalFontSize`: clamped between 12 and 36, default 18.
- `subtitleTranslatedFontSize`: clamped between 10 and 30, default 15.
- `subtitleBackgroundOpacity`: clamped between 0 and 100, default 78.
- Color strings validated against hex regex `/^#[0-9A-Fa-f]{6}$/`.

### 2.2 Subtitle Component (`src/components/SubtitleOverlay.tsx`)
Props extension:
```ts
export interface SubtitleOverlayProps {
  // ... existing ...
  originalFontSize?: number;
  translatedFontSize?: number;
  originalColor?: string;
  translatedColor?: string;
  backgroundOpacity?: number;
  textShadowEnabled?: boolean;
}
```
Styling rules:
- Original text: `fontSize: `${originalFontSize ?? 18}px``, `color: originalColor ?? '#ffffff'`.
  `textShadow`: if `textShadowEnabled !== false`, use `'0 1px 3px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.8)'`, otherwise `'none'`.
- Translated text: `fontSize: `${translatedFontSize ?? 15}px``, `color: translatedColor ?? '#00f2fe'`.
- Pill container:
  `background: `rgba(0, 0, 0, ${(backgroundOpacity ?? 78) / 100})``,
  `border: backgroundOpacity === 0 ? 'none' : '1px solid rgba(255, 255, 255, 0.12)'`.

### 2.3 Learning Utilities (`src/entrypoints/content/subtitle-mount.tsx` & coordinator)
1. **Auto-Pause**:
   - Track `lastAutoPausedSegmentId: string | null`.
   - On playback progress / timeupdate:
     - When `video.currentTime >= segment.endSec - 0.1` and `video.currentTime <= segment.endSec + 0.3`:
       - If `settings.subtitleAutoPause` is true and `lastAutoPausedSegmentId !== segment.id`:
         - Call `video.pause()`.
         - Set `lastAutoPausedSegmentId = segment.id`.
         - User pressing Space or clicking video continues playback.
2. **Navigation Hotkeys (`A` / `S` / `D`)**:
   - Global `keydown` event listener attached to `window` (with cleanup on unmount):
     - Check `if (!settings.subtitleHotkeysEnabled) return;`
     - Check if target element is editable:
       `const isEditable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;`
       `if (isEditable) return;`
     - `e.key.toLowerCase() === 'a'`: find segment before current time, seek to `prevSegment.startSec`, `e.preventDefault()`, `e.stopPropagation()`.
     - `e.key.toLowerCase() === 's'`: find current segment, seek to `currentSegment.startSec`, `e.preventDefault()`, `e.stopPropagation()`.
     - `e.key.toLowerCase() === 'd'`: find segment after current time, seek to `nextSegment.startSec`, `e.preventDefault()`, `e.stopPropagation()`.

### 2.4 Command Center UI (`src/entrypoints/options/OptionsDashboard.tsx`)
In Section 3 (Parallel Caption Overlay):
1. **Font Size Sliders**:
   - English / Source Size slider (`12` to `36`, step `1`) with numeric indicator.
   - Vietnamese / Translated Size slider (`10` to `30`, step `1`) with numeric indicator.
2. **Color Palette & Hex Pickers**:
   - For English line: buttons for `#ffffff`, `#ffeb3b`, `#00f2fe`, `#00ff88`, `#cbd5e1`, plus `<input type="color">`.
   - For Vietnamese line: same palette + color picker.
3. **Background Opacity Slider**:
   - Slider from `0%` to `100%` with real-time percentage readout.
4. **Text Shadow Toggle**:
   - Checkbox / switch for "High Contrast Text Shadow".
5. **Live Subtitle Preview Box**:
   - Interactive preview displaying:
     - "The quick brown fox jumps over the lazy dog." (styled with original font size/color)
     - "Con cáo nâu nhanh nhẹn nhảy qua con chó lười biếng." (styled with translated font size/color)
     - Background box matching the selected opacity and blur.
6. **Learning Suite Controls**:
   - Toggle switch for "Auto-Pause at end of subtitle (Shadowing Mode)".
   - Toggle switch for "Subtitle Navigation Hotkeys (A: Prev, S: Replay, D: Next)".

## 3. Verification Gates
- `npm.cmd run typecheck`: 0 errors.
- `npm.cmd test -- --run`: All tests pass including new dedicated tests in `tests/ejoy-subtitle-settings.test.tsx`.
