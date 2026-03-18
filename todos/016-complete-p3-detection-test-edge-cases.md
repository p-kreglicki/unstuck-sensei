---
status: complete
priority: p3
issue_id: "016"
tags: [code-review, rust, detection, testing]
dependencies: []
---

# Detection State Machine Test Edge Cases

## Problem Statement

The 7 existing tests cover the primary paths well, but several edge cases identified across review agents are not explicitly tested.

## Findings

**Source:** Architecture Strategist, Security Sentinel (commit f56161c review)

Missing tests:
1. **`resume()` when signed_in/enabled are false** — The `Paused → Disabled` branch (line 135) is untested. Covers the edge case where config changed while paused.
2. **Double-pause is idempotent** — `pause()` on `Paused` should be a no-op. Code handles this but no test asserts it.
3. **`sync_config` preserves timer values** — `sync_config_preserves_runtime_states_when_reenabled` sets `pause_remaining` and `cooldown_remaining` but only asserts `status` and `sensitivity`. Should also assert timer values are untouched.
4. **Stale `cooldown_remaining` after Cooldown→Paused→Active** — When `pause()` from Cooldown, `cooldown_remaining` is not cleared. After `resume()`, stale value persists. Phase 2B tick loop should handle this, but a test documenting the behavior would be valuable.

## Proposed Solutions

Add 3-4 small test cases. ~30 lines total.
- **Effort:** Small
- **Risk:** None

## Acceptance Criteria

- [x] `resume()` from Paused with signed_in=false → Disabled is tested
- [x] Double-pause is tested as no-op
- [x] Timer preservation through sync_config is explicitly asserted

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from commit f56161c review | — |
| 2026-03-18 | Added detection state-machine edge-case coverage | Added tests for paused-to-disabled resume when config changed, idempotent pause, explicit timer preservation on re-enable, cooldown timer persistence through pause/resume, and best-effort runtime effect execution. Validated with `cargo test --manifest-path src-tauri/Cargo.toml detection::`. |

## Resources

- Commit: f56161c
