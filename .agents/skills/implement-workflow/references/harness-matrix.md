# Harness & Agent Compatibility Matrix

Launch configurations and permission bypass postures for worker dispatch in `/implement-workflow` via Orca CLI (`orca orchestration worker-start`).

| Agent / CLI | Orca Agent ID | Permission Auto-Approve Flags | Execution Notes |
| :--- | :--- | :--- | :--- |
| **Claude Code** | `claude` | `--dangerously-skip-permissions` | Runs native Claude TUI; honors project instructions via `CLAUDE.md`. |
| **OpenCode** | `opencode` | auto-approved via CLI config | Requires at least one configured provider via `opencode providers login` beforehand (`auth.json`). |
| **Cline** | `cline` | `--auto-approve true` / Shift+Tab in TUI | Auto-approve all tools enabled; accepts messages via queue or interactive terminal. |
| **Codex CLI** | `codex` | `--dangerously-bypass-approvals-and-sandbox` | Headless/TUI worker; avoids sandbox approval interruptions. |
| **Cursor Agent** | `cursor` | `--force` | Runs Cursor agent worker. |
| **Antigravity CLI** | `antigravity` (or `agy`) | `--dangerously-skip-permissions` | Google Antigravity CLI session. |

## Launch Guidelines
- **Authentication Prerequisite**: Ensure the target agent CLI is logged in and authenticated on the host (e.g. `opencode providers list`, `cline config`) before dispatching via Orca.
- **No Interactive Blocking**: Workers dispatched in background/pane must not stall waiting for human confirmation on read/write/bash tools.
- **Windows / PowerShell Compatibility**: On Windows environments, ensure test commands and gate scripts use PowerShell syntax (`;` instead of `&`).
- **TUI Verification**: Orca launches interactive terminals. Do not use raw headless one-shot invocations like `claude -p` or `agy -p` directly for long-running workflows.
