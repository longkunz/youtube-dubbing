---
status: accepted
date: 2026-09-12
---

# 11. In-Page Command Center Slide-Over Drawer

We replaced the default toolbar action behavior (`chrome.runtime.openOptionsPage()`) with an In-Page Command Center slide-over drawer on YouTube tabs, falling back to opening the options page in a tab on non-YouTube or restricted pages. The drawer mounts inside a dedicated page-level Shadow DOM host attached to `document.fullscreenElement || document.body`, docked to the right edge at `min(480px, 100vw)`. It displays the complete configuration dashboard in a single-column layout without a dimming backdrop, pauses video playback upon opening without auto-resuming on close, and closes on Escape, click-outside, navigation, or re-clicking the toolbar icon. The Cyber Cockpit settings button triggers this same in-page drawer.
