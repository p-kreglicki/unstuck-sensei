---
status: complete
priority: p2
issue_id: "011"
tags: [code-review, rust, detection, quality]
dependencies: []
---

# Reduce Detection Command Lock Boilerplate

## Problem Statement

The detection commands repeat the same lock-acquisition and poison-error mapping logic in every handler. This is low-signal duplication in a small module and makes command code harder to scan than necessary.

## Findings

**Source:** Pattern Recognition, Architecture Strategist. Narrowed after review.

- Location: `src-tauri/src/commands.rs` (five repeated `.lock().map_err(...)` blocks)
- The duplication is certain and immediate.
- The poisoning policy concern is real but belongs in a separate design todo because it implies a runtime behavior decision, not just a refactor.

## Proposed Solutions

### Option A: Extract a shared lock helper (Recommended)
- Add a small helper such as `with_detection_state` or `lock_detection_state` in `commands.rs`
- Keep `std::sync::Mutex` and current error behavior unchanged
- **Pros:** Removes duplication with minimal behavioral risk
- **Cons:** Does not address poisoning policy by itself
- **Effort:** Small
- **Risk:** Low

### Option B: Leave as-is until larger state refactor
- **Pros:** No code change now
- **Cons:** Duplication remains and muddies command intent
- **Effort:** None
- **Risk:** Low

## Acceptance Criteria

- [x] Lock acquisition logic exists in one place
- [x] All detection commands use the shared helper
- [x] Current command behavior and error string remain unchanged

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from PR #3 code review | Multiple agents flagged this independently |
| 2026-03-15 | Narrowed scope after review | Boilerplate cleanup is implementation-ready now; poisoning policy needs its own todo tied to the Phase 2B runtime model. |
| 2026-03-15 | Extracted shared lock helper in `commands.rs` | The duplication can be removed cleanly without changing mutex type or lock failure policy. |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/3
