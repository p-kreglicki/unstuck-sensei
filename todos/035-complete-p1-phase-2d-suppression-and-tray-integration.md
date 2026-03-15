---
status: complete
priority: p1
issue_id: "035"
tags: [tauri, rust, detection, tray]
dependencies: []
---

# Implement Phase 2D suppression and tray integration

## Problem Statement

Phase 2D from the stuck detection engine plan is still incomplete. The runtime state machine can detect stuck conditions, but it does not yet suppress detection for meeting apps or when the main window is foregrounded, the tray does not control pause/resume behavior, and the first-sign-in notification permission flow is missing.

## Findings

- `src-tauri/src/detection/mod.rs` already has `SuppressionReason` and state transitions for `Suppressed` and `Paused`, but no public API yet updates `MeetingApp` or `AppForegrounded`.
- `src-tauri/src/detection/platform.rs` records app-switch bundle IDs, which is the right integration point for meeting-app suppression.
- `src-tauri/src/lib.rs` tracks window visibility via `Arc<AtomicBool>` for tray/window behavior, but that state is not bridged into `DetectionState`.
- `src-tauri/src/lib.rs` defines `MENU_PAUSE_DETECTION`, but the menu item is always disabled and has no click handler.
- `src/hooks/useAuth.tsx` syncs detection config on auth changes, so the first-sign-in notification permission request belongs in the Rust `sync_detection_config` command path.

## Proposed Solutions

### Option 1: Extend the existing detection state API in place

**Approach:** Add focused `DetectionState` methods for suppression updates, wire them into the platform/window/tray flows, and keep permission handling in `commands.rs`.

**Pros:**
- Reuses the state machine already built in Phase 2A-C
- Keeps suppression logic centralized in `detection/mod.rs`
- Minimizes structural churn

**Cons:**
- Requires touching a few integration points across `lib.rs`, `commands.rs`, and `platform.rs`

**Effort:** 3-4 hours

**Risk:** Low

## Recommended Action

Implement Phase 2D by extending the current detection state API, then wire it into three real entry points: app-switch activations, window visibility changes, and tray menu clicks. Add tests for suppression transitions and confirm the auth sync path still disables detection on sign-out while requesting notification permission only once.

## Technical Details

**Affected files:**
- `src-tauri/src/detection/mod.rs`
- `src-tauri/src/detection/platform.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `docs/plans/2026-03-15-feat-stuck-detection-engine-phase-2-plan.md`

## Acceptance Criteria

- [x] Meeting-app foreground switches set and clear runtime suppression correctly.
- [x] Main-window visibility sets and clears app-foreground suppression correctly.
- [x] Tray pause/resume works and the tray label/enabled state reflects detection state.
- [x] Sign-out still disables detection through `sync_detection_config`.
- [x] Notification permission is requested only once on first sign-in when state is `Unknown`.
- [x] Targeted Rust tests pass.

## Work Log

### 2026-03-15 - Phase 2D execution start

**By:** Codex

**Actions:**
- Read the Phase 2 plan and isolated the Phase 2D task list.
- Reviewed `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/detection/mod.rs`, `src-tauri/src/detection/platform.rs`, and `src/hooks/useAuth.tsx`.
- Confirmed the repository was on `main`, created branch `codex/phase-2d-stuck-detection`, and prepared the implementation todo.

**Learnings:**
- The state machine already supports suppression and pause semantics; the missing work is mostly integration, not new architecture.
- Window visibility and tray behavior already exist, so the clean fix is to bridge those signals into detection state rather than creating parallel state.

### 2026-03-15 - Phase 2D shipped

**By:** Codex

**Actions:**
- Added dynamic suppression rehydration in `src-tauri/src/detection/mod.rs` for meeting-app bundle IDs and app-foreground visibility.
- Wired tray rebuilds, pause/resume toggling, and window-visibility suppression updates through `src-tauri/src/lib.rs`.
- Added a one-time notification-permission request hook in `src-tauri/src/commands.rs` backed by `tauri-plugin-store`.
- Added regression tests for meeting-app suppression and app-foreground suppression re-enable behavior.
- Ran `cargo test` in `src-tauri/` and verified all 18 Rust tests passed.

**Learnings:**
- The real edge case was re-enabling detection while a suppression condition was already true; preserving the current foreground context solved that without keeping stale suppression reasons around.
- `tauri-plugin-notification` 2.3.3 exposes permission checks through Tauri `PermissionState`, so the first-sign-in flow is implemented as a guarded once-only hook rather than a separately verified macOS-specific prompt UX.
