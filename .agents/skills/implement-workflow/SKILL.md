---
name: implement-workflow
description: "Autonomous multi-agent implementation workflow powered by Orca CLI: orchestrates a TDD Coder worker and an independent Reviewer worker via Orca Orchestration in a feedback loop, auto-committing on pass and escalating to the human only when stuck. Assumes specs/docs were already prepared via /grill-with-docs."
---

# /implement-workflow — Autonomous Multi-Agent Delivery via Orca CLI

An autonomous engineering protocol that orchestrates two dedicated AI agent sessions using **Orca Orchestration** (`orca orchestration`):
1. **Coder Worker**: Implements features test-first using vertical slices at pre-agreed public seams (`/tdd`).
2. **Deterministic Gatekeeper**: Orchestrator independently verifies typecheck and targeted test gates before calling the Reviewer.
3. **Reviewer Worker**: Audits the diff independently in a fresh worker session (Standards, Spec faithfulness, Security & Performance).
4. **Orchestrator Feedback Loop**: Dispatches remediation passes to the Coder until the Reviewer confirms `PASS` (tracked up to 3 iterations).
5. **Stuck Escalation**: Pauses immediately to consult the human whenever an unresolvable contradiction or external blocker occurs.
6. **Auto-Commit**: Automatically runs full test suite and creates a structured git commit on the feature branch upon final approval.

> **Precondition**: Specification, domain terminology, and architecture decisions are assumed to be established already by the human (e.g. via `/grill-with-docs`, which records `CONTEXT.md`, ADRs, and spec/ticket files).

```
 [Human runs /grill-with-docs: produces spec, CONTEXT.md, ADRs]
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                ORCHESTRATOR (Control Session)               │
 │ 1. Preflight Orca runtime & Git Safety (clean baseline)     │
 │ 2. Create Feature Branch if on default branch               │
 │ 3. Pin public seams & Owned Paths (scope isolation)         │
 │ 4. Create Orca Run & Task (`run-create`, `task-create`)     │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼ orca orchestration worker-start
 ┌─────────────────────────────────────────────────────────────┐
 │              CODER WORKER (Orca Supervised TUI)             │
 │ • Works in vertical slices at public seams                  │
 │ • Red (failing test at seam) ──► Green (minimal code)       │
 │ • Runs single test file regularly & typecheck regularly     │
 │ • Sends `worker_done` when green                            │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │          DETERMINISTIC GATEKEEPER (Orchestrator Check)      │
 │ • Orchestrator independently runs typecheck & targeted test │
 │ • If FAIL: Bounce back to Coder (saves Reviewer tokens)     │
 │ • If PASS: Proceed to Reviewer                              │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼ orca orchestration worker-start
 ┌─────────────────────────────────────────────────────────────┐
 │             REVIEWER WORKER (Fresh Clean Session)           │
 │ • Audits `git diff $BASE_REF...HEAD`                        │
 │ • Evaluates Standards, Spec faithfulness, Security & Perf   │
 │ • Sends verdict to Orchestrator: PASS | CHANGES_REQUESTED | STUCK     │
 └──────────────────────────────┬──────────────────────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
[CHANGES_REQUESTED]                                  [STUCK]
• Orchestrator writes Fix Brief                         • Orchestrator PAUSES
• Tracks iteration [X/3]                                • Asks human for decision
• Dispatches Coder remediation                          • Resumes once unblocked
• Re-dispatches Reviewer on updated diff                │
        │                                               │
        └─────────────────► [PASS] ◄────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                   AUTOMATED RELEASE & COMMIT                │
 │ • Run FULL project test suite once (regression check)       │
 │ • Auto `git commit` owned paths to feature branch           │
 │ • Release worker panes (`worker-release`)                   │
 │ • Print final completion summary to human                   │
 └─────────────────────────────────────────────────────────────┘
```

---

## Detailed Process

### Phase 1: Pre-flight, Git Safety & Task Framing

1. **Verify Orca Runtime**:
   ```bash
   orca status --json
   orca orchestration run-list --json
   ```
   If Orca is unreachable, run `orca open --json` or prompt the user to start Orca.

2. **Git Workspace Safety & Clean Baseline**:
   - Run `git status --porcelain`.
   - **Dirty Tree Protection**: If uncommitted changes exist outside the planned feature scope, notify the user or prompt to stash/commit them before proceeding to prevent mixing uncommitted work with the new feature.
   - **Branch Isolation**: Check current git branch (`git branch --show-current`). If currently on default branch (`main`, `master`, `develop`), create and switch to a dedicated feature branch:
     ```bash
     git checkout -b feature/<issueId>-<short-slug>
     ```
   - Record `BASE_REF = HEAD`.

3. **Resolve Issue / Spec Target (Issue Number First)**:
   The primary invocation is passing the issue number: `/implement-workflow 123` (or `#123` / `ENG-123`):
   - **GitHub Issue (`#123` / `123`)**: Fetch title, body, and comments via `gh issue view <number> --json title,body,comments`.
   - **GitLab Issue (`!123` / `123`)**: Fetch via `glab issue view <number>`.
   - **Linear Ticket (`ENG-123`)**: Fetch via `orca linear issue <key> --comments --full --json`.
   - **Local Markdown Tracker**: Search `.scratch/**/issues/*<number>*.md` for matching ticket file.
   - **File Path fallback**: If a path like `docs/specs/*.md` is passed, read that file directly.
   - **No Argument**: Check current git branch name for an embedded issue number, or prompt the user.

4. **Establish Context, Roles, Seams & Owned Paths**:
   - Read `AGENTS.md` to resolve the Coder and Reviewer agent pins (e.g. `claude`, `opencode`, `cline`) and verification gate commands (Typecheck & Test). If `AGENTS.md` is missing or unconfigured, tell the user to run `/setup-implement-workflow`.
   - Read `CONTEXT.md` for domain vocabulary and existing ADRs.
   - Read `CODING_STANDARDS.md` or repo conventions.
   - **Pin public seams**: Identify the public interfaces/modules where new tests will reside. *Rule*: Never write tests against internal private helpers.
   - **Pin Owned Paths (Scope Fence)**: Explicitly list the directories and files allowed to be created or mutated. Forbid touching global infrastructure files (`package.json`, `.gitignore`, `tsconfig.json`, lockfiles) unless explicitly required by the spec.

5. **Initialize Orca Orchestration**:
   ```bash
   orca orchestration run-create --objective "Implement Issue #<id>: <title>" --json
   orca orchestration task-create --task-title "Issue #<id>: <title>" --spec "<issue-body-summary>" --json
   ```

---

### Phase 2: Dispatch Coder Worker (TDD Implementation)

1. **Prepare Coder Prompt**:
   Use `templates/coder-prompt.template.md` as the authoritative structure. Render it with task-specific variables into an untracked file inside the worktree (e.g. `.scratch/coder-prompt.md`) to prevent shell argument escaping issues:
   - Include spec path, agreed public seams, and owned paths.
   - Instruct Coder to follow `/tdd` and `/implement` rules:
     - **Red before Green**: Write failing test at public seam first.
     - **Vertical slices**: One tracer bullet at a time. No horizontal slicing.
     - **Minimal code**: Write only enough code to turn the test green.
     - **Inner Loop Testing**: Run typecheck regularly and run **only the single test file** for the active seam during development (e.g. `npx vitest run path/to/feature.test.ts`). **Do NOT run the full test suite** in the inner loop.
     - **Path Constraint**: Touch only contract-owned paths.
     - **Handoff**: Send `worker_done` via Orca CLI when green:
       ```bash
       orca orchestration send --type worker_done --outcome succeeded \
         --task-id <taskId> --dispatch-id <dispatchId> \
         --subject "TDD implementation complete" \
         --body "Tests green at seams: <list of seams>" --json
       ```

2. **Launch Worker via Orca**:
   Launch with the agent resolved from `AGENTS.md` (consult `references/harness-matrix.md` for agent ID and permission defaults):
   - **Case A: Active Session In-Place Execution (Recommended when Coder is `antigravity`)**:
     If the current orchestrator session is already Antigravity and `antigravity` is designated as Coder, execute the vertical-slice TDD implementation directly in-session (write failing test at seam -> implement minimal code -> verify green & typecheck), then proceed directly to Phase 3/4.
   - **Case B: Orca Worker Dispatch**:
     ```bash
     orca orchestration worker-start --task <taskId> --worktree current \
       --agent <coderAgent> [--model <modelId>] --json
     ```
     *Note for OpenCode*: OpenCode includes free Zen models (use `--model opencode/muse-spark-1.3-contributor-free`), zero external login required.
   - **Case C: Interactive Terminal Fallback (Windows)**:
     If `worker-start` encounters readiness or timing issues on Windows cmd:
     ```bash
     orca terminal create --worktree active --title "CODER WORKER" --command "<coderAgent> [flags]"
     orca terminal send --terminal <handle> --text "<prompt-text-or-reference>" --enter
     ```

3. **Await Coder Completion**:
   ```bash
   orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
   orca orchestration check --ack <deliveryId> --json
   ```
   *Note*: If the worker hangs or exceeds timeout without reporting, fence and terminate it via `orca orchestration worker-stop --dispatch <coderDispatchId> --json` before escalating. (Or inspect terminal via `orca terminal read --terminal <handle> --limit 50 --json`).

---

### Phase 3: Deterministic Gatekeeper (Orchestrator Pre-check)

Before spending tokens to dispatch the Reviewer:
1. **Run Verification Gates Independently**:
   Orchestrator executes the project verification gates recorded in `AGENTS.md`:
   - Typecheck command (e.g. `npm run typecheck` or `tsc --noEmit`).
   - Targeted test command for the modified seam.
2. **Evaluate Gate Result**:
   - **If gates FAIL**: Do NOT dispatch Reviewer. Immediately generate a compiler/test error fix brief and restart the Coder:
     ```bash
     orca orchestration worker-start --task <taskId> --retry-of <coderDispatchId> --agent <coderAgent> --worktree current --json
     ```
   - **If gates PASS**: Proceed to Phase 4 (Dispatch Reviewer).

---

### Phase 4: Dispatch Reviewer Worker (Independent Audit)

1. **Prepare Reviewer Prompt**:
   Use `templates/reviewer-prompt.template.md` as the authoritative structure. Render it into an untracked file (e.g. `.scratch/reviewer-prompt.md`):
   - Command to inspect: `git diff $BASE_REF...HEAD`
   - Evaluate across three independent axes:
     - **Axis 1 (Standards)**: Repo rules + Fowler smell baseline from `/code-review` (*Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man*).
     - **Axis 2 (Spec Faithfulness)**: Missing requirements, unasked behavior (*scope creep*), or implementation mismatches with `CONTEXT.md`.
     - **Axis 3 (Security & Performance)**: Injections, unvalidated inputs, auth bypass, secret leaks, N+1 queries, memory/resource leaks.
   - Reviewer must output a structured verdict:
     - `PASS`: Clean, ready to ship.
     - `CHANGES_REQUESTED`: Concrete list of `{ file, line, issue, fix_guidance, severity: "blocker" | "warning" }`.
     - `STUCK`: Ambiguity in spec, conflicting requirements, or external blocker. (Send via `--type escalation` to immediately alert Orchestrator).

2. **Launch Fresh Reviewer via Orca**:
   Launch in a fresh session with the agent resolved from `AGENTS.md` (consult `references/harness-matrix.md` for agent ID and permission defaults):
   - **Option A: Orca Worker Dispatch**:
     ```bash
     orca orchestration worker-start --task <taskId> --worktree current \
       --agent <reviewerAgent> [--model <modelId>] --json
     ```
     *Note for OpenCode*: Pass `--model opencode/muse-spark-1.3-contributor-free` to use the built-in free model without credentials.
   - **Option B: Direct Interactive Terminal Dispatch (Rock-Solid Fallback)**:
     ```bash
     orca terminal create --worktree active --title "REVIEWER (<reviewerAgent>)" --command "opencode -m opencode/muse-spark-1.3-contributor-free" --json
     orca terminal send --terminal <handle> --text "Audit staged git diff for Issue #<id>. Read .scratch/reviewer-prompt.md for instructions and output your review verdict (PASS, CHANGES_REQUESTED, or STUCK)." --enter --json
     ```

3. **Await Reviewer Verdict**:
   - For Orca worker dispatch:
     ```bash
     orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
     orca orchestration check --ack <deliveryId> --json
     ```
   - For interactive terminal dispatch: Monitor terminal output using:
     ```bash
     orca terminal read --terminal <handle> --limit 50 --json
     ```
     Once OpenCode outputs `## REVIEW VERDICT: [PASS | CHANGES_REQUESTED | STUCK]`, capture the verdict and close the terminal:
     ```bash
     orca terminal close --terminal <handle> --json
     ```


---

### Phase 5: Feedback Loop & Auto-Fix (Iteration Tracking)

Track the review cycle count: `iteration = 1` (Max: 3 iterations).
Write current progress to `.scratch/run-summary.md` for live observability.

- **Case A: Reviewer returns `PASS`**:
  Proceed directly to Phase 7 (Automated Release).

- **Case B: Reviewer returns `CHANGES_REQUESTED`**:
  - Filter for `blocker` and critical `warning` items.
  - Increment iteration count (`iteration++`).
  - If `iteration > 3`: Transition to Phase 6 (Escalation When Stuck).
  - Use `templates/fix-brief.template.md` to render a focused **Fix Brief** into `.scratch/fix-brief.md`.
  - Dispatch Coder for remediation:
    ```bash
    orca orchestration worker-start --task <taskId> --retry-of <coderDispatchId> --agent <coderAgent> --worktree current --json
    ```
  - Coder applies fixes test-first and verifies locally.
  - Orchestrator runs Phase 3 Deterministic Gatekeeper again.
  - Once green, Orchestrator re-dispatches Reviewer on the updated diff.

---

### Phase 6: Escalation When Stuck ("Hỏi khi bị kẹt")

The Orchestrator **MUST PAUSE IMMEDIATELY** and ask the human if:
1. Reviewer or Coder returns `STUCK`.
2. A contradiction in requirements or missing external dependency is uncovered.
3. Remediation cycles exceed 3 iterations without convergence (cyclic oscillation).

**Escalation Format:**
- State the exact blocking problem clearly.
- Quote the specific file, line, failing test, or conflicting spec section.
- Provide 2–3 actionable choices or ask the specific clarifying question.
- **Wait for the human's response** before resuming worker dispatches.

---

### Phase 7: Automated Release & Commit

Once the Reviewer returns `PASS`:

1. **Full Test Suite Verification**:
   Run the project's **full test suite** and typechecker once across the entire repository to verify that no regressions were introduced.

2. **Automated Git Commit**:
   Commit only contract-owned modified files to the feature branch:
   ```bash
   git add <owned-files>
   git commit -m "feat(<scope>): <feature-description> (closes #<issueId>)"
   ```

3. **Cleanup Orca Resources**:
   Release finished worker terminals (archives logs and closes panes):
   ```bash
   orca orchestration worker-release --dispatch <coderDispatchId> --json
   orca orchestration worker-release --dispatch <reviewerDispatchId> --json
   ```
   Remove temporary scratch files (`.scratch/*-prompt.md`, `.scratch/fix-brief.md`).

4. **Print Completion Summary**:
   Present a clear summary report to the user:
   - **Feature**: Name & spec link.
   - **Branch**: Feature branch name.
   - **Seams Tested**: Public boundaries verified.
   - **Review Verdict**: Approved across Standards, Spec, Security & Performance.
   - **Commit**: Hash and message.
   - **Iterations**: Total Coder/Reviewer cycles completed.
