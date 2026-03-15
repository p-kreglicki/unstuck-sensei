---
status: complete
priority: p3
issue_id: "019"
tags: [code-review, performance]
dependencies: []
---

# Unbounded `app_switches` VecDeque Growth

## Problem Statement

`record_app_switch` pushes to `app_switches` VecDeque with no eviction of old entries. The deque is only cleared on wake, disable, or sign-out. During a multi-hour session without sleep, the deque grows without bound.

This is a real follow-up risk but **not a regression against Phase 2B scope**. The phase plan explicitly assigns stale-event pruning to Phase 2C (plan line 401: "Prune events older than 5 minutes from `VecDeque`"). Phase 2B only collects inputs; Phase 2C evaluates and prunes them.

Memory impact is modest at human interaction rates (~77 KB/8hr day at aggressive switching). The count becoming a lifetime total rather than windowed is intentional for now — windowed semantics arrive with the Phase 2C evaluator.

## Findings

- **Performance agent**: At 1 switch/3s, ~9,600 entries/8hr day. Bounded memory growth, but count reflects lifetime total.
- **Security agent**: Theoretical local memory concern. Corroborates.
- **Architecture agent**: Corroborates. Sliding window semantics expected but planned for Phase 2C.

**Location**: `src-tauri/src/detection/mod.rs:153` (`record_app_switch`)

## Proposed Solutions

### Option A: Time-based eviction in Phase 2C evaluator (Recommended)
Add a `retain_recent` method called from the evaluator tick (already planned):
```rust
fn retain_recent(&mut self, window: Duration) {
    let cutoff = Instant::now() - window;
    while self.app_switches.front().is_some_and(|t| *t < cutoff) {
        self.app_switches.pop_front();
    }
}
```
- **Pros**: Aligns with plan, correct semantics
- **Cons**: Deque unbounded until Phase 2C ships
- **Effort**: Small
- **Risk**: Low

## Recommended Action
Complete. Phase 2C shipped the planned pruning logic in `DetectionState::prune_app_switches`, and both `record_app_switch_at` and `update_idle_seconds_at` now enforce the sliding window.

## Technical Details
- **Affected files**: `src-tauri/src/detection/mod.rs`
- **Components**: DetectionState

## Acceptance Criteria
- [x] App switches older than the detection window are evicted
- [x] `app_switch_count()` returns the count within the window only
- [x] VecDeque memory is bounded over long sessions
- [x] Tests cover eviction behavior

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from PR #4 code review | Multiple agents flagged this independently |
| 2026-03-15 | Downgraded P1→P3 | Pruning is explicitly planned for Phase 2C (plan line 401). Not a regression against Phase 2B scope. |
| 2026-03-15 | Validity check after PR #5: completed | `src-tauri/src/detection/mod.rs` now prunes stale app switches on record and idle tick, and includes `idle_tick_prunes_stale_switches_before_evaluating` coverage |

## Resources
- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/4
- Plan: docs/plans/2026-03-15-feat-stuck-detection-engine-phase-2-plan.md (line 401)
