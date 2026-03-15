---
status: complete
priority: p2
issue_id: "029"
tags: [code-review, quality]
dependencies: []
---

# Duplicated invoke_handler in lib.rs

## Problem Statement

`lib.rs` (lines 89-106) duplicates the entire 5-command registration list in two `#[cfg]`-gated blocks, differing only by the presence of `get_detection_debug`. Every new command must be added in two places, and a missed update silently omits a command in one build profile with no compiler warning.

## Findings

- **Architecture agent**: MEDIUM. Recommends always-register + gate the command body.
- **Simplicity agent**: MEDIUM. Net -5 LOC with stub approach, eliminates maintenance trap.
- **Pattern agent**: MEDIUM. Silent drift risk when adding commands.

**Location**: `src-tauri/src/lib.rs:89-106`

## Proposed Solutions

### Option A: Always register, gate the body (Recommended)
Keep a single `invoke_handler` with all commands. In `commands.rs`, provide two versions of `get_detection_debug`:
- Debug: returns debug data as today
- Release: returns `Err("Not available in release builds")`

Un-gate `DetectionDebugResponse` (harmless type, no security surface).
- **Effort**: Small | **Risk**: Low

### Option B: Add sync comment
Add a comment above both blocks explaining they must stay in sync.
- **Effort**: Trivial | **Risk**: Low (doesn't fix the underlying problem)

## Acceptance Criteria
- [x] Single invoke_handler registration in lib.rs
- [x] Adding a new command requires editing only one location
- [x] Debug command still returns error in release builds

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from commit edc168c review | |
| 2026-03-15 | Resolved in code | `src-tauri/src/lib.rs` now uses one `invoke_handler`, and `src-tauri/src/commands.rs` provides a release stub for `get_detection_debug`, so command registration no longer drifts across build profiles |

## Resources
- Commit: edc168c
