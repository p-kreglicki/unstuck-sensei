---
status: complete
priority: p3
issue_id: "030"
tags: [code-review, rust, detection, architecture, reliability]
dependencies: []
---

# Effect Execution Resilience

## Problem Statement

`execute_runtime_effects()` in `detection/mod.rs:626-646` uses `?` to short-circuit on the first failed effect. If `SendNotification` fails, the subsequent `EmitStateChanged` event never fires even though the Rust state machine has already transitioned.

This is a real resilience gap. `execute_runtime_effects()` still short-circuits on the first failed effect, so a failed notification can prevent a later `EmitStateChanged` from firing even though the Rust state machine already transitioned. That can now matter to the frontend because the current React detection provider listens for `detection-state-changed`.

## Findings

- **Validated 2026-03-15**: The fail-fast `?` behavior is real. `transition()` for `Active -> Notifying` produces `SendNotification` before `EmitStateChanged`, and `execute_runtime_effects()` stops on the first error.
- **Validated 2026-03-17**: The frontend now does listen for `detection-state-changed` in `src/hooks/useDetection.tsx`, so dropped emits are no longer just a theoretical future concern.

**Evidence**:
- `src-tauri/src/detection/mod.rs:580-583` orders `SendNotification` before `EmitStateChanged`
- `src-tauri/src/detection/mod.rs:632-641` short-circuits on the first effect error
- `src/hooks/useDetection.tsx` subscribes to `detection-state-changed` and applies event payloads into React state

## Proposed Solutions

### Option A: Best-effort execution with error collection
Execute all effects, collect errors, return the first (or all) after completion.

```rust
pub fn execute_runtime_effects(app: &AppHandle<Wry>, effects: Vec<DetectionRuntimeEffect>) -> Result<(), String> {
    let mut first_error: Option<String> = None;
    for effect in effects {
        let result = match effect {
            DetectionRuntimeEffect::SendNotification => { /* ... */ }
            DetectionRuntimeEffect::EmitStateChanged(payload) => { /* ... */ }
        };
        if let Err(e) = result {
            if first_error.is_none() { first_error = Some(e); }
        }
    }
    first_error.map_or(Ok(()), Err)
}
```

- **Pros**: State-change emission is not blocked by unrelated notification failures
- **Cons**: Slightly more code; callers still see an error for the notification failure
- **Effort**: Small
- **Risk**: Low

### Option B: Separate notification errors from state-sync errors
Always emit state changes; only log notification failures.

- **Pros**: Simplest behavior; preserves state propagation if listeners are added later
- **Cons**: Notification failures become silent (only logged)
- **Effort**: Small
- **Risk**: Low

## Recommended Action

Keep as a follow-up, but downgrade priority. This is a legitimate robustness improvement for the detection runtime, not a confirmed current frontend desynchronization bug.

## Technical Details

- **Affected files**: `src-tauri/src/detection/mod.rs` (execute_runtime_effects)
- **Affected components**: Detection state sync, notification delivery
- **Database changes**: None

## Acceptance Criteria

- [x] If `SendNotification` fails, `EmitStateChanged` still fires
- [x] Notification errors are logged or surfaced without blocking later effects
- [x] Existing tests continue to pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from PR #5 code review | Architecture + Security agents both flagged this |
| 2026-03-15 | Validity review | The effect-coupling bug is real, but the current app has no frontend subscriber for `detection-state-changed`, so the todo should describe this as a latent resilience issue rather than a proven UI sync bug |
| 2026-03-17 | Reevaluated against current frontend | The prior "no subscriber" caveat is stale. `useDetection.tsx` now consumes `detection-state-changed`, so failed notification effects can suppress a real frontend state update path. |
| 2026-03-18 | Implemented best-effort runtime effect execution | `execute_runtime_effects()` now runs every queued effect, logs failures, returns the first error after completion, and `execute_detection_effects()` still syncs the tray when state-change effects were queued. Validated with `cargo test --manifest-path src-tauri/Cargo.toml detection::`. |

## Resources

- PR: #5
- File: `src-tauri/src/detection/mod.rs:626-646`
