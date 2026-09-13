---
status: accepted
date: 2026-09-13
---

# 16. eJOY-Style Subtitle Configuration and Learning Tools

We incorporated an eJOY-grade subtitle configuration suite and interactive language learning tools into the In-Page Command Center and Parallel Caption Overlay pipeline.

## Context & Problem
While ADR-0015 introduced an eJOY-inspired bilingual layout and drag-and-drop repositioning, users were still constrained to coarse font size presets (small/standard/large) and fixed default colors (white on cyan). Furthermore, language learners lacked crucial repetition tools (such as automatic pausing at the end of spoken phrases and keyboard hotkeys to rewind or replay phrases) that define dedicated learning extensions like eJOY English.

## Decision
1. **Centralized Subtitle Configuration in Command Center**:
   - Rather than cluttering the YouTube player toolbar with floating setting menus, all subtitle customization is housed cleanly inside Section 3 (*Parallel Caption Overlay*) of the In-Page Command Center drawer.

2. **Fine-Grained Visual Controls & Live Preview**:
   - **Independent Font Sizing**: Granular sliders for source English dialogue (`12px` - `36px`, default `18px`) and translated Vietnamese dialogue (`10px` - `30px`, default `15px`).
   - **Dual-Tier Color Palette**: 5 curated high-contrast preset buttons (`#ffffff`, `#ffeb3b`, `#00f2fe`, `#00ff88`, `#cbd5e1`) plus custom HTML5 hex color pickers for both lines.
   - **Background Opacity Slider**: Smooth 0% (fully transparent) to 100% (solid black) adjustment, defaulting to 78%.
   - **Text Contrast Drop Shadow**: Toggleable contrast enhancement.
   - **Live Subtitle Preview**: An interactive preview card inside the Command Center that reflects font sizing, colors, opacity, and line ordering in real time.

3. **Language Learning Utilities (Auto-Pause & Hotkeys)**:
   - **Auto-Pause at Segment End**: When enabled, the player automatically pauses at the boundary timestamp of each subtitle segment, giving the learner unlimited time for shadowing/repetition. Pressing `Space` or clicking the video resumes playback to the next segment.
   - **Navigation Hotkeys (`A` / `S` / `D`)**:
     - `A`: Seek to the start of the previous subtitle segment.
     - `S`: Replay the current subtitle segment from its start timestamp.
     - `D`: Jump immediately to the start of the next subtitle segment.
     - Guard: Disabled automatically when user focus is within any input, textarea, or contenteditable element.
     - Default state: Disabled by default to prevent accidental triggers for casual viewers.

## Consequences
- Elevates the extension into a fully-fledged language-learning tool alongside its dubbing capabilities.
- Gives users complete visual and ergonomic control over subtitle rendering on any video format.
- Zero external dependencies or API overhead.
