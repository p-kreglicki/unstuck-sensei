---
title: "feat: Rust Timer and Check-in"
type: feat
date: 2026-03-19
---

# feat: Rust Timer and Check-in

## Overview

Implement a 25-minute work timer that runs entirely in Rust, plus a check-in flow that lets the user report whether they got started. Persist timer blocks durably in Supabase so the initial timer and the one allowed extension are modeled as distinct work blocks, not aggregate duration math. This completes the end-to-end session loop: stuck input -> energy -> AI steps -> timer -> check-in.

## Problem Statement / Motivation

The coaching session currently ends at step confirmation (`ConfirmedCard`). Without a timer, the user has no structured work block, no completion signal, and no feedback loop. The timer is the mechanism that converts intention ("I'll work on step 1") into action (a bounded 25-minute block with a clear start and end).

The timer must live in Rust because:
- JavaScript timers in a webview are unreliable when the window is hidden or minimized.
- The tray menu needs to show timer state regardless of window visibility.
- Native notifications on timer completion must fire even if the user never reopened the window.
- Detection suppression while the timer session is active must be coordinated in the same Rust process.

## Proposed Solution

A Rust `TimerState` module following the same effects-based state machine pattern as the detection engine, backed by a local snapshot and a small pending-sync outbox. Supabase stores durable session history plus block-level timer records. The frontend gets a `useTimer` context provider that mirrors `useDetection`, and `useSessionFlow` renders from the latest timer block plus the current Rust timer status. Two new session stages (`timer` and `checkin`) extend the existing flow.

## Technical Approach

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Time source | `chrono::Utc::now()` wall-clock deadline per timer block | `Instant` does not advance during macOS sleep. Wall-clock means "25 real minutes" regardless of sleep. On wake, if the current block deadline passed, fire completion immediately. |
| Durable timing model | Store timer blocks in `session_timer_blocks`; session row stores summary fields | Extension starts at click time, so `timer_started_at + timer_duration_seconds` is not sufficient to recover deadlines once a second block exists. |
| Extension semantics | One extension, +25 minutes starting when the user clicks extend | This matches user expectation of "keep going now" and avoids retroactive deadline math. |
| Live runtime authority | Rust owns the current block deadline, tray state, notification timing, and suppression | These behaviors must remain correct while the UI is hidden or not mounted. |
| Durable persistence authority | Supabase owns session history and timer block records | Recovery, history, and future analytics should come from durable state, not runtime-only memory. |
| Lifecycle coordination | Explicit compensation with a single timer coordination path and durable outbox replay | "Both own part of it" is only safe if transitions, ordering, and retries are explicit and centralized. |
| Crash / relaunch recovery | Split recovery | Rust restores runtime immediately from a local snapshot at app startup. After auth/bootstrap, the frontend reconciles Supabase state with Rust state and renders `timer` or `checkin`. |
| Timer pause | No pause for MVP | Pomodoro tradition. Simplifies state machine. User can cancel and start a new session if interrupted. |
| Concurrent sessions | Blocked while the timer session is unresolved and still inside the check-in grace window | While a timer is running, or while check-in is still fresh, all entry points should show the existing session rather than start a new one. |
| Quit mid-timer | Recover from local snapshot + durable block history | No special quit flow is needed if startup recovery and outbox replay are correct. |
| Notification click | Activate app, show the current timer state | If the timer is still running, show the timer. If the block has ended, show check-in. |
| Uncollected check-in | 12-hour grace window, then degrade to non-blocking incomplete recovery | Detection should not stay suppressed forever because of an abandoned check-in. After 12 hours from block end, clear local suppression, stop blocking new sessions, and replay a durable `expire_timer_checkin(...)` mutation that marks the session `incomplete`. |
| Post-check-in destination | Inline completion summary and home redirect | History remains Phase 5 in the parent MVP plan, so Phase 4 should not depend on a real history page existing yet. |

### Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                            Rust Backend                              │
│                                                                      │
│  timer/mod.rs                                                        │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ TimerState                                                    │   │
│  │ - status: Idle | Running | AwaitingCheckin                    │   │
│  │ - session_id: Option<Uuid>                                    │   │
│  │ - current_block_id: Option<Uuid>                              │   │
│  │ - current_block_kind: Option<Initial | Extension>             │   │
│  │ - block_started_at: Option<DateTime<Utc>>                     │   │
│  │ - deadline: Option<DateTime<Utc>>                             │   │
│  │ - duration_secs: u32                                           │   │
│  │ - extended: bool                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│            │                                                         │
│            │ tick loop (1s interval)                                 │
│            ▼                                                         │
│  TimerRuntimeEffect                                                  │
│  - EmitStateChanged                                                  │
│  - SendNotification                                                  │
│  - SyncTrayMenu                                                      │
│  - SetDetectionSuppression(bool)                                     │
│  - PersistSnapshot                                                   │
│  - EnqueuePendingSync                                                │
│                                                                      │
│  Local persistence                                                   │
│  - timer snapshot (current runtime state)                            │
│  - pending sync outbox (timer completion / tray stop replay)         │
│                                                                      │
│  detection/mod.rs                                                    │
│  - SuppressionReason::TimerRunning (already exists)                  │
│  - New: set_timer_suppression(active: bool)                          │
└──────────┬───────────────────────────────────────────────────────────┘
           │ events: "timer-state-changed"
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          React Frontend                              │
│                                                                      │
│  useTimer.tsx                                                        │
│  - listen("timer-state-changed")                                     │
│  - invoke("start_timer"), invoke("stop_timer"), invoke("extend_timer")│
│  - invoke("resolve_checkin"), invoke("get_timer_state")              │
│                                                                      │
│  Timer persistence / reconciliation                                  │
│  - flush pending outbox entries after auth is ready                  │
│  - call transactional Supabase RPCs for start / extend / check-in    │
│  - reconcile durable latest-block state with Rust runtime state      │
│                                                                      │
│  useSessionFlow.ts                                                   │
│  - New stages: "timer" | "checkin"                                   │
│  - Render from latest timer block + Rust timer state                 │
│                                                                      │
│  Components                                                          │
│  - Timer.tsx (countdown display, stop button)                        │
│  - CheckIn.tsx (yes/somewhat/no + extend button)                     │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                              Supabase                                │
│                                                                      │
│  sessions                                                            │
│  - summary fields: timer_started_at, timer_ended_at, checked_in_at   │
│  - feedback, status, timer_extended, timer_duration_seconds          │
│  - timer_revision                                                    │
│                                                                      │
│  session_timer_blocks                                                │
│  - one initial block + optional one extension block                  │
│  - exact started_at / ended_at for each block                        │
│                                                                      │
│  RPCs (transactional)                                                │
│  - start_timer_block                                                 │
│  - complete_timer_block                                              │
│  - start_extension_block                                             │
│  - stop_timer_block                                                  │
│  - check_in_timer_session                                            │
│  - revert_timer_start / revert_extension_start                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Session Stage Flow (Updated)

```
compose -> energy -> clarifying -> steps -> timer -> checkin -> (done)
                                          │         │
                                          │    extend (once, starts a new block now)
                                          │         │
                                          ◄─────────┘
```

The `confirmed` stage and `ConfirmedCard` are replaced. Confirming steps now directly starts the timer. There is no intermediate "confirmed but not yet timing" state. The `StepsList` confirm button becomes the timer start trigger.

After check-in, Phase 4 ends with an inline completion summary and a redirect back to `/`. Session history remains Phase 5 scope from the parent MVP plan.

### Data Model

Schema changes are required now. That is preferable to leaving extension and recovery semantics ambiguous.

#### `sessions`

| Column | Type | Usage |
|---|---|---|
| `timer_started_at` | timestamptz | Start of the first timer block |
| `timer_ended_at` | timestamptz | End of the latest completed block; reset to `null` when a new extension block starts |
| `checked_in_at` | timestamptz | New. Set only when the user submits feedback |
| `timer_duration_seconds` | integer | Summary total across started blocks: `1500` initially, `3000` after extension. Never used for deadline recovery |
| `timer_extended` | boolean | Set to `true` once the extension block starts |
| `feedback` | text | `yes` / `somewhat` / `no` — set only at check-in |
| `status` | text | `active` while running or awaiting check-in, `completed` after check-in, `incomplete` after early stop |
| `timer_revision` | integer | New. Monotonic optimistic concurrency token for timer lifecycle mutations |

#### `session_timer_blocks`

| Column | Type | Usage |
|---|---|---|
| `id` | uuid | Primary key |
| `session_id` | uuid | FK to `sessions.id` |
| `block_index` | integer | `1` for the initial block, `2` for the extension block |
| `kind` | text | `initial` or `extension` |
| `started_at` | timestamptz | Exact block start timestamp |
| `ended_at` | timestamptz nullable | Exact block end timestamp; `null` while block is running |
| `duration_seconds` | integer | `1500` for both initial and extension blocks in MVP |
| `created_at` | timestamptz | Audit / ordering support |

#### Schema Constraints

- `unique(session_id, block_index)` so block ordering is deterministic
- partial uniqueness so each session can have at most one `kind = 'extension'`
- check constraint on `kind in ('initial', 'extension')`
- all session + block timer writes go through transactional RPCs, not ad hoc multi-step patches from the UI

#### Access Control And RLS

- enable RLS on `session_timer_blocks`
- add a `SELECT` policy that allows authenticated users to read blocks only for sessions they own
- do not grant ad hoc client `INSERT` / `UPDATE` / `DELETE` access to `session_timer_blocks`
- make timer lifecycle RPCs the only write path for timer blocks, with each RPC validating that `auth.uid()` owns the target session before mutating rows

#### Source of Truth Rule

`session_timer_blocks` is the source of truth for timer deadline recovery. The `sessions` row holds summary/filter fields and current lifecycle status, but `useSessionFlow` and startup reconciliation must always look at the latest block rather than infer state from `timer_duration_seconds`.

### Timer State Contract

| Derived State | Durable Shape | Runtime Shape |
|---|---|---|
| `running` | latest block `ended_at IS NULL`, `checked_in_at IS NULL`, `status = 'active'` | Rust `TimerState.status = Running` |
| `awaiting_checkin` | latest block `ended_at IS NOT NULL`, `checked_in_at IS NULL`, `status = 'active'` | Rust `TimerState.status = AwaitingCheckin` |
| `completed` | `checked_in_at IS NOT NULL`, `feedback IS NOT NULL`, `status = 'completed'` | Rust `TimerState.status = Idle` |
| `incomplete` | `status = 'incomplete'` | Rust `TimerState.status = Idle` |

### Consistency Guardrails

To keep the split Rust/Supabase model from drifting, the implementation must enforce these rules:

1. One timer coordination path owns lifecycle mutations. Components should not patch `sessions` or `session_timer_blocks` directly.
2. All durable timer writes use transactional Supabase RPCs that mutate the session row and block row together.
3. Every timer RPC accepts `expected_revision` and bumps `timer_revision` on success.
4. Every transition is idempotent or replay-safe. Re-running a completion or stop sync after a crash should converge, not duplicate work.
5. Rust persists a local timer snapshot plus a pending-sync outbox so timer completion and tray stop survive crashes even before the frontend flushes them to Supabase.
6. Rust startup recovery runs before the UI mounts so tray state and detection suppression are correct immediately.
7. `useSessionFlow` renders from the latest durable block plus Rust runtime state, never from `timer_started_at + timer_duration_seconds`.
8. During bootstrap reconciliation, durable state wins over stale local snapshot state, and outbox replay must discard intents already satisfied or contradicted by the latest durable block/session revision.

### Transition Table

All transitions below assume a transactional RPC layer for durable writes and `timer_revision` optimistic concurrency.

| Transition | Trigger / Preconditions | Durable Write Order | Rust Runtime Action | Compensation / Replay |
|---|---|---|---|---|
| Start initial block | User confirms steps; session has no timer blocks yet | RPC `start_timer_block(session_id, expected_revision, started_at, duration_seconds=1500)` inserts block 1 and updates session summary fields | `start_timer(session_id, block_id, started_at, duration_secs)` starts Rust deadline and turns suppression on | If Rust start fails after the RPC succeeds, call `revert_timer_start(...)` to remove block 1 and clear timer summary fields |
| Complete current block | Rust tick reaches deadline while block is running | Rust enqueues pending sync intent; frontend later flushes `complete_timer_block(block_id, expected_revision, ended_at)` | Rust transitions `Running -> AwaitingCheckin`, sends notification, keeps suppression on, persists snapshot | If Supabase write fails, keep the outbox intent and retry on focus / next launch until the block end is durable |
| Start extension block | User clicks "Keep going (+25 min)" while awaiting check-in; no extension block exists | RPC `start_extension_block(session_id, expected_revision, started_at, duration_seconds=1500)` inserts block 2, sets `timer_extended = true`, `timer_duration_seconds = 3000`, and resets `timer_ended_at = null` | `extend_timer(session_id, block_id, started_at, duration_secs)` starts a fresh Rust deadline for the extension block | If Rust start fails after the RPC succeeds, call `revert_extension_start(...)` to remove block 2 and restore `timer_ended_at` to block 1's end |
| Stop early | User clicks stop in the timer UI or tray while a block is running | Rust stops immediately and enqueues pending sync; frontend flushes `stop_timer_block(block_id, expected_revision, ended_at=now)` | Rust transitions `Running -> Idle`, clears suppression, clears active deadline, persists snapshot | If Supabase write fails, retry from the outbox. User intent is "stop now", so runtime stops first |
| Check in | User selects `yes` / `somewhat` / `no` while awaiting check-in | RPC `check_in_timer_session(session_id, expected_revision, checked_in_at, feedback)` sets `feedback`, `checked_in_at`, `status = 'completed'` | After durable success, `resolve_checkin()` transitions `AwaitingCheckin -> Idle`, clears suppression, clears snapshot | If Rust reset fails after durable success, enqueue a local reset-to-idle intent and replay it on next startup |
| Expire stale check-in | Startup / focus reconciliation finds latest ended block older than 12 hours and `checked_in_at` is still `null` | Frontend flushes `expire_timer_checkin(session_id, expected_revision, expired_at)` to set `status = 'incomplete'` | Rust clears `AwaitingCheckin`, clears suppression, persists `Idle`, and enqueues a stale-checkin sync if durable state has not caught up yet | If Supabase write fails, keep the expire intent in the outbox but do not restore suppression; retry on next focus / launch |

### Sleep/Wake Handling

On each tick, calculate `remaining = deadline - chrono::Utc::now()` for the current timer block. If `remaining <= 0`, fire completion immediately. This naturally handles:
- Short sleep: timer resumes with correct remaining time on wake.
- Long sleep (past deadline): timer fires completion immediately on wake.
- No drift accumulation since every tick recalculates from the absolute deadline.

### Split Recovery And Frontend Bootstrap

#### Rust Startup Recovery

Before the frontend mounts, Rust should:

1. Load the local timer snapshot.
2. If the snapshot says `Running` and `deadline > Utc::now()`, resume the timer runtime and tray state.
3. If the snapshot says `Running` and `deadline <= Utc::now()`, transition to `AwaitingCheckin`, enqueue a completion sync if one is not already pending, and show the check-in state on next app open.
4. If the snapshot says `AwaitingCheckin` and the block ended more than 12 hours ago, degrade to `Idle`, clear suppression, and keep or enqueue an `expire_timer_checkin` intent for later durable flush.
5. Re-apply timer suppression only while the timer session is unresolved and still inside the 12-hour check-in grace window.
6. Load and retain any pending outbox sync intents for the frontend to flush after auth is ready.

#### Outbox Replay Ordering

After auth is ready, frontend replay must happen in this order:

1. Fetch the durable active timer session and latest timer block before replaying any local intent.
2. Fetch Rust timer state plus the local pending-sync outbox.
3. If durable state already says `completed` or `incomplete`, clear any stale Rust snapshot and drop all pending intents for that session.
4. Drop any pending intent already reflected durably, such as a completion intent for a block whose `ended_at` is already set.
5. If multiple pending intents target the same session/block, keep only the highest `expected_revision` and discard older duplicates.
6. Replay the remaining intents in revision order before hydrating UI state.
7. Only after replay converges should `useSessionFlow` derive whether to render `timer`, `checkin`, or normal session bootstrap.

#### Frontend Reconciliation

Before loading a draft session, `useSessionFlow` must load the active timer session and its latest timer block, then compare that durable state with `get_timer_state()` from Rust:

1. If Rust says `Running`, render `timer`.
2. If Rust says `AwaitingCheckin`, render `checkin`.
3. If Rust is `Idle` but the latest durable block is open, hydrate Rust with the latest block and render `timer`.
4. If Rust is `Idle` and the latest durable block is ended, `checked_in_at` is `null`, and the block ended less than 12 hours ago, render `checkin`.
5. If the latest durable block is ended, `checked_in_at` is `null`, and the block ended 12 hours ago or earlier, enqueue `expire_timer_checkin(...)`, do not restore check-in, and allow normal session bootstrap.
6. If durable state is `completed` or `incomplete`, do not restore the timer UI.

### Tray Menu During Timer

Replace the current menu items when the timer session is unresolved:

| Normal Menu | Running Menu | Awaiting Check-in Menu |
|---|---|---|
| Start Session | ~~Start Session~~ (removed) | ~~Start Session~~ (removed) |
| Pause Detection | ~~Pause Detection~~ (hidden, detection suppressed) | ~~Pause Detection~~ (hidden, detection suppressed) |
| — | Timer: `MM:SS` remaining (disabled, informational) | Timer complete (disabled, informational) |
| — | Stop Timer | Open Check-in |
| Settings | Settings | Settings |
| Quit | Quit | Quit |

`sync_tray_menu()` should read both detection state and timer state, and build the correct menu for `Running` and `AwaitingCheckin`.

## Implementation Phases

### Phase 4a: Schema And Durable Timer Contract

**Goal:** Add the schema and transactional persistence needed for block-level timing and explicit compensation.

**Tasks:**

- [x] Add `checked_in_at timestamptz` and `timer_revision integer not null default 0` to `sessions`
- [x] Create `session_timer_blocks`
  - `id`, `session_id`, `block_index`, `kind`, `started_at`, `ended_at`, `duration_seconds`, `created_at`
- [x] Add DB constraints
  - `unique(session_id, block_index)`
  - at most one extension block per session
  - check constraints for valid `kind`
- [x] Enable RLS and ownership-based access for `session_timer_blocks`
  - `SELECT` policy for session owners
  - no direct client write policies for timer blocks
- [x] Define transactional RPCs for lifecycle mutations
  - `start_timer_block`
  - `complete_timer_block`
  - `start_extension_block`
  - `stop_timer_block`
  - `check_in_timer_session`
  - `expire_timer_checkin`
  - `revert_timer_start`
  - `revert_extension_start`
- [x] Ensure every timer RPC accepts `expected_revision`, bumps `timer_revision`, and validates session ownership before mutating timer rows
- [x] Regenerate `src/lib/database.types.ts`

### Phase 4b: Rust Timer Runtime And Local Recovery

**Goal:** Timer starts, ticks, completes, restores, and extends in Rust with full state-machine coverage.

**Tasks:**

- [x] Create `src-tauri/src/timer/mod.rs` with `TimerState`
  - Fields: `status` (`Idle | Running | AwaitingCheckin`), `deadline`, `session_id`, `current_block_id`, `block_started_at`, `checkin_started_at`, `duration_secs`, `extended`
  - Methods: `start(...)`, `stop()`, `tick()`, `extend(...)`, `resolve_checkin()`, `hydrate_running(...)`, `hydrate_awaiting_checkin(...)`, `get_status()`
  - Each mutation returns `Vec<TimerRuntimeEffect>`
- [x] Define `TimerRuntimeEffect`
  - `EmitStateChanged`
  - `SendNotification`
  - `SyncTrayMenu`
  - `SetDetectionSuppression(bool)`
  - `PersistSnapshot`
  - `EnqueuePendingSync`
- [x] Define `TimerStatusResponse` serde payload for the frontend
  - Fields: `status`, `remaining_secs`, `session_id`, `current_block_id`, `extended`, `duration_secs`
- [x] Implement snapshot persistence and pending-sync outbox storage
- [x] Implement `execute_timer_effects()` in `timer/mod.rs`
  - Emit `"timer-state-changed"`
  - Fire native notification on completion
  - Call `sync_tray_menu()` only when timer-visible tray state changes or the displayed minute bucket changes
  - Insert/remove `SuppressionReason::TimerRunning`
  - Persist snapshot / outbox changes
- [x] Add `set_timer_suppression(active: bool)` to `DetectionState`
- [x] Spawn a 1-second tick loop using `tauri::async_runtime::spawn` + `tokio::time::interval`
  - On each tick: lock `TimerState`, call `tick()`, execute effects
  - `tick()` calculates `remaining = deadline - Utc::now()`
  - Loop exits when status is `Idle` or `AwaitingCheckin`
- [x] Register `Mutex<TimerState>` as managed state in `lib.rs`
- [x] On app startup, restore runtime from the local timer snapshot before the frontend mounts
- [x] Write unit tests for the state machine
  - Start -> tick -> AwaitingCheckin flow
  - Start -> stop flow
  - Start -> AwaitingCheckin -> extend -> AwaitingCheckin flow
  - Start -> AwaitingCheckin -> resolve_checkin -> Idle flow
  - Double-start rejected
  - Extend when not awaiting check-in rejected
  - Second extension rejected
  - Tick with past deadline fires immediate completion on restore
  - Awaiting check-in older than 12 hours clears suppression and enqueues stale-expire replay

### Phase 4c: Tauri Commands, Tray Integration, And Runtime Coordination

**Goal:** Frontend can control the timer via commands, tray menu reflects timer state.

**Tasks:**

- [x] Add Tauri commands in `src-tauri/src/commands.rs`
  - `start_timer(session_id: String, block_id: String, started_at: String, duration_secs: u32)` -> starts Rust runtime after durable success
  - `stop_timer()` -> cancels timer, returns `TimerStatusResponse`
  - `extend_timer(session_id: String, block_id: String, started_at: String, duration_secs: u32)` -> starts the extension runtime after durable success
  - `resolve_checkin()` -> resets `AwaitingCheckin` to `Idle` after durable feedback save
  - `get_pending_timer_syncs()` / `clear_pending_timer_syncs()` for outbox replay
  - `get_timer_state()` -> returns current `TimerStatusResponse`
- [x] Register all timer commands in `generate_handler![]` in `lib.rs`
- [x] Update `build_tray_menu()` to accept timer state
  - `Running`: show `Timer: MM:SS` + `Stop Timer`
  - `AwaitingCheckin`: show `Timer complete` + `Open Check-in`
  - hide `Start Session` and `Pause Detection` while unresolved
- [x] Update `sync_tray_menu()` to read both `Mutex<DetectionState>` and `Mutex<TimerState>`
- [x] Add a concrete tray rebuild gate for timer mode
  - no per-second rebuilds while countdown seconds change inside the same displayed minute
  - still rebuild immediately on `Running` / `AwaitingCheckin` / `Idle` transitions
- [x] Handle tray menu clicks
  - `Stop Timer` stops Rust immediately and enqueues a durable stop sync
  - `Open Check-in` opens the app to the unresolved session
- [x] Keep quit behavior simple — startup recovery and outbox replay handle mid-session exits

### Phase 4d: Frontend Timer UI And Session Flow

**Goal:** User sees a countdown, can stop the timer, and the timer persists across navigation.

**Tasks:**

- [x] Create `src/hooks/useTimer.tsx` — Context + Provider pattern matching `useDetection.tsx`
  - `listen("timer-state-changed")` for tick updates
  - Wrap `invoke("start_timer")`, `invoke("stop_timer")`, `invoke("extend_timer")`, `invoke("resolve_checkin")`, `invoke("get_timer_state")`
  - `isTauri()` guard for browser dev mode
  - Fetch initial state on mount and on window focus
- [x] Add `TimerProvider` to the provider tree in `src/main.tsx`
- [x] Replace `"confirmed"` with `"timer"` and add `"checkin"` to the `SessionStage` type in `useSessionFlow.ts`
- [x] Remove `ConfirmedCard.tsx` — its role is absorbed by the timer start action
- [x] Add new session-record queries in `src/lib/session-records.ts`
  - `loadActiveTimerSession()`
  - `loadLatestTimerBlock(sessionId)`
  - `loadTimerBlocks(sessionId)` if needed for debugging / future history
- [x] Update `useSessionFlow` bootstrap
  - On mount: load the active timer session + latest block before draft loading
  - Compare durable latest-block state with `get_timer_state()`
  - If Rust is running or latest block is open -> show `"timer"`
  - If Rust is awaiting check-in, or the latest block is ended with `checked_in_at = null` and still inside the 12-hour grace window -> show `"checkin"`
  - Otherwise -> proceed with draft loading logic
- [x] Update `deriveStage()` in `useSessionFlow.ts` to handle timer/checkin stages
- [x] Update `Session.tsx` to render `Timer` component for `"timer"` stage and `CheckIn` for `"checkin"` stage
- [x] Build `src/components/session/Timer.tsx`
  - Large countdown display (MM:SS)
  - Current first step reminder text (from session steps JSONB)
  - "Stop" button -> confirms cancellation -> invokes `stop_timer` immediately -> flushes durable `stop_timer_block` sync
  - Warm, encouraging copy (e.g., "You're working on: [first step]")
- [x] Update `handleConfirm` in `useSessionFlow.ts`
  - Call transactional `start_timer_block` RPC first
  - Invoke `start_timer` with the returned `block_id` and `started_at`
  - Transition directly to `"timer"` stage

### Phase 4e: Check-in, Extension, And Durable Reconciliation

**Goal:** User can check in after timer completion, extend once from the check-in state, and recover cleanly after any failure boundary.

**Tasks:**

- [x] Build `src/components/session/CheckIn.tsx`
  - Show timer completion message ("Time's up! How did it go?")
  - Three feedback buttons: "Yes, I got started" / "Somewhat" / "Not really"
  - Separate "Keep going (+25 min)" button — only shown if `timer_extended` is false
  - On feedback selection: call transactional `check_in_timer_session(...)`, then invoke `resolve_checkin()`, then show inline completion summary / redirect home
  - On extend: call transactional `start_extension_block(...)`, then invoke `extend_timer(...)`, then transition back to `"timer"`
- [x] Update `useSessionFlow` to handle timer completion event
  - Listen for timer completion from `useTimer` context
  - Auto-transition from `"timer"` to `"checkin"` stage
- [ ] Handle native notification on timer completion
  - Notification text: "Time's up! How did it go?" (warm, not aggressive)
  - Clicking notification -> show window -> frontend is already on `"checkin"` stage (or transitions to it)
- [x] Save `incomplete` status when user stops timer early
  - durable stop sync sets `timer_ended_at = now`, `status = 'incomplete'`
  - Rust timer state is already idle from the immediate stop
  - Redirect to home after durable save or queued replay acknowledgement
- [x] Implement outbox flush after auth/session bootstrap
  - load durable latest-block state before replaying local intents
  - drop stale or already-applied intents before replay
  - replay surviving intents in revision order
  - complete-block syncs
  - tray stop syncs
  - stale-checkin expire syncs
  - check-in idle-reset syncs if needed
- [x] Ensure detection suppression is cleared only when the timer session is resolved
  - `Running` and `AwaitingCheckin` keep suppression on
  - `stop()` and `resolve_checkin()` clear suppression
- [x] Degrade stale uncollected check-ins after 12 hours
  - on startup/focus, if the latest ended block is still unchecked after 12 hours, clear suppression locally
  - enqueue or flush `expire_timer_checkin(...)`
  - do not block new sessions once the stale-checkin degradation path is active

### Phase 4f: Edge Cases, Recovery, And Verification

**Goal:** Handle recovery, navigation, and quit gracefully.

**Tasks:**

- [x] Implement Rust startup recovery from the local timer snapshot
  - Resume `Running` if deadline is still in the future
  - Convert to `AwaitingCheckin` if deadline already passed and the 12-hour grace window is still open
  - Convert to `Idle` + stale-expire replay if the check-in grace window already expired
- [x] Implement frontend reconciliation using the latest durable timer block
  - If Rust is idle but latest block is still open -> hydrate Rust and render timer
  - If Rust is running but durable state says completed / incomplete -> clear Rust and outbox
  - If the latest block is ended and `checked_in_at` is null inside the 12-hour grace window -> render check-in
  - If the latest block is ended and `checked_in_at` is null outside the grace window -> expire the stale check-in and do not block normal bootstrap
- [x] Handle navigation away during timer
  - `useTimer` context is app-wide (in `src/main.tsx`), not page-scoped
  - When user navigates to `/settings` and back to `/`, `useSessionFlow` bootstrap detects running timer and shows timer UI
- [x] Handle "Start Session" entry points during timer
  - Tray "Start Session" is hidden while unresolved (Phase 4c)
  - If email deep link or other entry point tries to start a session, redirect to the running timer
- [ ] Verify extension gap handling
  - Let block 1 end
  - Wait several minutes
  - Click extend
  - Verify block 2 gets a fresh `started_at` and full 25-minute deadline
- [ ] Test timer accuracy across sleep/wake cycles

## Acceptance Criteria

### Functional Requirements

- [x] Timer starts when user confirms steps (25-minute default)
- [x] Countdown ticks every second in the UI
- [ ] Timer continues running when the window is hidden or minimized
- [ ] Timer completion fires a native notification
- [x] User can check in with yes / somewhat / no after completion
- [x] User can extend the timer once by +25 minutes starting from the moment they click extend
- [x] User can stop the timer early (session marked incomplete)
- [x] Stuck detection is suppressed while the timer session is unresolved
- [x] Detection resumes when the timer session is resolved by early stop or check-in
- [x] Detection does not stay suppressed forever because of an abandoned check-in; after 12 hours the stale-checkin degradation path clears suppression and stops blocking new sessions
- [x] Tray menu shows timer state during `Running` and a check-in entry point during `AwaitingCheckin`
- [x] Navigating away and back preserves the timer UI
- [x] App relaunch restores timer runtime from the local snapshot, then reconciles durable state after auth
- [ ] Quitting or crashing mid-timer is recovered on next launch (resume or check-in)
- [x] Extension recovery uses the latest timer block, not aggregate session duration math
- [x] Partial session state is saved at each step
- [x] Check-in ends with an inline completion summary / home redirect rather than a dependency on Phase 5 history UI

### Non-Functional Requirements

- [ ] Timer accuracy within ~1 second over a 25-minute session
- [ ] Timer handles system sleep/wake correctly (wall-clock deadline)
- [x] No content logging or new privacy-sensitive data collection
- [x] Warm, encouraging copy — no productivity jargon
- [x] Timer lifecycle mutations are replay-safe across crashes and retries
- [x] Recovery ordering between durable state, local snapshot, and outbox intents is deterministic

### Quality Gates

- [x] Rust state machine has unit tests for all transitions
- [ ] Timer tested while window is visible, hidden, and tray-only
- [ ] Timer tested across sleep/wake (manual verification)
- [ ] Crash recovery tested: kill process mid-timer, relaunch, verify recovery
- [x] Extension tested: extend once, verify second extension blocked
- [ ] Extension tested after a delayed check-in: block 2 still gets a full 25 minutes
- [ ] Check-in data persists correctly to Supabase
- [ ] `session_timer_blocks` reflects exact start/end times for both initial and extension blocks
- [ ] `session_timer_blocks` reads are protected by RLS and timer writes still succeed through the approved RPC path
- [ ] Detection suppression verified: no nudges fire while the timer session is unresolved
- [ ] Tray menu items update correctly for `Running` and `AwaitingCheckin`
- [ ] Outbox replay tested: completion and tray stop survive frontend absence / app restart
- [ ] Outbox replay tested: stale or conflicting intents are discarded deterministically against durable state
- [ ] Tray rebuild cadence tested: timer countdown does not trigger per-second tray rebuilds
- [ ] Stale uncollected check-in tested: after 12 hours, suppression clears and normal session entry points resume
- [ ] Transactional RPCs reject stale `timer_revision` writes cleanly

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `Instant` not advancing during macOS sleep causing drift | High | High | Use `chrono::Utc::now()` wall-clock deadlines per block and recalculate on every tick |
| Extension modeled as aggregate duration instead of a fresh block | High | High | Make `session_timer_blocks` the source of truth and start extension blocks with their own `started_at` |
| Rust and Supabase drift after partial failure | Medium | High | Transactional RPCs, `timer_revision`, local snapshot, and ordered outbox replay that prefers durable state over stale local state |
| Tray menu rebuild on every tick is expensive | Medium | Low | Only rebuild tray menu when visible state changes or remaining minute changes |
| Timer tick loop outlives the timer (resource leak) | Low | Low | Exit loop when status is not `Running`; use a cancellation guard if needed |
| Recovery logic depends on UI math instead of latest durable block | Medium | High | `useSessionFlow` must query the latest block and ask Rust for runtime state before deriving stages |
| Abandoned check-in suppresses detection indefinitely | Medium | High | After 12 hours, clear suppression locally, stop blocking new sessions, and replay `expire_timer_checkin(...)` until durable state converges |

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
- Provider tree: `src/main.tsx` — where `TimerProvider` should be mounted alongside `DetectionProvider`
