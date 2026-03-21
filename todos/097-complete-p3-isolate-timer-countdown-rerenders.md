---
status: complete
priority: p3
issue_id: "097"
tags: [code-review, react, tauri, performance, timer]
dependencies: []
---

# Isolate timer countdown updates from full session rerenders

## Problem Statement

The running timer emits a new state payload every second from the Tauri runtime, and `TimerProvider` publishes that payload through a context value consumed by `useSessionFlow()`. Because the context value changes on every tick, the session page rerenders every second even though only the countdown display truly needs that hot state.

This is acceptable at the current UI size, but it is an avoidable performance tax on the whole session tree and will get more noticeable as the screen grows.

## Findings

- `src-tauri/src/timer/mod.rs:339-385` emits `TimerRuntimeEffect::EmitStateChanged(self.status_response_at(now))` on every running-timer tick.
- `src/hooks/useTimer.tsx:433-445` calls `setState(nextState)` for every timer-state event.
- `src/hooks/useTimer.tsx:487-500` places the entire `state` object into the context value, so every state change invalidates all consumers.
- `src/hooks/useSessionFlow.ts:122-163` consumes timer context and derives page stage from it.
- `src/pages/Session.tsx:12-97` renders the full session page from `useSessionFlow()`, so the hot countdown state bubbles through the whole page.
- A shallow equality check before `setState()` would only trim true no-op updates; it would not stop rerenders while `remainingSecs` changes each second.

## Proposed Solutions

### Option 1: Split hot countdown state from the broader timer context (Recommended)

**Approach:** Keep timer actions and stable status in one context, but move the per-second countdown into a narrower subscription path so only the countdown UI rerenders every tick.

- **Pros:** Addresses the root cause, scales better as the page grows.
- **Cons:** More structural change than a one-line guard.
- **Effort:** Medium.
- **Risk:** Low.

---

### Option 2: Move ticking presentation into the `Timer` component

**Approach:** Publish stable timer milestones (started at, deadline, status) from the provider and let `Timer` derive `remainingSecs` locally with its own interval.

- **Pros:** Keeps the hot loop local to the one component that displays it.
- **Cons:** Requires careful handling for hydration, resume, and check-in transitions.
- **Effort:** Medium.
- **Risk:** Medium.

---

### Option 3: Only skip duplicate state assignments

**Approach:** Compare incoming state to current state and skip `setState()` for identical payloads.

- **Pros:** Very small change.
- **Cons:** Does not materially reduce rerenders during a running countdown because the payload legitimately changes each second.
- **Effort:** Small.
- **Risk:** Low.

## Recommended Action

Take Option 1 if this screen is going to keep growing. If a smaller tactical fix is preferred, Option 2 is still better than relying on equality checks alone because it isolates the hot update path instead of just shaving off no-ops.

## Technical Details

- **Affected files:** `src-tauri/src/timer/mod.rs`, `src/hooks/useTimer.tsx`, `src/hooks/useSessionFlow.ts`, `src/pages/Session.tsx`, `src/components/session/Timer.tsx`
- **Measurement follow-up:** add a render-count or profiler-based check if practical

## Resources

- **PR:** #23
- **Related completed work:** [050-complete-p2-streaming-render-perf.md](/Users/piotrkreglicki/Projects/unstuck-sensei/todos/050-complete-p2-streaming-render-perf.md)
- **Related completed work:** [040-complete-p2-unstable-context-value-and-missing-deps.md](/Users/piotrkreglicki/Projects/unstuck-sensei/todos/040-complete-p2-unstable-context-value-and-missing-deps.md)

## Acceptance Criteria

- [x] Unrelated session page sections no longer rerender once per second while the timer is running
- [x] The countdown UI still updates once per second
- [x] Timer status transitions (running, awaiting_checkin, idle) still propagate correctly
- [x] Any new structure is covered by targeted tests or profiling evidence

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-21 | Created from PR #23 review feedback item 7 | The main issue is structural: the hot countdown state currently fans out through the same context used by the whole session page |
| 2026-03-21 | Split countdown state into `useTimerCountdown()` and kept `useTimer()` on stable timer status/actions | Context value stability matters more than provider rerenders; once `remainingSecs` moved to its own context, countdown ticks stopped invalidating the broader session tree |
