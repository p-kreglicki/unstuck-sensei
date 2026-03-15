---
status: complete
priority: p1
issue_id: "009"
tags: [code-review, rust, detection, architecture]
dependencies: []
---

# State Machine Transition Guards Missing

## Problem Statement

The `DetectionState` methods (`pause`, `resume`, `sync_config`) perform unconditional state transitions with no guards on current status. This allows invalid state sequences that will cause bugs when Phase 2B wires the detection loop and timers.

## Findings

**Source:** Architecture Strategist, Pattern Recognition Specialist. Validated against Phase 2 plan.

1. **`sync_config()` overwrites `Paused`/`Cooldown` state** — If user changes sensitivity in settings while paused, the engine jumps to `Active`, breaking the pause contract. The plan says `sync_detection_config` is called on any settings change (plan line 256-259), but only sign-out should force `Disabled` (plan line 85: "Any → Disabled"). Settings changes during Paused/Cooldown should update config fields without changing status.
   - Location: `src-tauri/src/detection/mod.rs:113-117`

2. **`resume()` can skip `Cooldown`** — Calling `resume_detection` from `Cooldown` or `Notifying` prematurely re-enables detection, bypassing the cooldown window. The plan (line 84) only defines resume from `Paused`.
   - Location: `src-tauri/src/detection/mod.rs:125-132`

3. **`pause()` is unguarded** — Calling `pause_detection` while `Disabled` puts the engine in `Paused`, which is an invalid transition per the plan (line 83: only Active → Paused, line 86: Cooldown → Paused). Note: the consequence is minor — `resume()` would correctly return to `Disabled` when `signed_in` is false — but the transition is still invalid per the state machine contract.
   - Location: `src-tauri/src/detection/mod.rs:120-123`

### Not a finding (corrected):

~~`dismiss_nudge()` should transition Notifying → Cooldown~~ — **Invalid.** Per the plan (line 78-79, line 109-118), `dismiss_nudge` is the in-app banner dismissal command. By the time the nudge banner is shown, the engine is already in Cooldown. The Notifying → Cooldown transition is triggered by notification expiry/dismissal (Phase 2C), not by `dismiss_nudge`. The current implementation (clearing `last_stuck_detected_at`) is correct.

## Proposed Solutions

### Option A: Add guards to each method (Recommended)
- `sync_config()`: When `signed_in && enabled` and engine is in `Paused`/`Cooldown`/`Suppressed`/`Notifying`, update config fields (sensitivity, enabled) but preserve current status. Only transition to `Active` from `Disabled`.
- `resume()`: Only allow from `Paused`; no-op otherwise.
- `pause()`: Only allow from `Active`, `Cooldown`, `Suppressed` (per plan lines 83, 86).
- **Pros:** Correct behavior, prevents invalid states, small diff
- **Cons:** None
- **Effort:** Small
- **Risk:** Low

### Option B: Return Result from state methods indicating whether transition happened
- Same guards as Option A but methods return `bool` or `Result` to inform caller
- **Pros:** Better error reporting to frontend
- **Cons:** Slightly more work
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A — fix the guards now before Phase 2B builds on top.

## Technical Details

- **Affected files:** `src-tauri/src/detection/mod.rs`
- **Components:** DetectionState methods: `sync_config`, `resume`, `pause`

## Acceptance Criteria

- [x] `sync_config()` preserves `Paused`/`Cooldown`/`Suppressed`/`Notifying` status when updating config
- [x] `sync_config()` transitions `Disabled` → `Active` when `signed_in && enabled`
- [x] `sync_config()` transitions any state → `Disabled` on sign-out or when detection is disabled in settings
- [x] `resume()` only transitions from `Paused`
- [x] `pause()` is a no-op when status is `Disabled` or `Notifying`
- [x] `dismiss_nudge()` remains unchanged (correctly clears nudge banner only)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from PR #3 code review | State machine needs guards before Phase 2B |
| 2026-03-15 | Corrected findings after plan validation | dismiss_nudge is for the banner, not the notification — current impl is correct. pause() consequence was overstated. |
| 2026-03-15 | Implemented guarded transitions and added Rust tests | `sync_config` must treat sign-out and disabled settings as the same disable path, while preserving runtime states for signed-in enabled reconfiguration. |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/3
- Plan: `docs/plans/2026-03-15-feat-stuck-detection-engine-phase-2-plan.md`
