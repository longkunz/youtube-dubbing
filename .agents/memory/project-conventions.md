---
type: project
created: 2026-09-08
updated: 2026-09-09
---

# Project Conventions

## Windows Shell & Build
- PowerShell execution policy blocks `npm.ps1` — always invoke npm via the call operator with the `.cmd` shim (e.g. `& "<nodejs>\pm.cmd" run build`), never bare `npm`.
- After every build, output lands in `.output/chrome-mv3/`; the user must manually reload the extension at `chrome://extensions/` (service worker restart) plus hard-refresh the YouTube tab — verify new strings made it into the bundle before asking the user to test.

## Tech Stack
- Web Extension: WXT (Manifest V3) + React + TypeScript + TailwindCSS
- Primary AI Translation: configurable Gemini Flash (default `gemini-3.8-flash`, BYOK) plus OpenAI-compatible proxies
- Speech Synthesis: Microsoft Edge Neural TTS (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`) via Background Service Worker WebSocket
- Persistent Cache: Browser IndexedDB (`idb` repository)

## Architecture & Seams
- In-player UI must always mount within an isolated Shadow DOM (`createShadowRootUi`) to prevent CSS collision with YouTube.
- High-level testing seam is `DubbingOrchestrator` to enable testing the entire pipeline without hitting live YouTube or cloud APIs.
- Subtitle rendering must remain gentle and clean: `rgba(8, 8, 8, 0.84)` rounded black pill, crisp white text, zero neon glare.

## Multi-Agent Implement Workflow (Orca Orchestration)
- Coder: Antigravity CLI (`agy --dangerously-skip-permissions --model claude-sonnet-4-6`, fallback: `gemini-3.8-flash-high`) running in a dedicated Orca Terminal.
- Reviewer: OpenCode (`opencode -m opencode/muse-spark-1.3-contributor-free`, free Zen model, no login/API key required) running in a dedicated Orca Terminal.
- Orchestration Protocol (Windows): Always create separate Orca Terminals (`orca terminal create`, `send`, `read`, `close`) for Coder and Reviewer. Never execute Coder in-session.
- Verification Gates: `npm run typecheck` and `npm test` must pass before dispatching Reviewer.

