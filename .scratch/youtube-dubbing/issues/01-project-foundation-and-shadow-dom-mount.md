# 01: Project Foundation & Shadow DOM In-Player HUD Mount

**What to build:** A working Web Extension skeleton using WXT, React, TypeScript, and TailwindCSS. When a YouTube video page loads, the extension injects an isolated Shadow DOM container into the player control bar (`.ytp-right-controls`), displaying a glowing `NEURAL DUB` floating pill. Clicking the pill toggles the Cyber Cockpit panel with futuristic glassmorphism and animations, fully isolated from YouTube's host styles.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] WXT extension project initialized with Manifest V3 and React/TypeScript/TailwindCSS configuration.
- [ ] Content script reliably detects YouTube video elements and page transitions (`yt-navigate-finish`).
- [ ] In-player controls mount directly into `.ytp-right-controls` encapsulated within a Shadow DOM root.
- [ ] Glowing `NEURAL DUB` trigger pill displays on the player bar without breaking YouTube's layout.
- [ ] Clicking the trigger pill toggles the Cyber Cockpit HUD panel with smooth open/close animations.
- [ ] Automated tests verify that Shadow DOM container mounts and unmounts cleanly without CSS leakage.
