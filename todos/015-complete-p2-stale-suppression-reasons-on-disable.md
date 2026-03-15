---
status: complete
priority: p2
issue_id: "015"
tags: [code-review, rust, detection, architecture]
dependencies: []
---

# Stale Suppression Reasons After Disable

## Problem Statement

When `sync_config` is called with `signed_in: true, enabled: false` (user disables detection but stays signed in), the `disable()` helper clears transient state (switches, timers, nudge) but does **not** clear `suppression_reasons`. If the engine had `MeetingApp` or `AppForegrounded` reasons active, they persist. When the user later re-enables detection, `sync_config(true, true, ...)` transitions `Disabled → Active`, but stale suppression reasons remain in the set. Once Phase 2D adds suppression evaluation, the engine would never trigger while those stale reasons sit in the set.

## Findings

**Source:** Architecture Strategist (commit f56161c review)

- Location: `src-tauri/src/detection/mod.rs:152-158` (`disable()` method)
- The sign-out path correctly manages `SignedOut` reason (inserted at line 105-106 before `disable()` runs), but `disable()` itself does not touch the set.
- Non-`SignedOut` reasons (`MeetingApp`, `TimerRunning`, `AppForegrounded`) can survive a disable/re-enable cycle.

## Proposed Solutions

### Option A: Clear non-SignedOut reasons in disable() (Recommended)
```rust
fn disable(&mut self) {
    self.status = DetectionStatus::Disabled;
    self.app_switches.clear();
    self.cooldown_remaining = None;
    self.pause_remaining = None;
    self.last_stuck_detected_at = None;
    self.suppression_reasons.retain(|r| *r == SuppressionReason::SignedOut);
}
```
- **Pros:** Clean slate on disable, prevents stale reasons
- **Cons:** None
- **Effort:** Small
- **Risk:** None

### Option B: Clear non-SignedOut reasons on Disabled → Active transition
- **Pros:** Cleanup at the exact point it matters
- **Cons:** Easy to forget if more transitions are added
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [x] Disabling detection clears MeetingApp/TimerRunning/AppForegrounded from suppression_reasons
- [x] SignedOut suppression reason is preserved when appropriate
- [x] Test covers disable/re-enable cycle with stale suppression reasons

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from commit f56161c review | Must fix before Phase 2D adds suppression evaluation |
| 2026-03-15 | Cleared non-SignedOut suppression reasons in `disable()` and added regression tests | Disable must reset suppression state, but the sign-out path still needs to preserve `SignedOut` as the only surviving reason. |

## Resources

- Commit: f56161c
