---
status: complete
priority: p2
issue_id: "099"
tags: [code-review, concurrency, timer, architecture]
dependencies: []
---

# Bootstrap reads pending syncs outside replay serialization lock

## Problem Statement

The bootstrap effect in `useSessionFlow.ts` calls `getPendingSyncs()` at line 201 without acquiring `runPendingSyncExclusive` from `useTimer.tsx`. Meanwhile, `replayPendingSyncsPass` (triggered by the auth effect in `useTimer.tsx`) runs inside that lock. If replay clears a pending stop sync between bootstrap's read and its consumption at line 238, bootstrap makes decisions on stale data and may incorrectly rehydrate a running timer instead of recognizing the pending stop.

In practice, both run soon after mount and the Rust mutex serializes IPC calls, which likely masks the race. But it is not formally safe.

## Findings

- `useSessionFlow.ts:200-201` — bootstrap calls `refreshStatus()` and `getPendingSyncs()` via `Promise.all` outside any lock.
- `useSessionFlow.ts:238-279` — bootstrap uses the pending syncs result to decide whether to show a "pending stop" state.
- `useTimer.tsx:375-515` — `replayPendingSyncsPass` runs inside `runPendingSyncExclusive` and can clear the same syncs.
- `useTimer.tsx:588-597` — auth effect triggers `replayPendingSyncs()` on `user?.id` change, which races with the bootstrap effect.
- Architecture agent flagged this as the most significant risk in the current code.

## Proposed Solutions

### Option 1: Expose a `withPendingSyncLock` method from the timer context (Recommended)

**Approach:** Add a `withPendingSyncLock(fn)` method to the timer context that wraps `runPendingSyncExclusive`. Have bootstrap's pending-sync read and decision logic run inside this lock.

- **Pros:** Minimal change, formal serialization guarantee
- **Cons:** Slightly longer bootstrap latency if replay is in progress
- **Effort:** Small
- **Risk:** Low

### Option 2: Have bootstrap skip pending sync reads entirely

**Approach:** Let bootstrap only read Supabase + Rust state. Let the timer provider's replay handle pending syncs independently. Bootstrap would not check for pending stop syncs; instead, it would always rehydrate based on DB state, and the replay pass would correct it afterward.

- **Pros:** Eliminates the race entirely, simplifies bootstrap
- **Cons:** Brief UI flicker if bootstrap shows "running" then replay corrects to "stopped"
- **Effort:** Medium
- **Risk:** Medium (UX concern)

### Option 3: Wait for replay to complete before bootstrap proceeds

**Approach:** Bootstrap awaits a signal from the timer provider that initial replay is done before reading any state.

- **Pros:** Clean separation of concerns
- **Cons:** Adds a coordination mechanism, potentially delays initial render
- **Effort:** Medium
- **Risk:** Low

## Acceptance Criteria

- [x] Bootstrap's pending-sync reads cannot interleave with `replayPendingSyncsPass`
- [x] Add a test that exercises concurrent bootstrap + replay to verify no stale reads
- [x] No regression in bootstrap latency or UI behavior

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-21 | Created from code review of commit 8af9f81 | Flagged by architecture-strategist agent |
| 2026-03-21 | Wrapped bootstrap's timer snapshot and hydration logic in `withPendingSyncLock()` and added a lock-gating test in `useSessionFlow.test.tsx` | The race disappeared once bootstrap took a serialized timer snapshot before deciding whether to clear or hydrate runtime state |

## Resources

- Commit: 8af9f81
- `src/hooks/useSessionFlow.ts:188-406`
- `src/hooks/useTimer.tsx:375-536`
