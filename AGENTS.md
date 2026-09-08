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
| **coder** | `opencode` (hoặc `antigravity`) | `opencode/muse-spark-1.3-contributor-free` (hoặc `agy`) via Orca Terminal | TDD implementation at public seams |
| **reviewer** | `opencode` | `opencode/muse-spark-1.3-contributor-free` via Orca Terminal | Independent audit (Standards, Spec, Security & Perf) |

### Verification Gates
- **Typecheck**: `npm run typecheck`
- **Test Suite**: `npm test`

### OpenCode Configuration (Free Zen Model)
- **Model**: `opencode/muse-spark-1.3-contributor-free` (hoạt động miễn phí, không cần đăng nhập/API key).
- **Invocation**: Khởi chạy với cờ `-m opencode/muse-spark-1.3-contributor-free`.

### Orca Orchestration Protocol (Windows)
Quy trình điều phối đa tác nhân độc lập qua Orca Terminal trên Windows:

1. **Coder Dispatch via Orca Terminal**:
   - Orchestrator chuẩn bị prompt TDD (Red -> Green -> Refactor) tại `.scratch/coder-prompt.md`.
   - Tạo terminal mới cho Coder worker:
     ```bash
     orca terminal create --command "opencode -m opencode/muse-spark-1.3-contributor-free"
     # hoặc nếu dùng agy: orca terminal create --command "agy --dangerously-skip-permissions"
     ```
   - Gửi chỉ dẫn TDD cho Coder:
     ```bash
     orca terminal send --terminal <coder_terminal_id> --text "<chỉ_dẫn_tdd_hoặc_đọc_.scratch/coder-prompt.md>" --enter
     ```
   - Theo dõi tiến độ Coder bằng `orca terminal read --terminal <coder_terminal_id>` cho đến khi test và typecheck hoàn tất.
   - Đóng terminal Coder:
     ```bash
     orca terminal close --terminal <coder_terminal_id>
     ```

2. **Deterministic Gatekeeper (Orchestrator)**:
   - Orchestrator độc lập chạy verification gates trên workspace:
     ```bash
     npm run typecheck
     npm test
     ```
   - Nếu gates PASS, tiến hành dispatch Reviewer. Nếu FAIL, gửi fix brief cho Coder.

3. **Reviewer Dispatch via Orca Terminal**:
   - Tạo terminal mới riêng biệt cho Reviewer worker:
     ```bash
     orca terminal create --command "opencode -m opencode/muse-spark-1.3-contributor-free"
     ```
   - Gửi yêu cầu review diff và audit:
     ```bash
     orca terminal send --terminal <reviewer_terminal_id> --text "<review instructions>" --enter
     ```
   - Đọc kết quả verdict qua `orca terminal read --terminal <reviewer_terminal_id>`.
   - Đóng terminal Reviewer:
     ```bash
     orca terminal close --terminal <reviewer_terminal_id>
     ```

4. **Review Verdict Contract**:
   Reviewer độc lập bắt buộc trả về một trong các verdict:
   - `## REVIEW VERDICT: PASS`
   - `## REVIEW VERDICT: CHANGES_REQUESTED`
   - `## REVIEW VERDICT: STUCK`

