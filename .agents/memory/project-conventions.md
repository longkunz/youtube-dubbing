---
type: project
created: 2026-09-08
updated: 2026-09-08
---

# Project Conventions

## Tech Stack
- Web Extension: WXT (Manifest V3) + React + TypeScript + TailwindCSS
- Primary AI Translation: Google Gemini 1.5 / 2.0 Flash (BYOK - Bring Your Own Key)
- Speech Synthesis: Microsoft Edge Neural TTS (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`) via Background Service Worker WebSocket
- Persistent Cache: Browser IndexedDB (`idb` repository)

## Architecture & Seams
- In-player UI must always mount within an isolated Shadow DOM (`createShadowRootUi`) to prevent CSS collision with YouTube.
- High-level testing seam is `DubbingOrchestrator` to enable testing the entire pipeline without hitting live YouTube or cloud APIs.
- Subtitle rendering must remain gentle and clean: `rgba(8, 8, 8, 0.84)` rounded black pill, crisp white text, zero neon glare.
