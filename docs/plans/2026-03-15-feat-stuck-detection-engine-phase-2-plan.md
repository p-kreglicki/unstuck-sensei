---
title: "feat: Stuck Detection Engine"
type: feat
date: 2026-03-15
---

# feat: Stuck Detection Engine

## Overview

Build the background stuck detection engine that monitors app-switch frequency and idle time, nudges the user with native notifications, and bridges into the coaching session flow. The engine runs entirely in Rust, processes only high-level signals (no content logging), and respects multiple suppression conditions.

This is Phase 2 of the Unstuck Sensei MVP. Phase 1 (auth, tray, auto-launch) is complete.

## Problem Statement / Motivation

The core product hypothesis is that a desktop app present at the moment of friction can trigger more coaching sessions than a tool the user must remember to open. The detection engine is what makes this possible — it watches for signs the user is stuck (rapid app switching with low idle time) and nudges them before they spiral further.

Without this, Unstuck Sensei is just another app the founder has to remember to open. The detection engine is the differentiator.

## Proposed Solution

A Rust-based detection engine that:

1. Monitors app switches via macOS `NSWorkspace.didActivateApplicationNotification` (event-driven, zero CPU when idle)
2. Polls system idle time via IOKit `HIDIdleTime` every 5 seconds
3. Evaluates a sliding time window against configurable thresholds
4. Respects suppression conditions (meetings, manual pause, cooldown, timer, signed out)
5. Sends native notifications via `tauri-plugin-notification`
6. Exposes state and controls to the React frontend via Tauri commands and events

Windows support (`SetWinEventHook` + `GetLastInputInfo`) is deferred to Phase 7 polish. macOS is the primary development platform.

## Technical Approach

### State Machine

The detection engine is a state machine with 6 states:

```
┌──────────┐   user enables + signed in   ┌────────┐
│ Disabled │ ────────────────────────────→ │ Active │
│          │ ←──────────────────────────── │        │
└──────────┘   user disables / signs out   └───┬────┘
                                               │
                            threshold exceeded │
                            + idle < 120s      │
                            + no suppression   ▼
                                          ┌──────────┐
                                          │ Notifying │
                                          └─────┬─────┘
                                                │ user dismisses OR
                                                │ notification auto-expires
                                                ▼
                                          ┌──────────┐
                                          │ Cooldown │──→ Active (after 30 min)
                                          └──────────┘
                    │
    Active ←────────┤
                    │
                    │  meeting app / timer running
                    │         ▼
                    │   ┌────────────┐
                    │   │ Suppressed │──→ Active (when all conditions clear)
                    │   └────────────┘
                    │
                    │  user clicks "Pause Detection"
                    │         ▼
                    │   ┌────────┐
                    └── │ Paused │──→ Active (after 2 hours or manual resume)
                        └────────┘
```

**Key transition rules:**

- **Disabled → Active**: User is signed in AND detection is enabled in profile settings.
- **Active → Notifying**: Threshold exceeded AND idle < 120s AND no active suppression.
- **Notifying → Cooldown**: User dismisses notification OR notification auto-expires after 60s. Both paths enter cooldown to prevent re-triggering.
- **Notifying → Cooldown (via nudge)**: User opens app and sees nudge prompt. Whether they start a session or dismiss, the engine is already in cooldown.
- **Cooldown → Active**: 30 minutes elapsed.
- **Active → Suppressed**: Any suppression condition becomes true (meeting app, timer, app is foregrounded).
- **Suppressed → Active**: ALL suppression conditions are false (conditions are OR-ed).
- **Active → Paused**: User clicks "Pause Detection" in tray.
- **Paused → Active**: 2 hours elapsed OR user clicks "Resume Detection".
- **Any → Disabled**: User signs out or disables detection in settings.
- **Cooldown + "Pause Detection"**: Pause overrides cooldown. Resume after 2 hours (not 30 min).
- **Sleep/Wake**: Clear the sliding window on wake. Pause timers do NOT count sleep time.

### Detection Algorithm

```
Sliding window: 5 minutes (fixed for MVP)

Thresholds by sensitivity:
  Low:    12 switches in 5 min
  Medium:  8 switches in 5 min
  High:    5 switches in 5 min

Trigger condition:
  app_switches_in_window >= threshold
  AND max_idle_in_window < 120 seconds
  AND state == Active
```

**Sliding window implementation**: Store timestamped app-switch events in a `VecDeque<Instant>`. On each evaluation tick (every 5s), drop events older than 5 minutes from the front.

**Why idle < 120s matters**: High switching + high idle means the user stepped away (not stuck). High switching + low idle means they're bouncing between apps (stuck).

### Stuck Nudge UX

`tauri-plugin-notification` does not support click callbacks on desktop. Clicking a notification only brings the app to the foreground — there is no way to distinguish a notification click from a manual tray open.

Instead of auto-routing to a session page, the app shows a **soft nudge prompt** when the user opens the app while a recent stuck detection is active:

1. When stuck is detected, send a native notification and set `last_stuck_detected_at: Option<Instant>` in managed state.
2. When the frontend mounts or the window becomes visible, it calls `get_detection_status`. If `last_stuck_detected_at` is within the last 5 minutes, the response includes `nudge_active: true`.
3. The frontend shows a dismissible banner on whatever page the user is on: **"Looks like you were bouncing around. Want to talk it through?"** with a "Start session" button.
4. If the user clicks "Start session", navigate to the session page (once it exists in Phase 3). If they dismiss, clear the nudge.
5. The nudge clears automatically after 5 minutes or when cooldown expires.

This avoids misattribution: a manual app open during the nudge window shows a prompt the user can ignore, rather than hijacking navigation.

### Suppression Conditions

All suppression conditions are independent booleans. Detection is suppressed when ANY is true:

| Condition | How Set | How Cleared |
|---|---|---|
| Meeting app in foreground | App-switch event matches meeting bundle ID | App-switch event to non-meeting app |
| Work timer running | Timer start command (Phase 4) | Timer complete/stop (Phase 4) |
| App is foregrounded | Main window becomes visible | Main window hidden/closed |
| User signed out | Auth state change | User signs in |

**Meeting app bundle IDs (macOS):**

```
us.zoom.xos
com.microsoft.teams2
com.apple.FaceTime
com.webex.meetingmanager
```

Google Meet runs in the browser and cannot be detected without accessibility permissions. Skipped for MVP.

**System UI bundle IDs to exclude from switch counting (macOS):**

These are not suppression — they are filtered at the monitor level so they never increment the switch counter:

```
com.apple.Spotlight
com.apple.notificationcenterui
com.apple.controlcenter
com.apple.screensaver
```

### Notification Content

Title: **"Feeling stuck?"**
Body: **"Looks like you've been bouncing between apps. Want to talk it through?"**

Warm, peer-like tone consistent with the Unstuck Sensei voice. No productivity jargon.

**Daily cap**: Maximum 6 notifications per calendar day. After hitting the cap, continue tracking but stop notifying. Reset at midnight local time.

### Architecture

```
src-tauri/src/
  lib.rs              ← existing, add plugin + state init
  commands.rs          ← all Tauri commands (sync_detection_config, pause, resume, etc.)
  detection/
    mod.rs             ← DetectionState, state machine, evaluator, suppression
    platform.rs        ← macOS app-switch observer + idle time polling

src/
  hooks/
    useDetection.ts    ← frontend hook for detection state + events
```

### Rust Module Design

**`detection/mod.rs`** — State, transitions, evaluation, and suppression:

```rust
pub enum DetectionStatus {
    Disabled,
    Active,
    Notifying,
    Cooldown,
    Paused,
    Suppressed,
}

pub struct DetectionState {
    pub status: DetectionStatus,
    pub sensitivity: Sensitivity,
    pub enabled: bool,
    pub app_switches: VecDeque<Instant>,
    pub last_idle_seconds: u64,
    pub cooldown_remaining: Option<Duration>,
    pub pause_remaining: Option<Duration>,
    pub last_tick: Instant,
    pub suppression_reasons: HashSet<SuppressionReason>,
    pub notifications_today: u32,
    pub today_date: NaiveDate,
    pub last_stuck_detected_at: Option<Instant>,
}
```

**Timer semantics**: Cooldown and pause use `remaining: Duration` instead of absolute `Instant` deadlines. On each evaluation tick (every 5s), the engine subtracts elapsed time since `last_tick`. If the machine was asleep, no ticks ran, so no time is subtracted — sleep time is automatically excluded without any explicit sleep/wake handling for timers. Sleep/wake handling is still needed for clearing the sliding window.

Also contains:
- State machine: pure function `transition(current_state, event) -> (new_state, side_effects)`
- Evaluator: prune stale events, check threshold against sensitivity, return `ShouldNotify` or `NoAction`
- Suppression: `HashSet<SuppressionReason>` with `is_suppressed()` check — simple enough to live here, not a separate file
- Side effects: `SendNotification`, `StartCooldownTimer`, `EmitStateChanged`, etc.

**`detection/platform.rs`** — macOS monitoring (app switches + idle time):
- Set up `NSWorkspace.didActivateApplicationNotification` observer in `setup()`
- On each activation, push `Instant::now()` into the switch deque
- Filter out system UI bundle IDs (Spotlight, Notification Center, etc.)
- Extract `bundleIdentifier` for meeting suppression
- Poll IOKit `HIDIdleTime` every 5 seconds via tokio task
- Handle sleep/wake via `NSWorkspace.willSleepNotification` / `didWakeNotification`: clear sliding window on wake
- Runs observer on the main thread (macOS requirement for workspace notifications)

### Tauri Commands

All Tauri commands live in `src-tauri/src/commands.rs` (one file for all commands, including the existing tray auth command).

```rust
/// Replaces update_tray_auth_state. Frontend calls this on profile load and on
/// any settings change. This is the only way detection config reaches Rust.
#[tauri::command]
fn sync_detection_config(
    state: State<Mutex<DetectionState>>,
    app: AppHandle,
    signed_in: bool,
    enabled: bool,
    sensitivity: String,
) -> Result<(), String>

#[tauri::command]
fn get_detection_status(state: State<Mutex<DetectionState>>) -> DetectionStatusResponse

#[tauri::command]
fn pause_detection(state: State<Mutex<DetectionState>>) -> Result<(), String>

#[tauri::command]
fn resume_detection(state: State<Mutex<DetectionState>>) -> Result<(), String>

#[tauri::command]
fn dismiss_nudge(state: State<Mutex<DetectionState>>)
```

**Settings ownership contract**: The frontend owns persisted settings (Supabase `profiles`). Rust owns runtime state. The frontend pushes config into Rust via `sync_detection_config` on three occasions:
1. After initial profile load (on sign-in)
2. After any settings change in the Settings page
3. On sign-out (with `signed_in: false`)

`sync_detection_config` replaces the existing `update_tray_auth_state` command. It handles both tray menu updates and detection state transitions.

### Tauri Events (Rust → Frontend)

```rust
// Emitted when detection state changes
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectionStateChanged {
    status: String,        // "active", "paused", "cooldown", "suppressed", "disabled"
    resume_in_seconds: Option<u64>,  // for paused/cooldown states
    nudge_active: bool,    // true if a recent stuck detection should show the nudge prompt
}
```

### Frontend Hook — `useDetection.ts`

```typescript
interface DetectionState {
  status: 'active' | 'paused' | 'cooldown' | 'suppressed' | 'disabled';
  resumeInSeconds?: number;
  nudgeActive: boolean;
}

function useDetection(): {
  state: DetectionState;
  syncConfig: (config: { signedIn: boolean; enabled: boolean; sensitivity: string }) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  dismissNudge: () => Promise<void>;
}
```

Uses `listen()` for `detection-state-changed` events and `invoke()` for commands. Follows the same pattern as `useAuth.tsx` with `isTauri()` guards.

Note: `syncConfig` is called from `useAuth` after profile load and from Settings after changes. The hook itself does not call it automatically — the caller decides when config has changed.

### Tray Menu Integration

Update the existing tray menu in `lib.rs`:

- Enable `MENU_PAUSE_DETECTION` when detection is active
- Toggle label: "Pause Detection" ↔ "Resume Detection"
- Add handler in `on_menu_event` match arm
- Update menu item when state changes (requires rebuilding tray menu or using `set_text()`)

### Detection Startup Flow

On app launch (`tauri::Builder::setup()`):

1. Initialize `DetectionState` in `Disabled` status and register as managed state.
2. Start the macOS platform observer (app switches + idle polling) unconditionally — the observer runs for the app's lifetime, but evaluation is skipped while status is `Disabled`.
3. The frontend loads the user's profile from Supabase, then calls `sync_detection_config({ signedIn: true, enabled, sensitivity })`.
4. `sync_detection_config` updates the Rust state and transitions to `Active` if enabled, or stays `Disabled` if not.
5. On sign-out, the frontend calls `sync_detection_config({ signedIn: false, enabled: false, sensitivity: "medium" })`, which transitions to `Disabled` and rebuilds the tray menu.

The platform observer always runs. The state machine controls whether evaluations happen. Rust never reads from Supabase directly — all config flows through `sync_detection_config`.

### Persistence and Settings Ownership

**Frontend** owns persisted settings. Detection config (`enabled`, `sensitivity`) lives in the Supabase `profiles` table. The frontend reads and writes these values. On profile load and after any settings change, the frontend pushes the current config into Rust via `sync_detection_config`.

**Rust** owns runtime state. It never reads from or writes to Supabase. It receives config via `sync_detection_config` and applies it to the state machine immediately.

**Transient state** (sliding window, cooldown/pause durations, notification count) is intentionally NOT persisted — it resets on app restart. This is correct behavior: a fresh start after reboot should begin with a clean detection slate.

### Notification Permission Flow

1. On first sign-in, check `notification().permission_state()`
2. If `Unknown`, show an in-app explanation: "Unstuck Sensei can nudge you when you're stuck. Allow notifications?"
3. On user confirmation, call `notification().request_permission()` which triggers the macOS system prompt
4. If `Denied`, detection still runs but notifications are replaced with a tray icon badge/highlight (subtle visual indicator)
5. Store the "we asked" flag in `tauri-plugin-store` to avoid re-asking

## Implementation Phases

### Phase 2A: Rust Infrastructure (1-2 days)

**Goal**: Module structure, managed state, and Tauri commands compile and respond.

**Tasks:**

- [x] Refactor `lib.rs` — extract the existing `update_tray_auth_state` command into `commands.rs`. Keep `lib.rs` for builder setup and tray construction only.
  - `src-tauri/src/commands.rs`
- [x] Create `detection/` module structure with stub implementations
  - `src-tauri/src/detection/mod.rs` — state, state machine, evaluator, suppression
  - `src-tauri/src/detection/platform.rs` — macOS monitoring stubs
- [x] Define `DetectionState` struct and `DetectionStatus` enum (with `Duration`-based cooldown/pause)
- [x] Register `DetectionState` as Tauri managed state via `app.manage()`
- [x] Replace `update_tray_auth_state` with `sync_detection_config` command
- [x] Implement all 5 Tauri commands as stubs: `sync_detection_config`, `get_detection_status`, `pause_detection`, `resume_detection`, `dismiss_nudge`
- [x] Register commands in `generate_handler!`
- [x] Update `useAuth.tsx` to call `sync_detection_config` instead of `update_tray_auth_state`
- [x] Add `tauri-plugin-notification` to `Cargo.toml` and register plugin
- [x] Add `notification:default` to `capabilities/default.json`
- [ ] Verify the app compiles and commands respond from the frontend

**Success criteria**: `invoke("get_detection_status")` returns a valid response. `invoke("sync_detection_config", { signedIn: true, enabled: true, sensitivity: "medium" })` transitions state to Active. App compiles with new module structure.

### Phase 2B: macOS Monitoring (1-2 days)

**Goal**: App switches and idle time are tracked in real-time.

**Tasks:**

- [ ] Add macOS-specific dependencies to `Cargo.toml`:
  ```toml
  [target.'cfg(target_os = "macos")'.dependencies]
  objc2 = "0.6"
  objc2-foundation = { version = "0.3", features = ["NSNotification", "NSNotificationCenter", "NSString", "NSThread"] }
  objc2-app-kit = { version = "0.3", features = ["NSWorkspace", "NSRunningApplication"] }
  block2 = "0.6"
  core-foundation = "0.10"
  core-foundation-sys = "0.8"
  ```
- [ ] Implement `platform.rs` — app-switch observer
  - Subscribe to `NSWorkspace.didActivateApplicationNotification` during `setup()`
  - Push `Instant::now()` into the sliding window deque on each activation
  - Filter out system UI bundle IDs (Spotlight, Notification Center, etc.)
  - Extract `bundleIdentifier` for meeting suppression
  - Capture `AppHandle` clone in the notification block for state access
- [ ] Implement `platform.rs` — idle time polling
  - Poll IOKit `HIDIdleTime` every 5 seconds via `tokio::time::interval`
  - Link IOKit framework
  - Read `HIDIdleTime` property (nanoseconds → seconds)
- [ ] Implement `platform.rs` — sleep/wake handling
  - Subscribe to `NSWorkspace.willSleepNotification` / `didWakeNotification`
  - Clear sliding window on wake
- [ ] Start the platform observer unconditionally in `tauri::Builder::setup()` — evaluation is gated by the state machine, not observer startup
- [ ] Add a temporary debug command `get_detection_debug` that returns current switch count and idle seconds for verification

**Success criteria**: Rapidly switching apps increments the switch count. Idle seconds report correctly. Sleep/wake clears the window.

### Phase 2C: Evaluation and Notifications (1 day)

**Goal**: Stuck detection triggers notifications.

**Tasks:**

- [ ] Implement evaluator in `detection/mod.rs` — called every 5 seconds alongside idle polling
  - Prune events older than 5 minutes from `VecDeque`
  - Count remaining events against sensitivity threshold
  - Check idle < 120 seconds
  - Return `ShouldNotify` or `NoAction`
- [ ] Implement state machine in `detection/mod.rs` — pure transition function
  - All state transitions as described in the state machine section
  - Return side effects: `SendNotification`, `StartCooldown`, `EmitStateChanged`
- [ ] Send native notification when stuck detected:
  - Title: "Feeling stuck?"
  - Body: "Looks like you've been bouncing between apps. Want to talk it through?"
  - Set `last_stuck_detected_at` to `Some(Instant::now())`
- [ ] Implement cooldown using `cooldown_remaining: Duration` — decrement by elapsed time each tick
- [ ] Implement daily notification cap (max 6, reset at midnight)
- [ ] Emit `detection-state-changed` event on every state transition (includes `nudge_active` flag)

**Success criteria**: Rapid app switching triggers a notification. A second notification does not fire within 30 minutes. State changes are emitted to the frontend.

### Phase 2D: Suppression and Tray Integration (1 day)

**Goal**: False positives are mitigated and the tray reflects detection state.

**Tasks:**

- [ ] Implement suppression in `detection/mod.rs` — meeting app detection
  - Match `bundleIdentifier` against known meeting app IDs
  - Set/clear `SuppressionReason::MeetingApp` on app-switch events
- [ ] Suppress when main window is visible (app is foregrounded)
  - Use existing `window_visible: Arc<AtomicBool>` to set/clear `SuppressionReason::AppForegrounded`
- [ ] Implement manual pause from tray menu
  - Handle `MENU_PAUSE_DETECTION` click: transition to Paused, set `pause_remaining` to 2 hours
  - Toggle menu label: "Pause Detection" ↔ "Resume Detection"
- [ ] Verify sign-out stops detection via `sync_detection_config({ signedIn: false, ... })`
- [ ] Request notification permission on first sign-in
  - Check `permission_state()`, request if `Unknown`
  - Store "asked" flag in `tauri-plugin-store`

**Success criteria**: Zoom in foreground suppresses detection. Manual pause works with tray label toggle. Sign-out stops detection. Notification permission is requested once.

### Phase 2E: Frontend Integration (0.5 days)

**Goal**: The frontend can display detection state and show the nudge prompt.

**Tasks:**

- [ ] Create `src/hooks/useDetection.ts`
  - Listen to `detection-state-changed` events
  - Expose `syncConfig()`, `pause()`, `resume()`, `dismissNudge()` via `invoke()`
  - `isTauri()` guard for browser dev mode
- [ ] Update `useAuth.tsx` to call `syncConfig()` after profile load with `{ signedIn, enabled, sensitivity }`
- [ ] Build a dismissible nudge banner component
  - Shows when `nudgeActive` is true: "Looks like you were bouncing around. Want to talk it through?"
  - "Start session" button (placeholder — navigates to `/` until Phase 3 adds `/session`)
  - "Dismiss" button calls `dismissNudge()`
  - Auto-hides when `nudgeActive` becomes false
- [ ] Mount the nudge banner in `Layout.tsx` so it appears on any page

**Success criteria**: Frontend receives state change events. After a stuck detection notification, opening the app shows the nudge banner. Dismissing the banner clears the nudge state. The banner does not appear on normal app opens without a recent detection.

## Acceptance Criteria

### Functional Requirements

- [ ] App-switch frequency is monitored in the background via macOS NSWorkspace notifications
- [ ] System idle time is polled every 5 seconds via IOKit
- [ ] Stuck detection fires when switch count exceeds threshold AND idle < 120s in a 5-minute window
- [ ] Native macOS notification is sent with warm, non-judgmental copy
- [ ] Opening the app after a detection shows a dismissible nudge banner (not auto-routing)
- [ ] 30-minute cooldown after notification (both dismissal and auto-expiry enter cooldown)
- [ ] Maximum 6 notifications per calendar day
- [ ] Detection suppressed during native meeting apps (Zoom, Teams, FaceTime, WebEx)
- [ ] Detection suppressed when app main window is visible
- [ ] Manual pause from tray menu with 2-hour auto-resume
- [ ] Tray menu label toggles between "Pause Detection" and "Resume Detection"
- [ ] `sync_detection_config` command accepts enabled, sensitivity, and signedIn from frontend
- [ ] Sensitivity and enabled changes take effect immediately when pushed via `sync_detection_config`
- [ ] Detection stops on sign-out, resumes on sign-in (both via `sync_detection_config`)
- [ ] Sliding window clears on machine wake
- [ ] Cooldown and pause timers do not count sleep time (Duration-based, tick-decremented)
- [ ] Notification permission requested on first sign-in with explanation

### Non-Functional Requirements

- [ ] Zero content logging — only switch timestamps and idle seconds
- [ ] App-switch monitoring is event-driven (zero CPU when no switches)
- [ ] Idle polling interval is 5 seconds (minimal battery impact)
- [ ] State transitions are logged to console in debug builds
- [ ] All detection logic runs in Rust (no frontend polling)

### Quality Gates

- [ ] State machine transitions tested with unit tests for all valid paths
- [ ] Evaluator tested across all three sensitivity levels
- [ ] Cooldown and pause duration decrement tested (including zero-crossing)
- [ ] Suppression tested: meeting app, manual pause, app foregrounded, signed out
- [ ] Sliding window correctly prunes stale events
- [ ] Daily notification cap tested
- [ ] Sleep/wake correctly resets sliding window
- [ ] `sync_detection_config` correctly transitions between Disabled/Active
- [ ] Nudge banner appears only after recent detection, not on normal app open
- [ ] Frontend receives state change events

## Dependencies & Prerequisites

| Dependency | Status | Notes |
|---|---|---|
| Phase 1 complete (auth, tray, auto-launch) | Done | Tray menu, auth, window management all working |
| `tauri-plugin-notification` | To add | Cargo.toml + capabilities |
| `objc2` + `objc2-app-kit` + `objc2-foundation` | To add | macOS-only dependencies |
| `core-foundation` + `core-foundation-sys` | To add | For IOKit idle time |
| `block2` | To add | For NSWorkspace notification blocks |
| macOS notification permission | Runtime | User must grant on first run |

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `objc2` API surface is complex and poorly documented | High | Medium | Start with minimal bindings, reference working examples from the crate's test suite |
| IOKit `HIDIdleTime` doesn't reset for some keyboard remappers (Karabiner) | Low | Low | Document as known limitation, not a blocker |
| Notification click has no callback | Known | Low | Soft nudge banner avoids the need for click attribution entirely |
| False positives from system UI (Spotlight, Notification Center) | Medium | Medium | Exclude known system bundle IDs from switch counting |
| Sleep/wake timing edge cases | Medium | Low | Duration-based timers auto-exclude sleep. Sliding window cleared on wake. |
| Google Meet detection impossible without accessibility permissions | Known | Low | Skip for MVP, only suppress native meeting apps |
| Frontend/Rust config desync | Low | Medium | Single `sync_detection_config` command is the only config pathway. Frontend calls it on every relevant state change. |

## Design Decisions Log

| Decision | Chosen | Why |
|---|---|---|
| Settings ownership | Frontend persists (Supabase), Rust applies (runtime) | Rust has no Supabase client. Frontend pushes config via `sync_detection_config`. Clear ownership boundary. |
| Notification response UX | Soft nudge banner, not auto-routing | `tauri-plugin-notification` has no desktop click callback. Window visibility cannot distinguish notification click from manual open. Nudge banner is non-disruptive and avoids misattribution. |
| Timer representation | `remaining: Duration` decremented per tick | `Instant` deadlines behave unpredictably across sleep/wake. Tick-based decrement automatically excludes sleep time. |
| Module structure | 2 files: `mod.rs` (engine) + `platform.rs` (macOS) | Suppression is a `HashSet` check — not complex enough for its own file. Evaluator and state machine are the engine. |
| Observer lifecycle | Always running, evaluation gated by state machine | Starting/stopping the NSWorkspace observer based on config would add complexity for no benefit. The observer is zero-cost when nothing switches. |
| Sliding window duration | 5 minutes fixed | Shorter windows are too twitchy, longer windows miss the moment. Can tune post-MVP. |
| Suppression model | OR-ed independent booleans | Simple, predictable. Detection runs only when ALL suppression reasons are cleared. |
| Idle polling interval | 5 seconds | Balance between responsiveness and battery. Timer tolerance on macOS helps coalesce. |
| macOS-first, Windows deferred | macOS only in Phase 2 | Primary dev platform. Windows APIs need a message pump thread — different architecture. |
| State persistence | None for transient state | Fresh detection state on restart is correct UX. Settings are already in Supabase. |
| Daily notification cap | 6 per day | Prevents notification fatigue over an 8-hour day while allowing meaningful detection. |

## References

### Internal

- `docs/plans/2026-03-14-feat-unstuck-sensei-tauri-desktop-mvp-plan.md` — master plan, Phase 2 section
- `docs/brainstorms/2026-03-12-unstuck-sensei-mvp-brainstorm.md` — product decisions
- `src-tauri/src/lib.rs` — existing tray menu, window management, plugin setup
- `src/hooks/useAuth.tsx` — hook pattern to follow (Context + Provider)

### External

- [Tauri v2 Notification Plugin](https://v2.tauri.app/plugin/notification/)
- [Tauri v2 State Management](https://v2.tauri.app/develop/state-management/)
- [Tauri v2 Events](https://v2.tauri.app/develop/calling-frontend/)
- [objc2 crate](https://github.com/madsmtm/objc2) — Rust bindings for Objective-C APIs
- [Apple: didActivateApplicationNotification](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification)
- [IOKit idle time detection](https://xs-labs.com/en/archives/articles/iokit-idle-time/)
- [Desktop notification click — open Tauri issue #3698](https://github.com/tauri-apps/tauri/issues/3698)
