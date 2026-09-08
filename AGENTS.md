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

| Phase / Role | Harness / Agent | Responsibility |
| :--- | :--- | :--- |
| **coder** | `antigravity` | TDD implementation at public seams |
| **reviewer** | `opencode` | Independent audit (Standards, Spec, Security & Perf) |

### Verification Gates
- **Typecheck**: `npm run typecheck`
- **Test Suite**: `npm test`



