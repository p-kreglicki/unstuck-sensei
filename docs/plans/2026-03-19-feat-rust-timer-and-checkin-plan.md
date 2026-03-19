---
title: "feat: Rust Timer and Check-in"
type: feat
date: 2026-03-19
---

# feat: Rust Timer and Check-in

## Overview

Implement a 25-minute work timer that runs entirely in Rust (reliable even when the webview window is hidden), plus a check-in flow that lets the user report whether they got started. This completes the end-to-end session loop: stuck input → energy → AI steps → timer → check-in.

## Problem Statement / Motivation

The coaching session currently ends at step confirmation (`ConfirmedCard`). Without a timer, the user has no structured work block, no completion signal, and no feedback loop. The timer is the mechanism that converts intention ("I'll work on step 1") into action (a bounded 25-minute block with a clear start and end).

The timer must live in Rust because:
- JavaScript timers in a webview are unreliable when the window is hidden or minimized.
- The tray menu needs to show timer state regardless of window visibility.
- Native notifications on timer completion must fire even if the user never reopened the window.
- Detection suppression during the timer must be coordinated in the same Rust process.

## Proposed Solution

A Rust `TimerState` module following the same effects-based state machine pattern as the detection engine. The frontend gets a `useTimer` context provider that mirrors `useDetection`. Two new session stages (`timer` and `checkin`) extend the existing flow.

## Technical Approach

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Time source | `chrono::Utc::now()` wall-clock deadline | `Instant` does not advance during macOS sleep. Wall-clock means "25 real minutes" regardless of sleep. On wake, if deadline passed, fire completion immediately. |
| Crash recovery | Resume or complete on relaunch | On startup, query for sessions where `timer_started_at IS NOT NULL AND timer_ended_at IS NULL`. If deadline passed → show check-in. If deadline remains → resume timer with corrected remaining time. |
| Timer pause | No pause for MVP | Pomodoro tradition. Simplifies state machine. User can cancel and start a new session if interrupted. |
| Concurrent sessions | Blocked during timer | All entry points (tray, detection nudge, email deep link) show the running timer instead of starting a new session. Detection is suppressed so nudges will not fire anyway. |
| Extension | Once, +25 minutes | Shown alongside check-in buttons at completion. Selecting feedback commits. Clicking extend restarts and defers check-in. |
| Quit mid-timer | Just quit, recover on relaunch | No special exit path. On next launch, startup recovery detects the orphaned session (`timer_started_at` set, `timer_ended_at` null) and handles it — same as crash recovery. |
| Notification click | Activate app, show check-in | Simple notification, no action buttons for MVP. Clicking activates the app; frontend shows check-in screen. |
| Uncollected check-in | Show on return, no expiry | If the user never checks in, always show the check-in screen when they return. Session stays `active` until they check in or discard. |

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Rust Backend                       │
│                                                      │
│  timer/mod.rs                                        │
│  ┌─────────────────────────────────────────────┐    │
│  │  TimerState                                  │    │
│  │  - deadline: Option<DateTime<Utc>>           │    │
│  │  - session_id: Option<Uuid>                  │    │
│  │  - duration_secs: u32                        │    │
│  │  - extended: bool                            │    │
│  │  - status: Idle | Running | Completed        │    │
│  └─────────────────────────────────────────────┘    │
│           │                                          │
│           │ tick loop (1s interval)                   │
│           ▼                                          │
│  TimerRuntimeEffect                                  │
│  - EmitTick { remaining_secs }                       │
│  - EmitCompleted                                     │
│  - SendNotification                                  │
│  - SyncTrayMenu                                      │
│  - UpdateDetectionSuppression(bool)                  │
│                                                      │
│  detection/mod.rs                                    │
│  - SuppressionReason::TimerRunning (already exists)  │
│  - New: set_timer_suppression(active: bool)          │
└──────────┬──────────────────────────────────────────┘
           │ events: "timer-state-changed"
           ▼
┌─────────────────────────────────────────────────────┐
│                  React Frontend                      │
│                                                      │
│  useTimer.tsx (Context + Provider)                   │
│  - listen("timer-state-changed")                     │
│  - invoke("start_timer"), invoke("stop_timer")       │
│  - invoke("extend_timer"), invoke("get_timer_state") │
│                                                      │
│  useSessionFlow.ts                                   │
│  - New stages: "timer" | "checkin"                   │
│  - New query: loadRunningTimerSession()              │
│                                                      │
│  Components:                                         │
│  - Timer.tsx (countdown display, stop button)        │
│  - CheckIn.tsx (yes/somewhat/no + extend button)     │
└─────────────────────────────────────────────────────┘
```

### Session Stage Flow (Updated)

```
compose → energy → clarifying → steps → timer → checkin → (done)
                                          │         │
                                          │    extend (once)
                                          │         │
                                          ◄─────────┘
```

The `confirmed` stage and `ConfirmedCard` are replaced. Confirming steps now directly starts the timer — there is no intermediate "confirmed but not yet timing" state. The `StepsList` confirm button becomes the timer start trigger.

### Data Model

No schema changes required. All timer columns already exist in the `sessions` table:

| Column | Type | Usage |
|---|---|---|
| `timer_started_at` | timestamptz | Set when timer starts |
| `timer_ended_at` | timestamptz | Set when timer hits zero (or cancelled) |
| `timer_duration_seconds` | integer | Configured duration: 1500 (25 min) or 3000 (extended) |
| `timer_extended` | boolean | Set to true when user extends |
| `feedback` | text | `yes` / `somewhat` / `no` — set at check-in |
| `status` | text | `active` → `completed` (after check-in) or `incomplete` (cancelled/abandoned) |

### Sleep/Wake Handling

On each tick, calculate `remaining = deadline - chrono::Utc::now()`. If `remaining <= 0`, fire completion immediately. This naturally handles:
- Short sleep: timer resumes with correct remaining time on wake.
- Long sleep (past deadline): timer fires completion immediately on wake.
- No drift accumulation since every tick recalculates from the absolute deadline.

### Frontend Bootstrap (Running Timer Recovery)

Before loading a session draft, `useSessionFlow` must check for a running timer session:

```typescript
// src/lib/session-records.ts — new function
async function loadRunningTimerSession(userId: string) {
  return supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .not("timer_started_at", "is", null)
    .is("timer_ended_at", null)
    .eq("status", "active")
    .order("timer_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}
```

On mount: if a running timer session exists → derive stage as `timer` (or `checkin` if Rust reports completed) → skip the compose flow entirely.

### Tray Menu During Timer

Replace the current menu items when a timer is running:

| Normal Menu | Timer Running Menu |
|---|---|
| Start Session | ~~Start Session~~ (removed) |
| Pause Detection | ~~Pause Detection~~ (hidden, detection suppressed) |
| — | Timer: MM:SS remaining (disabled, informational) |
| — | Stop Timer |
| Settings | Settings |
| Quit | Quit |

`sync_tray_menu()` gains a second parameter: `Option<&TimerState>` alongside the existing detection state.

## Implementation Phases

### Phase 4a: Rust Timer State Machine

**Goal:** Timer starts, ticks, completes, and extends in Rust with full test coverage.

**Tasks:**

- [ ] Create `src-tauri/src/timer/mod.rs` with `TimerState` struct
  - Fields: `status` (Idle/Running/Completed), `deadline`, `session_id`, `duration_secs`, `extended`
  - Methods: `start(session_id, duration_secs)`, `stop()`, `extend(additional_secs)`, `tick()`, `get_status()`
  - Each mutation returns `Vec<TimerRuntimeEffect>`
- [ ] Define `TimerRuntimeEffect` enum: `EmitStateChanged`, `SendNotification`, `SyncTrayMenu`, `SetDetectionSuppression(bool)`
- [ ] Define `TimerStatusResponse` serde struct for the frontend event payload
  - Fields: `status`, `remaining_secs`, `session_id`, `extended`, `duration_secs`
- [ ] Implement `execute_timer_effects()` in `timer/mod.rs`
  - Emit `"timer-state-changed"` event with `TimerStatusResponse`
  - Fire native notification on completion
  - Call `sync_tray_menu()`
  - Insert/remove `SuppressionReason::TimerRunning` on detection state
- [ ] Add `set_timer_suppression(active: bool)` method to `DetectionState` (wire the existing `SuppressionReason::TimerRunning` variant)
- [ ] Spawn a 1-second tick loop using `tauri::async_runtime::spawn` + `tokio::time::interval`
  - On each tick: lock `TimerState`, call `tick()`, execute effects
  - `tick()` calculates `remaining = deadline - Utc::now()`, fires completion if `remaining <= 0`
  - Loop exits when status is Idle or Completed
- [ ] Register `Mutex<TimerState>` as managed state in `lib.rs`
- [ ] Add `chrono` dependency to `Cargo.toml` (for `Utc::now()` deadline math)
- [ ] Write unit tests for the state machine
  - Start → tick → complete flow
  - Start → stop (cancel) flow
  - Start → complete → extend → complete flow
  - Start → extend → stop flow
  - Double-start rejected
  - Extend when not completed rejected
  - Extend when already extended rejected
  - Tick with past deadline fires immediate completion

### Phase 4b: Tauri Commands and Tray Integration

**Goal:** Frontend can control the timer via commands, tray menu reflects timer state.

**Tasks:**

- [ ] Add Tauri commands in `src-tauri/src/commands.rs`
  - `start_timer(session_id: String, duration_secs: u32)` → starts timer, returns `TimerStatusResponse`
  - `stop_timer()` → cancels timer, returns `TimerStatusResponse`
  - `extend_timer(additional_secs: u32)` → extends once, returns `TimerStatusResponse`
  - `get_timer_state()` → returns current `TimerStatusResponse`
- [ ] Register all timer commands in `generate_handler![]` in `lib.rs`
- [ ] Update `build_tray_menu()` signature to accept timer state
  - When timer is running: show "Timer: MM:SS" (disabled) + "Stop Timer" item
  - Hide "Start Session" and "Pause Detection" during timer
- [ ] Update `sync_tray_menu()` to read both `Mutex<DetectionState>` and `Mutex<TimerState>`
- [ ] Handle "Stop Timer" tray menu click in the menu event handler
- [ ] No special quit handling needed — startup recovery (Phase 4e) handles orphaned timer sessions the same way it handles crashes

### Phase 4c: Frontend Timer UI

**Goal:** User sees a countdown, can stop the timer, and the timer persists across navigation.

**Tasks:**

- [ ] Create `src/hooks/useTimer.tsx` — Context + Provider pattern matching `useDetection.tsx`
  - `listen("timer-state-changed")` for tick updates
  - Wrap `invoke("start_timer")`, `invoke("stop_timer")`, `invoke("extend_timer")`, `invoke("get_timer_state")`
  - `isTauri()` guard for browser dev mode
  - Fetch initial state on mount and on window focus
- [ ] Add `TimerProvider` to the app's provider tree in `App.tsx`
- [ ] Replace `"confirmed"` with `"timer"` and add `"checkin"` to the `SessionStage` type in `useSessionFlow.ts`
- [ ] Remove `ConfirmedCard.tsx` — its role is absorbed by the timer start action
- [ ] Add `loadRunningTimerSession()` to `src/lib/session-records.ts`
- [ ] Update `useSessionFlow` bootstrap
  - On mount: check `loadRunningTimerSession()` first
  - If found and timer still running → set stage to `"timer"`, populate session data
  - If found and timer completed (Rust says completed) → set stage to `"checkin"`
  - Otherwise → proceed with existing draft loading logic
- [ ] Update `deriveStage()` in `useSessionFlow.ts` to handle timer/checkin stages
- [ ] Update `Session.tsx` to render `Timer` component for `"timer"` stage and `CheckIn` for `"checkin"` stage
- [ ] Build `src/components/session/Timer.tsx`
  - Large countdown display (MM:SS)
  - Current first step reminder text (from session steps JSONB)
  - "Stop" button → confirms cancellation → invokes `stop_timer` → writes `timer_ended_at` and `status = 'incomplete'` to Supabase
  - Warm, encouraging copy (e.g., "You're working on: [first step]")
- [ ] Update `handleConfirm` in `useSessionFlow.ts` (currently transitions to `"confirmed"`)
  - Write `timer_started_at` and `timer_duration_seconds` (1500) to session row
  - Invoke `start_timer` Rust command
  - Transition directly to `"timer"` stage (skip `"confirmed"`)

### Phase 4d: Check-in and Completion

**Goal:** User can check in after timer completion, extend once, and see completed sessions in history.

**Tasks:**

- [ ] Build `src/components/session/CheckIn.tsx`
  - Show timer completion message ("Time's up! How did it go?")
  - Three feedback buttons: "Yes, I got started" / "Somewhat" / "Not really"
  - Separate "Keep going (+25 min)" button — only shown if `timer_extended` is false
  - On feedback selection: write `feedback`, `timer_ended_at`, `status = 'completed'` to session row → navigate to history or show completion summary
  - On extend: invoke `extend_timer(1500)`, write `timer_extended = true` and `timer_duration_seconds = 3000` to session row, transition back to `"timer"` stage
- [ ] Update `useSessionFlow` to handle timer completion event
  - Listen for timer completion from `useTimer` context
  - Auto-transition from `"timer"` to `"checkin"` stage
- [ ] Handle native notification on timer completion
  - Notification text: "Time's up! How did it go?" (warm, not aggressive)
  - Clicking notification → show window → frontend is already on `"checkin"` stage (or transitions to it)
- [ ] Save `incomplete` status when user stops timer early
  - Write `timer_ended_at = now`, `status = 'incomplete'` to Supabase
  - Clear Rust timer state
  - Redirect to home / history
- [ ] Ensure detection suppression is cleared only when timer returns to `Idle` (stop or final completion), not on `Completed`
  - `Completed` is a transient state — the user might extend. Only `stop()` and check-in (which resets to `Idle`) should clear suppression
  - `SetDetectionSuppression(false)` effect fires in `stop()` and when check-in resets the timer to `Idle`

### Phase 4e: Edge Cases and Polish

**Goal:** Handle recovery, navigation, and quit gracefully.

**Tasks:**

- [ ] Implement startup recovery in `useSessionFlow`
  - On app launch, `loadRunningTimerSession()` finds an orphaned timer session
  - Calculate: if `timer_started_at + timer_duration_seconds < now` → show check-in
  - Otherwise → resume timer with corrected remaining time (invoke `start_timer` with remaining seconds)
- [ ] Handle navigation away during timer
  - `useTimer` context is app-wide (in `App.tsx`), not page-scoped
  - When user navigates to `/settings` and back to `/`, `useSessionFlow` bootstrap detects running timer and shows timer UI
- [ ] Handle "Start Session" entry points during timer
  - Tray "Start Session" is hidden during timer (Phase 4b)
  - If email deep link or other entry point tries to start a session, redirect to the running timer
- [ ] Test timer accuracy across sleep/wake cycles

## Acceptance Criteria

### Functional Requirements

- [ ] Timer starts when user confirms steps (25-minute default)
- [ ] Countdown ticks every second in the UI
- [ ] Timer continues running when the window is hidden or minimized
- [ ] Timer completion fires a native notification
- [ ] User can check in with yes / somewhat / no after completion
- [ ] User can extend the timer once by +25 minutes
- [ ] User can stop the timer early (session marked incomplete)
- [ ] Stuck detection is suppressed while the timer is running
- [ ] Detection resumes when the timer completes or is cancelled
- [ ] Tray menu shows timer state (remaining time, stop option) during timer
- [ ] Navigating away and back preserves the timer UI
- [ ] App relaunch recovers an in-progress or completed timer session
- [ ] Quitting or crashing mid-timer is recovered on next launch (check-in or resume)
- [ ] Partial session state is saved at each step

### Non-Functional Requirements

- [ ] Timer accuracy within ~1 second over a 25-minute session
- [ ] Timer handles system sleep/wake correctly (wall-clock deadline)
- [ ] No content logging or new privacy-sensitive data collection
- [ ] Warm, encouraging copy — no productivity jargon

### Quality Gates

- [ ] Rust state machine has unit tests for all transitions
- [ ] Timer tested while window is visible, hidden, and tray-only
- [ ] Timer tested across sleep/wake (manual verification)
- [ ] Crash recovery tested: kill process mid-timer, relaunch, verify recovery
- [ ] Extension tested: extend once, verify second extension blocked
- [ ] Check-in data persists correctly to Supabase
- [ ] Detection suppression verified: no nudges fire during timer
- [ ] Tray menu items update correctly for timer states

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `Instant` not advancing during macOS sleep causing drift | High | High | Use `chrono::Utc::now()` wall-clock deadline, recalculate on every tick |
| Mutex poisoning on timer state | Low | High | Use `recover_timer_state_lock` pattern matching detection module |
| Orphaned session after quit/crash | Medium | Low | Startup recovery already handles this — no special exit path needed |
| Tray menu rebuild on every tick is expensive | Medium | Low | Only rebuild tray menu when minute changes, not every second |
| Timer tick loop outlives the timer (resource leak) | Low | Low | Exit loop when status is not Running; use cancellation token if needed |

## References

### Internal References

- Parent plan: `docs/plans/2026-03-14-feat-unstuck-sensei-tauri-desktop-mvp-plan.md` (Phase 4)
- Detection state machine: `src-tauri/src/detection/mod.rs` — effects pattern, suppression system
- Detection platform: `src-tauri/src/detection/platform.rs:162` — `spawn_idle_polling` tick loop pattern
- Commands: `src-tauri/src/commands.rs` — Tauri command signatures
- App setup: `src-tauri/src/lib.rs:187-188` — managed state and command registration
- Session flow hook: `src/hooks/useSessionFlow.ts:30-35` — `SessionStage` type, `deriveStage` function
- Detection hook: `src/hooks/useDetection.tsx` — Context + Provider + event listener pattern to replicate
- Confirmed card placeholder: `src/components/session/ConfirmedCard.tsx` — "Phase 4 will turn this into the real timer start"
- Session records: `src/lib/session-records.ts:90-106` — `loadActiveSessionDraft` with `timer_started_at IS NULL` filter
- Database types: `src/lib/database.types.ts:145-148` — timer columns already defined
- Tray menu: `src-tauri/src/lib.rs:36` — `build_tray_menu()`, `sync_tray_menu()`
