use std::sync::{Mutex, MutexGuard};
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

use crate::detection::{recover_detection_state_lock, DetectionState};

pub const TIMER_STATE_CHANGED_EVENT: &str = "timer-state-changed";

const CHECKIN_GRACE_HOURS: i64 = 12;
const NOTIFICATION_TITLE: &str = "Time's up!";
const NOTIFICATION_BODY: &str = "How did it go?";
const TIMER_STORE_FILE: &str = "timer-state.json";
const TIMER_SNAPSHOT_KEY: &str = "snapshot";
const TIMER_PENDING_SYNCS_KEY: &str = "pendingSyncs";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerStatus {
    Idle,
    Running,
    AwaitingCheckin,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerPendingSyncKind {
    CompleteBlock,
    StopBlock,
    ExpireCheckin,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerPendingSync {
    pub block_id: Option<String>,
    pub expected_revision: i32,
    pub id: String,
    pub kind: TimerPendingSyncKind,
    pub occurred_at: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerStatusResponse {
    pub current_block_id: Option<String>,
    pub duration_secs: Option<u32>,
    pub extended: bool,
    pub remaining_secs: Option<u32>,
    pub session_id: Option<String>,
    pub status: TimerStatus,
    pub timer_revision: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimerSnapshot {
    checkin_started_at: Option<String>,
    current_block_id: Option<String>,
    deadline: Option<String>,
    duration_secs: Option<u32>,
    extended: bool,
    session_id: Option<String>,
    status: TimerStatus,
    timer_revision: Option<i32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TimerRuntimeEffect {
    EmitStateChanged(TimerStatusResponse),
    EnqueuePendingSync,
    PersistSnapshot,
    SendNotification,
    SetDetectionSuppression(bool),
    SyncTrayMenu,
}

#[allow(dead_code)]
pub struct TimerState {
    pub checkin_started_at: Option<DateTime<Utc>>,
    pub current_block_id: Option<String>,
    pub deadline: Option<DateTime<Utc>>,
    pub duration_secs: Option<u32>,
    pub extended: bool,
    pub pending_syncs: Vec<TimerPendingSync>,
    pub session_id: Option<String>,
    pub status: TimerStatus,
    pub tick_loop_active: bool,
    pub timer_revision: Option<i32>,
    tray_minute_bucket: Option<i64>,
}

impl TimerState {
    pub fn new() -> Self {
        Self {
            checkin_started_at: None,
            current_block_id: None,
            deadline: None,
            duration_secs: None,
            extended: false,
            pending_syncs: Vec::new(),
            session_id: None,
            status: TimerStatus::Idle,
            tick_loop_active: false,
            timer_revision: None,
            tray_minute_bucket: None,
        }
    }

    pub fn status_response(&self) -> TimerStatusResponse {
        self.status_response_at(Utc::now())
    }

    pub fn start(
        &mut self,
        session_id: String,
        block_id: String,
        started_at: DateTime<Utc>,
        duration_secs: u32,
        timer_revision: i32,
    ) -> Result<Vec<TimerRuntimeEffect>, String> {
        self.start_at(
            session_id,
            block_id,
            started_at,
            duration_secs,
            false,
            timer_revision,
            Utc::now(),
            true,
        )
    }

    pub fn extend(
        &mut self,
        session_id: String,
        block_id: String,
        started_at: DateTime<Utc>,
        duration_secs: u32,
        timer_revision: i32,
    ) -> Result<Vec<TimerRuntimeEffect>, String> {
        if self.status != TimerStatus::AwaitingCheckin {
            return Err("Timer extension requires an unresolved check-in.".to_string());
        }

        if self.extended {
            return Err("Timer extension is only allowed once.".to_string());
        }

        self.start_at(
            session_id,
            block_id,
            started_at,
            duration_secs,
            true,
            timer_revision,
            Utc::now(),
            false,
        )
    }

    pub fn stop(&mut self) -> Result<Vec<TimerRuntimeEffect>, String> {
        self.stop_at(Utc::now())
    }

    pub fn resolve_checkin(&mut self) -> Result<Vec<TimerRuntimeEffect>, String> {
        if self.status != TimerStatus::AwaitingCheckin {
            return Err("Timer check-in is not awaiting resolution.".to_string());
        }

        Ok(self.reset_to_idle(Utc::now(), true, false))
    }

    pub fn clear_runtime(&mut self) -> Vec<TimerRuntimeEffect> {
        self.pending_syncs.clear();
        self.reset_to_idle(Utc::now(), false, true)
    }

    pub fn hydrate_running(
        &mut self,
        session_id: String,
        block_id: String,
        started_at: DateTime<Utc>,
        duration_secs: u32,
        extended: bool,
        timer_revision: i32,
    ) -> Vec<TimerRuntimeEffect> {
        let effects = self
            .start_at(
                session_id,
                block_id,
                started_at,
                duration_secs,
                extended,
                timer_revision,
                Utc::now(),
                false,
            )
            .unwrap_or_else(|_| self.reset_to_idle(Utc::now(), false, true));

        if self
            .deadline
            .is_some_and(|deadline| deadline <= Utc::now() && self.status == TimerStatus::Running)
        {
            return self.tick_at(Utc::now());
        }

        effects
    }

    pub fn hydrate_awaiting_checkin(
        &mut self,
        session_id: String,
        block_id: String,
        checkin_started_at: DateTime<Utc>,
        duration_secs: u32,
        extended: bool,
        timer_revision: i32,
    ) -> Vec<TimerRuntimeEffect> {
        self.session_id = Some(session_id);
        self.current_block_id = Some(block_id);
        self.checkin_started_at = Some(checkin_started_at);
        self.deadline = None;
        self.duration_secs = Some(duration_secs);
        self.extended = extended;
        self.status = TimerStatus::AwaitingCheckin;
        self.timer_revision = Some(timer_revision);
        self.tray_minute_bucket = None;

        vec![
            TimerRuntimeEffect::EmitStateChanged(self.status_response_at(Utc::now())),
            TimerRuntimeEffect::SyncTrayMenu,
            TimerRuntimeEffect::SetDetectionSuppression(true),
            TimerRuntimeEffect::PersistSnapshot,
        ]
    }

    pub fn tick(&mut self) -> Vec<TimerRuntimeEffect> {
        self.tick_at(Utc::now())
    }

    pub fn expire_stale_checkin_if_needed(&mut self, now: DateTime<Utc>) -> Vec<TimerRuntimeEffect> {
        if self.status != TimerStatus::AwaitingCheckin {
            return Vec::new();
        }

        let Some(checkin_started_at) = self.checkin_started_at else {
            return Vec::new();
        };

        if now - checkin_started_at < Duration::hours(CHECKIN_GRACE_HOURS) {
            return Vec::new();
        }

        if let (Some(session_id), Some(timer_revision)) =
            (self.session_id.clone(), self.timer_revision)
        {
            self.enqueue_pending_sync(
                TimerPendingSyncKind::ExpireCheckin,
                session_id,
                None,
                timer_revision,
                now,
            );
        }

        let mut effects = self.reset_to_idle(now, true, true);
        effects.push(TimerRuntimeEffect::EnqueuePendingSync);
        effects
    }

    fn start_at(
        &mut self,
        session_id: String,
        block_id: String,
        started_at: DateTime<Utc>,
        duration_secs: u32,
        extended: bool,
        timer_revision: i32,
        now: DateTime<Utc>,
        reject_when_active: bool,
    ) -> Result<Vec<TimerRuntimeEffect>, String> {
        if duration_secs == 0 {
            return Err("Timer duration must be positive.".to_string());
        }

        if reject_when_active && self.status != TimerStatus::Idle {
            return Err("Timer is already running.".to_string());
        }

        self.session_id = Some(session_id);
        self.current_block_id = Some(block_id);
        self.deadline = Some(started_at + Duration::seconds(i64::from(duration_secs)));
        self.checkin_started_at = None;
        self.duration_secs = Some(duration_secs);
        self.extended = extended;
        self.status = TimerStatus::Running;
        self.timer_revision = Some(timer_revision);
        self.tray_minute_bucket = self.timer_minute_bucket_at(now);

        Ok(vec![
            TimerRuntimeEffect::EmitStateChanged(self.status_response_at(now)),
            TimerRuntimeEffect::SyncTrayMenu,
            TimerRuntimeEffect::SetDetectionSuppression(true),
            TimerRuntimeEffect::PersistSnapshot,
        ])
    }

    fn stop_at(&mut self, now: DateTime<Utc>) -> Result<Vec<TimerRuntimeEffect>, String> {
        if self.status != TimerStatus::Running {
            return Err("Timer is not running.".to_string());
        }

        if let (Some(session_id), Some(block_id), Some(timer_revision)) = (
            self.session_id.clone(),
            self.current_block_id.clone(),
            self.timer_revision,
        ) {
            self.enqueue_pending_sync(
                TimerPendingSyncKind::StopBlock,
                session_id,
                Some(block_id),
                timer_revision,
                now,
            );
        }

        let mut effects = self.reset_to_idle(now, true, true);
        effects.push(TimerRuntimeEffect::EnqueuePendingSync);
        Ok(effects)
    }

    fn tick_at(&mut self, now: DateTime<Utc>) -> Vec<TimerRuntimeEffect> {
        if self.status != TimerStatus::Running {
            return Vec::new();
        }

        let Some(deadline) = self.deadline else {
            return self.reset_to_idle(now, true, true);
        };

        if now >= deadline {
            let ended_at = deadline;

            if let (Some(session_id), Some(block_id), Some(timer_revision)) = (
                self.session_id.clone(),
                self.current_block_id.clone(),
                self.timer_revision,
            ) {
                self.enqueue_pending_sync(
                    TimerPendingSyncKind::CompleteBlock,
                    session_id,
                    Some(block_id),
                    timer_revision,
                    ended_at,
                );
            }

            self.status = TimerStatus::AwaitingCheckin;
            self.checkin_started_at = Some(ended_at);
            self.deadline = None;
            self.tray_minute_bucket = None;

            return vec![
                TimerRuntimeEffect::EmitStateChanged(self.status_response_at(now)),
                TimerRuntimeEffect::SendNotification,
                TimerRuntimeEffect::SyncTrayMenu,
                TimerRuntimeEffect::EnqueuePendingSync,
                TimerRuntimeEffect::PersistSnapshot,
            ];
        }

        let mut effects = vec![TimerRuntimeEffect::EmitStateChanged(self.status_response_at(now))];
        let next_bucket = self.timer_minute_bucket_at(now);

        if next_bucket != self.tray_minute_bucket {
            self.tray_minute_bucket = next_bucket;
            effects.push(TimerRuntimeEffect::SyncTrayMenu);
        }

        effects
    }

    fn timer_minute_bucket_at(&self, now: DateTime<Utc>) -> Option<i64> {
        self.deadline.map(|deadline| {
            let remaining = deadline.signed_duration_since(now).num_seconds().max(0);
            remaining / 60
        })
    }

    fn reset_to_idle(
        &mut self,
        now: DateTime<Utc>,
        clear_detection_suppression: bool,
        persist_snapshot: bool,
    ) -> Vec<TimerRuntimeEffect> {
        self.session_id = None;
        self.current_block_id = None;
        self.checkin_started_at = None;
        self.deadline = None;
        self.duration_secs = None;
        self.extended = false;
        self.status = TimerStatus::Idle;
        self.timer_revision = None;
        self.tray_minute_bucket = None;

        let mut effects = vec![
            TimerRuntimeEffect::EmitStateChanged(self.status_response_at(now)),
            TimerRuntimeEffect::SyncTrayMenu,
        ];

        if clear_detection_suppression {
            effects.push(TimerRuntimeEffect::SetDetectionSuppression(false));
        }

        if persist_snapshot {
            effects.push(TimerRuntimeEffect::PersistSnapshot);
        }

        effects
    }

    fn status_response_at(&self, now: DateTime<Utc>) -> TimerStatusResponse {
        let remaining_secs = match (self.status, self.deadline) {
            (TimerStatus::Running, Some(deadline)) => {
                Some(deadline.signed_duration_since(now).num_seconds().max(0) as u32)
            }
            _ => None,
        };

        TimerStatusResponse {
            current_block_id: self.current_block_id.clone(),
            duration_secs: self.duration_secs,
            extended: self.extended,
            remaining_secs,
            session_id: self.session_id.clone(),
            status: self.status,
            timer_revision: self.timer_revision,
        }
    }

    fn enqueue_pending_sync(
        &mut self,
        kind: TimerPendingSyncKind,
        session_id: String,
        block_id: Option<String>,
        expected_revision: i32,
        occurred_at: DateTime<Utc>,
    ) {
        if self.pending_syncs.iter().any(|sync| {
            sync.kind == kind
                && sync.session_id == session_id
                && sync.block_id == block_id
                && sync.expected_revision == expected_revision
        }) {
            return;
        }

        self.pending_syncs.push(TimerPendingSync {
            block_id,
            expected_revision,
            id: format!(
                "{kind:?}:{session_id}:{expected_revision}:{}",
                occurred_at.timestamp_millis()
            ),
            kind,
            occurred_at: occurred_at.to_rfc3339(),
            session_id,
        });
    }

    fn snapshot(&self) -> Option<TimerSnapshot> {
        if self.status == TimerStatus::Idle {
            return None;
        }

        Some(TimerSnapshot {
            checkin_started_at: self.checkin_started_at.map(|value| value.to_rfc3339()),
            current_block_id: self.current_block_id.clone(),
            deadline: self.deadline.map(|value| value.to_rfc3339()),
            duration_secs: self.duration_secs,
            extended: self.extended,
            session_id: self.session_id.clone(),
            status: self.status,
            timer_revision: self.timer_revision,
        })
    }

    fn apply_persisted(
        &mut self,
        snapshot: Option<TimerSnapshot>,
        pending_syncs: Vec<TimerPendingSync>,
        now: DateTime<Utc>,
    ) -> Vec<TimerRuntimeEffect> {
        self.pending_syncs = pending_syncs;

        let Some(snapshot) = snapshot else {
            return self.reset_to_idle(now, false, true);
        };

        self.session_id = snapshot.session_id;
        self.current_block_id = snapshot.current_block_id;
        self.deadline = snapshot
            .deadline
            .and_then(|value| parse_timestamp(&value).ok());
        self.checkin_started_at = snapshot
            .checkin_started_at
            .and_then(|value| parse_timestamp(&value).ok());
        self.duration_secs = snapshot.duration_secs;
        self.extended = snapshot.extended;
        self.status = snapshot.status;
        self.timer_revision = snapshot.timer_revision;
        self.tray_minute_bucket = self.timer_minute_bucket_at(now);

        match self.status {
            TimerStatus::Running => self.tick_at(now),
            TimerStatus::AwaitingCheckin => self.expire_stale_checkin_if_needed(now).into_iter().fold(
                vec![
                    TimerRuntimeEffect::EmitStateChanged(self.status_response_at(now)),
                    TimerRuntimeEffect::SyncTrayMenu,
                    TimerRuntimeEffect::SetDetectionSuppression(true),
                    TimerRuntimeEffect::PersistSnapshot,
                ],
                |mut effects, effect| {
                    if !effects.contains(&effect) {
                        effects.push(effect);
                    }
                    effects
                },
            ),
            TimerStatus::Idle => self.reset_to_idle(now, false, true),
        }
    }
}

pub(crate) fn recover_timer_state_lock<'a>(
    mutex: &'a Mutex<TimerState>,
    context: &str,
) -> MutexGuard<'a, TimerState> {
    match mutex.lock() {
        Ok(state) => state,
        Err(error) => {
            let mut state = error.into_inner();
            *state = TimerState::new();
            mutex.clear_poison();
            log_lock_recovery(context);
            state
        }
    }
}

pub(crate) fn execute_timer_effects(
    app: &AppHandle<Wry>,
    effects: Vec<TimerRuntimeEffect>,
) -> Result<(), String> {
    for effect in effects {
        match effect {
            TimerRuntimeEffect::EmitStateChanged(payload) => app
                .emit(TIMER_STATE_CHANGED_EVENT, payload)
                .map_err(|error| error.to_string())?,
            TimerRuntimeEffect::EnqueuePendingSync => {}
            TimerRuntimeEffect::PersistSnapshot => persist_timer_state(app)?,
            TimerRuntimeEffect::SendNotification => {
                app.notification()
                    .builder()
                    .title(NOTIFICATION_TITLE)
                    .body(NOTIFICATION_BODY)
                    .auto_cancel()
                    .show()
                    .map_err(|error| error.to_string())?;
            }
            TimerRuntimeEffect::SetDetectionSuppression(active) => {
                let detection_state = app.state::<Mutex<DetectionState>>();
                let effects = {
                    let mut state =
                        recover_detection_state_lock(detection_state.inner(), "timer_effects");
                    state.set_timer_suppression(active)
                };

                crate::execute_detection_effects(app, effects, false)?;
            }
            TimerRuntimeEffect::SyncTrayMenu => crate::sync_tray_menu(app)?,
        }
    }

    Ok(())
}

pub(crate) fn restore_runtime(app: &AppHandle<Wry>) -> Result<(), String> {
    let now = Utc::now();
    let (snapshot, pending_syncs) = load_persisted_timer_state(app)?;
    let effects = {
        let timer_state = app.state::<Mutex<TimerState>>();
        let mut state = recover_timer_state_lock(timer_state.inner(), "timer_restore");
        state.apply_persisted(snapshot, pending_syncs, now)
    };

    execute_timer_effects(app, effects)?;
    maybe_spawn_tick_loop(app.clone());
    Ok(())
}

pub(crate) fn maybe_spawn_tick_loop(app: AppHandle<Wry>) {
    let should_spawn = {
        let timer_state = app.state::<Mutex<TimerState>>();
        let mut state = recover_timer_state_lock(timer_state.inner(), "timer_spawn");

        if state.status != TimerStatus::Running || state.tick_loop_active {
            false
        } else {
            state.tick_loop_active = true;
            true
        }
    };

    if !should_spawn {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(StdDuration::from_secs(1));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;

            let effects = {
                let timer_state = app.state::<Mutex<TimerState>>();
                let mut state = recover_timer_state_lock(timer_state.inner(), "timer_tick");

                if state.status != TimerStatus::Running {
                    state.tick_loop_active = false;
                    return;
                }

                let effects = state.tick();

                if state.status != TimerStatus::Running {
                    state.tick_loop_active = false;
                }

                effects
            };

            if let Err(error) = execute_timer_effects(&app, effects) {
                #[cfg(debug_assertions)]
                eprintln!("[timer] failed to execute tick effects: {error}");
            }
        }
    });
}

fn persist_timer_state(app: &AppHandle<Wry>) -> Result<(), String> {
    let timer_state = app.state::<Mutex<TimerState>>();
    let state = recover_timer_state_lock(timer_state.inner(), "timer_persist");
    let store = app.store(TIMER_STORE_FILE).map_err(|error| error.to_string())?;

    if let Some(snapshot) = state.snapshot() {
        store.set(TIMER_SNAPSHOT_KEY, json!(snapshot));
    } else {
        let _ = store.delete(TIMER_SNAPSHOT_KEY);
    }

    store.set(TIMER_PENDING_SYNCS_KEY, json!(state.pending_syncs));
    store.save().map_err(|error| error.to_string())
}

fn load_persisted_timer_state(
    app: &AppHandle<Wry>,
) -> Result<(Option<TimerSnapshot>, Vec<TimerPendingSync>), String> {
    let store = app.store(TIMER_STORE_FILE).map_err(|error| error.to_string())?;
    let snapshot = store
        .get(TIMER_SNAPSHOT_KEY)
        .and_then(|value| serde_json::from_value::<TimerSnapshot>(value).ok());
    let pending_syncs = store
        .get(TIMER_PENDING_SYNCS_KEY)
        .and_then(|value| serde_json::from_value::<Vec<TimerPendingSync>>(value).ok())
        .unwrap_or_default();

    Ok((snapshot, pending_syncs))
}

fn parse_timestamp(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| error.to_string())
}

fn log_lock_recovery(context: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[timer] recovered poisoned timer state lock in {context}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_utc(value: &str) -> DateTime<Utc> {
        parse_timestamp(value).unwrap()
    }

    fn assert_has_sync(effects: &[TimerRuntimeEffect], kind: TimerPendingSyncKind) {
        assert!(effects.contains(&TimerRuntimeEffect::EnqueuePendingSync));
        let sync_kinds: Vec<_> = effects
            .iter()
            .filter_map(|effect| match effect {
                TimerRuntimeEffect::EnqueuePendingSync => Some(kind),
                _ => None,
            })
            .collect();
        assert!(!sync_kinds.is_empty());
    }

    #[test]
    fn start_then_tick_completes_into_awaiting_checkin() {
        let mut state = TimerState::new();
        let started_at = parse_utc("2026-03-21T10:00:00Z");

        state
            .start_at(
                "session-1".to_string(),
                "block-1".to_string(),
                started_at,
                1500,
                false,
                1,
                started_at,
                true,
            )
            .unwrap();

        let effects = state.tick_at(parse_utc("2026-03-21T10:25:01Z"));

        assert_eq!(state.status, TimerStatus::AwaitingCheckin);
        assert_eq!(state.pending_syncs.len(), 1);
        assert_eq!(state.pending_syncs[0].kind, TimerPendingSyncKind::CompleteBlock);
        assert!(effects.contains(&TimerRuntimeEffect::SendNotification));
        assert_has_sync(&effects, TimerPendingSyncKind::CompleteBlock);
    }

    #[test]
    fn start_then_stop_clears_runtime_and_enqueues_stop() {
        let mut state = TimerState::new();
        let started_at = parse_utc("2026-03-21T10:00:00Z");

        state
            .start_at(
                "session-1".to_string(),
                "block-1".to_string(),
                started_at,
                1500,
                false,
                1,
                started_at,
                true,
            )
            .unwrap();

        let effects = state.stop_at(parse_utc("2026-03-21T10:05:00Z")).unwrap();

        assert_eq!(state.status, TimerStatus::Idle);
        assert_eq!(state.pending_syncs.len(), 1);
        assert_eq!(state.pending_syncs[0].kind, TimerPendingSyncKind::StopBlock);
        assert!(effects.contains(&TimerRuntimeEffect::SetDetectionSuppression(false)));
    }

    #[test]
    fn extend_from_awaiting_checkin_returns_to_running() {
        let mut state = TimerState::new();
        let started_at = parse_utc("2026-03-21T10:00:00Z");

        state
            .start_at(
                "session-1".to_string(),
                "block-1".to_string(),
                started_at,
                1500,
                false,
                1,
                started_at,
                true,
            )
            .unwrap();
        state.tick_at(parse_utc("2026-03-21T10:25:00Z"));

        state
            .extend(
                "session-1".to_string(),
                "block-2".to_string(),
                parse_utc("2026-03-21T10:30:00Z"),
                1500,
                2,
            )
            .unwrap();

        assert_eq!(state.status, TimerStatus::Running);
        assert!(state.extended);
        assert_eq!(state.timer_revision, Some(2));
    }

    #[test]
    fn resolve_checkin_returns_to_idle() {
        let mut state = TimerState::new();
        let effects = state.hydrate_awaiting_checkin(
            "session-1".to_string(),
            "block-1".to_string(),
            parse_utc("2026-03-21T10:25:00Z"),
            1500,
            false,
            2,
        );
        assert!(!effects.is_empty());

        let effects = state.resolve_checkin().unwrap();

        assert_eq!(state.status, TimerStatus::Idle);
        assert!(effects.contains(&TimerRuntimeEffect::SetDetectionSuppression(false)));
    }

    #[test]
    fn double_start_is_rejected() {
        let mut state = TimerState::new();
        let started_at = parse_utc("2026-03-21T10:00:00Z");

        state
            .start_at(
                "session-1".to_string(),
                "block-1".to_string(),
                started_at,
                1500,
                false,
                1,
                started_at,
                true,
            )
            .unwrap();

        let error = state
            .start_at(
                "session-1".to_string(),
                "block-1".to_string(),
                started_at,
                1500,
                false,
                1,
                started_at,
                true,
            )
            .unwrap_err();

        assert!(error.contains("already running"));
    }

    #[test]
    fn extend_requires_awaiting_checkin() {
        let mut state = TimerState::new();

        let error = state
            .extend(
                "session-1".to_string(),
                "block-2".to_string(),
                parse_utc("2026-03-21T10:30:00Z"),
                1500,
                2,
            )
            .unwrap_err();

        assert!(error.contains("requires an unresolved check-in"));
    }

    #[test]
    fn second_extension_is_rejected() {
        let mut state = TimerState::new();
        let started_at = parse_utc("2026-03-21T10:00:00Z");

        state
            .start_at(
                "session-1".to_string(),
                "block-1".to_string(),
                started_at,
                1500,
                false,
                1,
                started_at,
                true,
            )
            .unwrap();
        state.tick_at(parse_utc("2026-03-21T10:25:00Z"));
        state
            .extend(
                "session-1".to_string(),
                "block-2".to_string(),
                parse_utc("2026-03-21T10:30:00Z"),
                1500,
                2,
            )
            .unwrap();
        state.tick_at(parse_utc("2026-03-21T10:55:00Z"));

        let error = state
            .extend(
                "session-1".to_string(),
                "block-3".to_string(),
                parse_utc("2026-03-21T11:00:00Z"),
                1500,
                3,
            )
            .unwrap_err();

        assert!(error.contains("only allowed once"));
    }

    #[test]
    fn hydrate_running_with_past_deadline_completes_immediately() {
        let mut state = TimerState::new();

        let effects = state.hydrate_running(
            "session-1".to_string(),
            "block-1".to_string(),
            parse_utc("2026-03-21T10:00:00Z"),
            1500,
            false,
            1,
        );

        assert_eq!(state.status, TimerStatus::AwaitingCheckin);
        assert!(effects.contains(&TimerRuntimeEffect::SendNotification));
    }

    #[test]
    fn stale_checkin_clears_suppression_and_enqueues_expiry() {
        let mut state = TimerState::new();
        state.hydrate_awaiting_checkin(
            "session-1".to_string(),
            "block-1".to_string(),
            parse_utc("2026-03-20T09:00:00Z"),
            1500,
            false,
            2,
        );

        let effects = state.expire_stale_checkin_if_needed(parse_utc("2026-03-21T22:00:00Z"));

        assert_eq!(state.status, TimerStatus::Idle);
        assert_eq!(state.pending_syncs.len(), 1);
        assert_eq!(state.pending_syncs[0].kind, TimerPendingSyncKind::ExpireCheckin);
        assert!(effects.contains(&TimerRuntimeEffect::SetDetectionSuppression(false)));
    }
}
