# Memory Index

## User
- [user] Windows environment, PowerShell shell, GitHub user longkunz → user-preferences.md
- [user] Prefers disciplined workflows: Grilling → Domain Modeling → Open Design Prototype → Spec → Tickets → TDD → user-preferences.md
- [user] Loves Hyper / Fantastic Sci-Fi HUD aesthetics (cockpit, glassmorphism, neon), but gentle subtitles → user-preferences.md

## Project
- [project] Stack: WXT (Manifest V3) + React + TypeScript + TailwindCSS → project-conventions.md
- [project] AI Translation: gemini-2.0-flash (BYOK); TTS: Microsoft Edge Neural TTS → project-conventions.md
- [project] In-Player UI must be isolated in Shadow DOM (.ytp-right-controls) → project-conventions.md
- [project] Primary test seam is DubbingOrchestrator for full-pipeline TDD → project-conventions.md
- [project] Subtitle overlay: canonical rgba(8, 8, 8, 0.84) black pill with crisp #ffffff text → project-conventions.md
- [project] Persistent cache: SegmentCache via idb promise wrapper → project-conventions.md
- [project] Multi-agent: Coder is agy (Sonnet 4.6 / Gemini 3.8 Flash High), Reviewer is OpenCode (Muse Spark Free) → project-conventions.md
- [project] Orchestration: Always dispatch Coder & Reviewer in dedicated Orca Terminals on Windows → project-conventions.md

## Tech Decisions
- [project] 100% Client-Side BYOK architecture (ADR-0001) → tech-decisions.md
- [project] Volume Lerp for Audio Ducking to avoid CORS restrictions (ADR-0002) → tech-decisions.md
- [project] Upfront batch translation with gemini-2.0-flash + sliding window TTS (ADR-0003) → tech-decisions.md
- [project] Hyper-Fantastic Sci-Fi HUD for controls, supersedes ADR-0005 (ADR-0006) → tech-decisions.md

## Feedback
- [feedback] User loves Hyper Sci-Fi HUD for controls & telemetry → feedback-history.md
- [feedback] Subtitle overlay must be gentle, clean YouTube CC style → feedback-history.md
- [feedback] Prefers GitHub Issues via gh CLI for tracking → feedback-history.md
- [feedback] VoiceProfile contract must include pitch and rate prosody parameters → feedback-history.md
