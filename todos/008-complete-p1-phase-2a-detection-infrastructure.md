---
status: complete
priority: p1
issue_id: "008"
tags: [tauri, rust, detection, frontend]
dependencies: []
---

# Phase 2A Detection Infrastructure

Establish the Rust and frontend scaffolding for the stuck detection engine so the runtime can accept detection config and expose detection state before platform monitoring lands.

## Problem Statement

Phase 2 of the desktop MVP depends on a stable Rust/frontend contract for detection state, tray updates, and notification plugin setup. The app currently only syncs tray auth state through a single command in `src-tauri/src/lib.rs`, which is too narrow for the planned state machine and makes later platform work harder to layer in safely.

## Findings

- `src-tauri/src/lib.rs` currently mixes builder setup, tray menu construction, and the sole Tauri command `update_tray_auth_state`.
- `src/hooks/useAuth.tsx` only sends `signedIn`, so Rust has no way to receive `enabled` or `sensitivity`.
- The Supabase `profiles` type already includes `detection_enabled` and `detection_sensitivity`, which is enough for Phase 2A config sync.
- The Tauri capability file does not yet include notification permissions, and Cargo does not yet register `tauri-plugin-notification`.

## Proposed Solutions

### Option 1: Build the Phase 2A contract now

**Approach:** Add a dedicated `commands.rs`, add stub detection state/modules, wire `sync_detection_config`, and update the auth hook to fetch profile settings and push them into Rust.

**Pros:**
- Matches the Phase 2 architecture cleanly.
- Reduces refactor cost before macOS monitoring code lands.
- Gives a testable API boundary for later milestones.

**Cons:**
- Requires touching both Rust and frontend code in one milestone.

**Effort:** 1 session

**Risk:** Low

## Recommended Action

Implement Option 1 and stop after Phase 2A once the app compiles with the new command surface and notification plugin registration.

## Technical Details

**Affected files:**
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/detection/mod.rs`
- `src-tauri/src/detection/platform.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/capabilities/default.json`
- `src/hooks/useAuth.tsx`

## Acceptance Criteria

- [x] Detection commands are moved into `src-tauri/src/commands.rs`
- [x] Managed detection state is registered with Tauri
- [x] `sync_detection_config` replaces `update_tray_auth_state`
- [x] Phase 2A stub commands compile and are registered
- [x] Notification plugin and capability permission are added
- [x] Frontend auth flow sends signed-in detection config to Rust
- [x] Targeted verification passes

## Work Log

### 2026-03-15 - Phase 2A execution

**By:** Codex

**Actions:**
- Read the Phase 2 plan and current Tauri/frontend implementation.
- Created a dedicated milestone todo for Phase 2A.
- Identified the Rust/frontend contract and plugin registration changes required for this milestone.
- Added `commands.rs`, `detection/mod.rs`, and `detection/platform.rs` to establish the Phase 2A Rust boundaries.
- Replaced the tray auth command with `sync_detection_config` and wired the auth hook to load profile detection settings before syncing Rust state.
- Registered `tauri-plugin-notification`, added the desktop capability permission, and verified the project with `cargo check` and `npm run build`.

**Learnings:**
- The existing app shell is small enough that Phase 2A can stay focused on contract and module boundaries.
- The profiles table already provides the detection fields needed for the first config sync.
- Runtime command smoke testing from an actual desktop window is still separate from compile-time verification and should happen before Phase 2B work starts.
