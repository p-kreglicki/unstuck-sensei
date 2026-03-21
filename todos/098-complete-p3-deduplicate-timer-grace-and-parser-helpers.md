---
status: complete
priority: p3
issue_id: "098"
tags: [code-review, cleanup, typescript, rust, timer]
dependencies: []
---

# Deduplicate timer grace-expiry and parser helpers

## Problem Statement

The timer check-in grace window and grace-expiry helper are duplicated across frontend hooks, and the Rust timer code also carries duplicate timestamp parsing logic. None of this is broken today, but it creates quiet drift risk in code that is already split across React and Tauri.

This is a maintainability cleanup, not a correctness emergency. The biggest win is deduping within each language boundary and making any cross-language constant mirroring explicit.

## Findings

- `src/hooks/useSessionFlow.ts:42-108` defines `CHECKIN_GRACE_HOURS = 12` and `isCheckinGraceExpired()`.
- `src/hooks/useTimer.tsx:72-100` defines the same constant and helper again.
- `src-tauri/src/timer/mod.rs:15` defines the Rust-side `CHECKIN_GRACE_HOURS`.
- `src-tauri/src/timer/mod.rs:689-693` and `src-tauri/src/commands.rs:323-326` both define `parse_timestamp()`.
- The frontend duplication is immediately removable; the Rust parser duplication is immediately removable; the Rust/TS grace constant cannot be literally shared without extra build plumbing.

## Proposed Solutions

### Option 1: Deduplicate within each language boundary (Recommended)

**Approach:** Extract the TS grace constant/helper to a shared frontend module such as `src/lib/timer-constants.ts`, and make `timer::parse_timestamp()` `pub(crate)` so `commands.rs` can reuse it.

- **Pros:** Removes real duplication with minimal design overhead.
- **Cons:** Leaves the Rust grace constant mirrored rather than truly shared with TS.
- **Effort:** Small.
- **Risk:** Low.

---

### Option 2: Add explicit drift guards around mirrored constants

**Approach:** Keep separate constants in Rust and TS, but add comments and tests that make the contract visible.

- **Pros:** Very small change, no reshaping of imports.
- **Cons:** Keeps duplicate source values in place.
- **Effort:** Small.
- **Risk:** Low.

## Recommended Action

Implement Option 1 and document the remaining Rust/TS grace constant as an intentional mirrored contract. That gets the low-hanging cleanup done without pretending cross-language constant sharing is free.

## Technical Details

- **Affected files:** `src/hooks/useSessionFlow.ts`, `src/hooks/useTimer.tsx`, `src/lib/`, `src-tauri/src/timer/mod.rs`, `src-tauri/src/commands.rs`
- **Related concern:** duplicated business rules across language boundaries

## Resources

- **PR:** #23
- **Related completed work:** [073-complete-p2-shared-code-duplication-drift.md](/Users/piotrkreglicki/Projects/unstuck-sensei/todos/073-complete-p2-shared-code-duplication-drift.md)
- **Related completed work:** [029-complete-p2-duplicated-invoke-handler-lib-rs.md](/Users/piotrkreglicki/Projects/unstuck-sensei/todos/029-complete-p2-duplicated-invoke-handler-lib-rs.md)

## Acceptance Criteria

- [x] Frontend grace-expiry logic lives in one shared helper/module
- [x] Rust timestamp parsing logic is defined in one place
- [x] Any remaining mirrored grace constant between Rust and TS is documented as intentional
- [x] Existing timer and check-in behavior remains unchanged after the dedupe

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-21 | Created from PR #23 review feedback item 8 | The real cleanup target is per-language duplication; cross-language single-source-of-truth would be more machinery than the current problem justifies |
| 2026-03-21 | Extracted the frontend grace helper to `src/lib/timer.ts` and reused `timer::parse_timestamp()` from `commands.rs` | The low-risk cleanup was within each language boundary; explicit comments on the mirrored grace constant are enough until shared cross-runtime config is warranted |
