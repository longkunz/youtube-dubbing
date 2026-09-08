---
name: setup-implement-workflow
description: "Interactive setup skill for /implement-workflow: preflights Orca CLI, auto-detects test/typecheck commands, guides agent role configuration (Coder, Reviewer e.g. claude, opencode, cline), and records configuration into AGENTS.md."
disable-model-invocation: true
---

# Setup Implement Workflow

Interactive setup skill for `/implement-workflow`:
1. **Discovers all available agents** currently installed or authenticated on the system (via Orca CLI and system PATH, e.g. `claude`, `opencode`, `cline`, `codex`, `cursor`, `agy`).
2. **Presents an interactive menu** for the user to select their desired Coder and Reviewer agent pairing (omitting model and effort configurations).
3. **Auto-detects project verification gates** (typecheck and test commands).
4. **Records the user's explicit choices** into `AGENTS.md`.

---

## Process

### 1. Discover Active Agents & Runtimes

1. **Probe Installed Agent CLIs (Cross-Shell)**:
   - **PowerShell (Windows)**:
     ```powershell
     Get-Command claude, opencode, cline, codex, cursor, agy -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
     ```
   - **Bash (Linux/macOS)**:
     ```bash
     for cmd in claude opencode cline codex cursor agy; do command -v "$cmd" && echo "$cmd"; done
     ```
   Compile the list of **Actually Available Agents** (e.g. `[claude, opencode, cline, codex, cursor, agy]`).
   *Note*: If `agy` is selected, normalize its Orca agent identity to `antigravity` when recording to `AGENTS.md`.

2. **Check Project Verification Gates**:
   Inspect `package.json`, `tsconfig.json`, `Cargo.toml`, `pyproject.toml`, etc., to identify the test command (`npm test`, `vitest`, `pytest`) and typecheck command (`tsc --noEmit`, `mypy`).

---

### 2. Present Discovered Agents

Display the list of discovered agents found on the system (e.g., `claude`, `opencode`, `cline`, `codex`, `cursor`, `gemini`, `agy`).

---

### 3. Interactive User Selection

Prompt the user to select their desired agent pairing step-by-step:

#### Step A: Configure CODER Role
1. **Choose Agent**: Present the list of detected agents for the user to pick:
   > "Các Agent khả dụng trên máy của bạn: [1] claude, [2] opencode, [3] cline, [4] codex, [5] cursor... Bạn chọn Agent nào làm CODER?"

#### Step B: Configure REVIEWER Role
1. **Choose Agent**: Present the list of detected agents:
   > "Bạn chọn Agent nào làm REVIEWER? [1] claude, [2] opencode, [3] cline, [4] codex, [5] cursor..."

#### Step C: Confirm Verification Gates
Show the detected test and typecheck commands and ask if the user wants to adjust them.

---

### 4. Write Choices to `AGENTS.md`

Format the user's explicit selections into `AGENTS.md`:

```markdown
## Implement Workflow Configuration

| Phase / Role | Harness / Agent | Responsibility |
| :--- | :--- | :--- |
| **coder** | `<selected-coder-agent>` | TDD implementation at public seams |
| **reviewer** | `<selected-reviewer-agent>` | Independent audit (Standards, Spec, Security & Perf) |

### Verification Gates
- **Typecheck**: `<confirmed-typecheck-cmd>`
- **Test Suite**: `<confirmed-test-cmd>`
```

- If `AGENTS.md` already exists, update/replace only the `## Implement Workflow Configuration` section and preserve everything else.
- If `AGENTS.md` does not exist, create it with this block.

---

### 5. Final Confirmation

Print a summary showing:
- Configured Coder: `<agent>`
- Configured Reviewer: `<agent>`
- Verification Gates: `<typecheck>`, `<test>`
- Saved in `AGENTS.md`.
- Next action: You can now run `/implement-workflow <issue-number>`.

