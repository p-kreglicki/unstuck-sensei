---
title: "Rust-React timer state synchronization: race conditions, duplicate refreshes, and bootstrap instability"
date: 2026-03-21
category: runtime-errors
tags:
  - race-condition
  - state-synchronization
  - tauri-ipc
  - concurrent-mutations
  - window-focus
  - context-rerenders
  - bootstrap-ordering
  - error-sanitization
  - rust-timer
  - react-hooks
components:
  - src-tauri/src/timer/mod.rs
  - src/hooks/useTimer.tsx
  - src/hooks/useSessionFlow.ts
  - src/lib/session-records.ts
  - src/lib/errors.ts
severity: high
symptoms:
  - "Check-in actions could execute concurrently with pending sync replay, causing stale revision numbers sent to Supabase RPCs"
  - "Window focus triggered duplicate timer refreshes and Supabase queries"
  - "Bootstrap hydration could interleave with pending-sync replay, corrupting timer state"
  - "Every 1-second countdown tick caused full React re-renders of the entire timer consumer tree"
  - "Database setup errors leaked raw Postgres error details to end users"
root_causes:
  - "No serialization between check-in/extend timer actions and the pending-sync replay loop"
  - "Window focus handler called both refreshStatus() and replayPendingSyncs() independently"
  - "Bootstrap ran outside the pending-sync lock, racing against concurrent replay passes"
  - "Single flat React context included remainingSecs alongside structural timer state"
  - "Error sanitization interpolated raw error message instead of replacing it"
related:
  - docs/plans/2026-03-19-feat-rust-timer-and-checkin-plan.md
  - docs/solutions/security-issues/phase-3-p1-chat-api-and-detection-hardening.md
  - todos/097-complete-p3-isolate-timer-countdown-rerenders.md
  - todos/099-complete-p2-bootstrap-replay-pending-sync-race.md
pr: "#23"
---

## Problem Context

PR #23 implemented a Rust-native Pomodoro timer for a Tauri v2 desktop app with offline-first durability. The architecture splits timer responsibilities: Rust owns the countdown tick loop (1-second `tokio::time::interval`), deadline tracking, and local persistence (via `tauri-plugin-store`), while React owns session lifecycle, Supabase synchronization, and UI state. The two runtimes communicate through Tauri IPC commands and a `timer-state-changed` event stream.

The core challenge was ensuring consistency between three independent state sources: the Rust `TimerState` (in a `Mutex<TimerState>`), the React component state, and the Supabase database (via revision-gated RPCs). Four non-trivial problems emerged after the initial implementation.

---

## Fix 1: Timer Action / Pending-Sync Race Condition

**Commit:** `8af9f81` — "fix(timer): serialize check-in durability and timer actions"

### Problem

When the Rust timer fires a `CompleteBlock` event, the React side must first persist that completion to Supabase (a "pending sync") before the user can check in or extend. However, check-in and extend handlers had no coordination with the pending-sync replay loop. A user clicking "extend" while a completion sync was in-flight would read a stale `timerRevision`, causing the Supabase RPC to reject with a revision mismatch.

### Root Cause

No serialization between check-in/extend timer actions and the pending-sync replay loop: both could read and mutate the same session revision concurrently via separate async flows. The JS event loop is single-threaded but `await` points yield — treat every `await` as a potential interleave boundary.

### Solution

Introduced `ensureCheckinDurable` — a function that acquires the pending-sync lock, flushes any outstanding completion sync, and returns the authoritative revision before proceeding with the timer action. Added a `timerActionInFlightRef` guard to prevent double-submission of timer mutations.

```typescript
// All timer actions now go through the pending-sync lock
const timerBootstrap = await withPendingSyncLock(async () => {
  // read + mutate atomically
});
```

### Prevention

- Any time a React hook manages state shared between Rust runtime (via `invoke`) and a remote database, define an explicit serialization primitive at the hook level.
- Use the promise-chain mutex pattern (`pendingSyncLockRef`) for any multi-step async workflow where ordering matters.
- Guard timer action entry points with a `useRef` boolean as a UI-level debounce, separate from the data-level lock.

---

## Fix 2: Duplicate Refresh on Window Focus

**Commit:** `bf7b328` — "Fix timer focus refresh duplication"

### Problem

When the user alt-tabbed back to the app, the timer status was refreshed twice: once via explicit `refreshStatus()` and once via `replayPendingSyncs()` (which internally also calls `refreshStatus()`). This caused redundant IPC round-trips and potential UI flicker as two responses with different `remainingSecs` values arrived.

### Root Cause

The focus handler called both functions independently. The explicit `refreshStatus()` was leftover from before `replayPendingSyncs` existed.

```typescript
// Before (broken)
const handleWindowFocus = () => {
  void refreshStatus().catch(...);       // redundant
  void replayPendingSyncs().catch(...);  // already includes refresh
};
```

### Solution

Removed the standalone `refreshStatus()` call, leaving only `replayPendingSyncs()`.

### Prevention

- Before adding a new call site for a state-refresh function, trace the full call graph to check if the refresh is already covered.
- Adopt a "single entry point per trigger" rule: each external event (focus, visibility change, network reconnect) should funnel through exactly one handler.
- In Tauri apps, `window.focus` fires frequently (every tab switch). Work triggered by focus must be idempotent and deduplicated.

---

## Fix 3: Bootstrap / Replay Ordering Race

**Commit:** `9b44838` — "Stabilize timer bootstrap and isolate countdown updates"

### Problem (A): Bootstrap Race

The `useSessionFlow` bootstrap read Rust timer state and performed hydration mutations outside the pending-sync lock. The `replayPendingSyncs` flow (triggered by auth changes or focus events) could run concurrently and also mutate Rust timer state. Bootstrap could read stale state, then overwrite corrections that replay had just applied.

### Root Cause

Bootstrap did `Promise.all([refreshStatus(), getPendingSyncs(), loadActiveTimerSession()])` as bare awaits with no mutual exclusion against the concurrent `replayPendingSyncs`.

### Solution

Wrapped the entire bootstrap sequence inside `withPendingSyncLock()`:

```typescript
const timerBootstrap = await withPendingSyncLock(async () => {
  const [rustTimerState, pendingSyncs, activeTimerSession] = await Promise.all([
    refreshStatus(),
    getPendingSyncs(),
    loadActiveTimerSession(user.id),
  ]);
  // all hydration logic inside the lock
  return { activeSession, activeTimerSession, latestBlock, statusMessage };
});
```

### Problem (B): Countdown Re-renders

Every 1Hz tick from Rust caused all `useTimer()` consumers to re-render because `remainingSecs` was in the same React context as structural timer state.

### Solution

Split the context into `TimerContext` (status/actions, changes only on transitions) and `TimerCountdownContext` (just the countdown number). Components that need the countdown use `useTimerCountdown()`.

```typescript
setState((current) =>
  isSameTimerContextState(current, nextContextState) ? current : nextContextState,
);
setRemainingSecs((current) =>
  current === nextState.remainingSecs ? current : nextState.remainingSecs,
);
```

### Prevention

- Any component that reads timer/sync state during initialization must acquire the same lock that the sync-replay system uses.
- Structure bootstrap as a single atomic transaction: acquire lock, read all state, reconcile, release lock, then apply to React state.
- Separate high-frequency state (countdown) from low-frequency state (status) in React contexts to avoid unnecessary re-renders.

---

## Fix 4: Database Error Leakage

**Commit:** `e22dfaad` — "Sanitize client database setup errors"

### Problem

When Supabase returned errors like `relation "public.sessions" does not exist`, the raw PostgreSQL message (including internal table names and schema paths) was displayed to the user.

### Root Cause

`toDisplayError` detected the pattern but interpolated the raw message into the output:

```typescript
// Before (broken)
return `Database setup is incomplete. ${message} Run the Supabase migrations...`;
```

### Solution

Replaced with a fixed string containing no internal details:

```typescript
return "Database setup is incomplete. Run the Supabase migrations for this project and retry.";
```

### Prevention

- Never interpolate raw error `.message` strings into user-facing text.
- Adopt a "default-deny" approach: `toDisplayError` returns the fallback unless the error is explicitly marked as displayable via the `displayable` flag.
- Use `createDisplayError(message)` for intentionally user-facing errors (validation, business rules).

---

## Cross-Cutting Patterns for Tauri v2 + React + Supabase

### Checklist for New Features

1. **Dual-runtime state?** If the feature has state in both Rust and JS, define the serialization boundary explicitly.
2. **Window lifecycle events?** If the feature reacts to focus/blur/visibility, deduplicate handlers and make them idempotent.
3. **Restart survival?** If the feature needs durability, define the persistence and reconciliation strategy across Rust store, Supabase, and React state.
4. **User-facing errors?** Route all errors through `toDisplayError` with a meaningful fallback.
5. **Shared constants?** If logic or constants exist in both Rust and JS, document the canonical location.

### State Reconciliation Model

The app has three sources of truth: Rust runtime (in-memory), Supabase (durable), and Tauri store (persistence across restarts). Bootstrap and replay are reconciliation points. Always reconcile in order: read all three, resolve conflicts, write back canonical state. The pending-sync queue bridges Rust runtime and Supabase durability with at-least-once delivery and revision-gated idempotency.

### The Two Locks

- **Rust `Mutex<TimerState>`**: Serializes in-process mutations on the Rust side. Acquired automatically via `invoke`.
- **JS `pendingSyncLockRef`**: Serializes multi-step async workflows on the JS side. Required because JS orchestrations that call multiple `invoke` commands are not atomic.

Both must be considered when implementing any timer operation that touches both runtimes.
