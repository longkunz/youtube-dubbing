---
status: accepted
date: 2026-09-13
---

# 15. eJOY English-Style Dual Subtitle Overlay and Draggable Positioning

We upgraded the visual presentation and interactivity of the Parallel Caption Overlay to mirror language-learning extensions like eJOY English, providing an optimal learning and viewing experience on YouTube.

## Context & Problem
Previously, the Parallel Caption Overlay displayed translated text on top and original source text below in a static, non-interactive pill locked to `pointer-events: none` and `user-select: none`. Users could not select or copy subtitle text, could not adjust subtitle placement when it obscured video graphics, and lacked the visual clarity of dedicated language learning tools where the original English line is primary and visually distinct from the translation.

## Decision
1. **eJOY-Style Bilingual Typography**:
   - Default `lineOrder` is changed from `translated-first` to `original-first` (source English dialogue on top, translated Vietnamese dialogue below).
   - The original line is rendered prominently in crisp `#ffffff`, font-weight 600, with `text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8)` for contrast against any video background.
   - The translated line is rendered below in high-contrast cyan `#00f2fe` at font-weight 500, visually distinguishing the two linguistic tiers.
   - Both lines are housed in a translucent dark pill (`rgba(0, 0, 0, 0.78)` with `backdrop-filter: blur(8px)`, bo-góc `6px-8px`).

2. **Selectable Text & Interactive Surface**:
   - Enabled `user-select: text` and `pointer-events: auto` on the subtitle pill, with mouse event propagation stopped (`e.stopPropagation()`) so dragging or highlighting text does not toggle YouTube's native video play/pause.

3. **Draggable Positioning & Percentage-Based Persistence**:
   - The subtitle overlay supports drag-and-drop repositioning with `cursor: grab`/`grabbing`, bounded securely within `#movie_player`.
   - Coordinates are stored in extension settings as relative viewport percentages (`xPercent`, `yPercent`), maintaining exact proportional screen placement across normal, theater, and fullscreen display modes.
   - Quick reset: double-clicking the subtitle pill or clicking "Reset Subtitle Position" in the Command Center immediately restores default bottom docking (56px/96px dynamic offset responding to `ytp-autohide`).

4. **Settings & Customization**:
   - Command Center retains user options for `bilingual`, `original-only`, and `translated-only` display modes, font scaling (`small`, `standard`, `large`), and line ordering, while defaulting to `original-first` and providing a dedicated position reset action.

## Consequences
- Enhanced language learning utility on YouTube with clear visual hierarchy and copyable text.
- Full positional control without obstructing on-screen slides, lower-thirds, or gameplay HUDs.
- Zero extra compute or network overhead: purely client-side rendering and position storage.
