# Fix Brief — Remediation Pass [Iteration {{ITERATION}}/3]

The Reviewer Worker has completed an independent audit and requested the following fixes before approval.

---

## Target Remediation Items

### 1. Blocker Issues (Must Fix)
{{BLOCKER_ITEMS}}

### 2. Critical Warnings (Should Fix)
{{WARNING_ITEMS}}

---

## Remediation Rules
1. **Root-Cause Fix**: Fix the underlying defect directly. Do not mask issues by deleting tests or weakening assertions.
2. **Test-First Verification**: Verify the fix turns the affected test green.
3. **Preserve Owned Scope**: Do not touch code unrelated to these findings.
4. **Local Verification**: Verify targeted test and typecheck pass locally before reporting.
5. **Handoff**: Send `worker_done` via Orca CLI once remediation is complete:

```bash
orca orchestration send --type worker_done --outcome succeeded \
  --task-id {{TASK_ID}} --dispatch-id {{DISPATCH_ID}} \
  --subject "Remediation iteration {{ITERATION}} complete" \
  --body "Addressed blocker and warning items" --json
```
