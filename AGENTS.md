# Agent Guidelines

## Agent skills

### Issue tracker

Issues and specs are tracked on GitHub via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles mapped to repository issue labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout with `CONTEXT.md` and `docs/adr/` at the repository root. See `docs/agents/domain.md`.

### Memory system

Persistent cross-session memory is stored in `.agents/memory/`. At session start, check `.agents/memory/MEMORY.md` to load user preferences, project conventions, and past decisions. See `.agents/skills/memory-system/SKILL.md`.
To save new persistent memories, follow the `/remember` workflow defined at `.agents/workflows/remember.md`.

## Implement Workflow Configuration

| Phase / Role | Harness / Agent | Model / Execution | Responsibility |
| :--- | :--- | :--- | :--- |
| **coder** | `antigravity` | In-Session / Native | TDD implementation at public seams |
| **reviewer** | `opencode` | `opencode/muse-spark-1.3-contributor-free` | Independent audit (Standards, Spec, Security & Perf) |

### Verification Gates
- **Typecheck**: `npm run typecheck`
- **Test Suite**: `npm test`

### OpenCode Reviewer Configuration
- **Model**: Must use `opencode/muse-spark-1.3-contributor-free` (free Zen model).
- **Authentication**: No login or API keys required (no `auth.json` needed).
- **Invocation**: Pass `-m opencode/muse-spark-1.3-contributor-free` when starting opencode.

### Orca Orchestration Protocol (Windows)
When orchestrating multi-agent tasks on Windows via Orca:
1. **Coder Execution**:
   - `antigravity` executes TDD steps directly in-session (Red -> Green -> Refactor) to avoid nested readiness probe timeouts.
2. **Reviewer Dispatch via Orca Terminal**:
   - To avoid Windows PTY / hook timeouts with `orca orchestration worker-start`, use Orca terminal commands:
     ```bash
     # 1. Create interactive terminal with OpenCode and free model
     orca terminal create --command "opencode -m opencode/muse-spark-1.3-contributor-free"
     
     # 2. Dispatch prompt & inspect diff
     orca terminal send --terminal <terminal_id> --text "<review instructions>" --enter
     
     # 3. Read output to check verdict
     orca terminal read --terminal <terminal_id>
     
     # 4. Clean up terminal upon completion
     orca terminal close --terminal <terminal_id>
     ```
3. **Review Verdict Contract**:
   The independent reviewer must output one of:
   - `## REVIEW VERDICT: PASS`
   - `## REVIEW VERDICT: CHANGES_REQUESTED`
   - `## REVIEW VERDICT: STUCK`
