---
status: complete
priority: p3
issue_id: "032"
tags: [code-review, rust, detection, quality]
dependencies: []
---

# Consolidate Duplicated Cleanup in disable()

## Problem Statement

`disable()` in `mod.rs:517-553` has two near-identical cleanup blocks: one for the already-disabled branch and one for the transitioning branch. Both clear the same fields (`app_switches`, timers, `last_stuck_detected_at`, suppression reasons). This creates a maintenance risk if one branch is updated but not the other.

## Proposed Solutions

### Option A: Single cleanup block with conditional emit

```rust
fn disable(&mut self, now: Instant) -> Vec<DetectionRuntimeEffect> {
    let was_active = self.status != DetectionStatus::Disabled;
    if was_active {
        self.status = DetectionStatus::Disabled;
    }
    // Single cleanup
    self.notification_remaining = None;
    self.cooldown_remaining = None;
    self.pause_remaining = None;
    self.app_switches.clear();
    self.last_foreground_bundle_id = None;
    self.last_stuck_detected_at = None;
    self.suppression_reasons.retain(|r| *r == SuppressionReason::SignedOut);

    if was_active {
        vec![DetectionRuntimeEffect::EmitStateChanged(self.status_response_at(now))]
    } else {
        Vec::new()
    }
}
```

- **Effort**: Small (~10 LOC removed)
- **Risk**: None

## Acceptance Criteria

- [x] Single cleanup path in `disable()`
- [x] All existing tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from PR #5 code review | Flagged by Pattern Recognition + Code Simplicity agents |
| 2026-03-15 | Validity review | Still valid: `disable()` keeps two near-identical cleanup paths, with only the state transition and conditional emit differing |
| 2026-03-18 | Consolidated `disable()` cleanup behind `clear_disabled_runtime_state()` | The emitted disabled payload still has to be generated after cleanup so `nudge_active` and timer fields are cleared correctly; validated with `cargo test --manifest-path src-tauri/Cargo.toml detection::`. |
