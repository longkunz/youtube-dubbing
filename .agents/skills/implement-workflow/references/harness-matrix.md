# Harness & Agent Compatibility Matrix

Launch configurations and permission bypass postures for worker dispatch in `/implement-workflow` via Orca CLI (`orca orchestration worker-start`).

| Agent / CLI | Orca Agent ID | Permission Auto-Approve Flags | Execution Notes |
| :--- | :--- | :--- | :--- |
| **Claude Code** | `claude` | `--dangerously-skip-permissions` | Runs native Claude TUI; honors project instructions via `CLAUDE.md`. |
| **OpenCode** | `opencode` | auto-approved via CLI config | Built-in free models available via OpenCode Zen (e.g. `opencode/muse-spark-1.3-contributor-free`, `opencode/nemotron-3.5-lightning-free`), **no external login or API key required**. Pass `--model opencode/muse-spark-1.3-contributor-free` (or `-m opencode/muse-spark-1.3-contributor-free`). |
| **Cline** | `cline` | `--auto-approve true` / Shift+Tab in TUI | Auto-approve all tools enabled; accepts messages via queue or interactive terminal. Ensure configured model has reliable network latency to prevent timeouts. |
| **Codex CLI** | `codex` | `--dangerously-bypass-approvals-and-sandbox` | Headless/TUI worker; run `orca agent hooks prepare-codex` or trust hooks in `.codex/config.toml` to avoid sandbox/hook approval interruptions. |
| **Cursor Agent** | `cursor` | `--force` | Runs Cursor agent worker. |
| **Antigravity CLI** | `antigravity` (or `agy`) | `--dangerously-skip-permissions` | Google Antigravity CLI session. If current orchestrator is Antigravity, can execute TDD in-session directly at public seams. |

## Launch Guidelines
- **Authentication & Model Prerequisite**: Ensure the target agent CLI is either authenticated on the host (e.g. `cline config`, `codex login`) or configured with a built-in free model (e.g. OpenCode with `opencode/muse-spark-1.3-contributor-free`).
- **No Interactive Blocking**: Workers dispatched in background/pane must not stall waiting for human confirmation on read/write/bash tools.
- **Windows / PowerShell Compatibility**: On Windows environments, ensure test commands and gate scripts use PowerShell syntax (`;` instead of `&`).
- **TUI Verification & Terminal Fallback**: Orca launches interactive terminals. If `orca orchestration worker-start` encounters hook timing or readiness stalls on Windows, use `orca terminal create --worktree active --title "<Role>" --command "<cmd>"` and interact via `orca terminal send` / `orca terminal read`.

