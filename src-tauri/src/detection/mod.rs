pub mod platform;

use std::{
    collections::{HashSet, VecDeque},
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Wry};
use tauri_plugin_notification::NotificationExt;

pub const DETECTION_STATE_CHANGED_EVENT: &str = "detection-state-changed";

const WINDOW_DURATION: Duration = Duration::from_secs(5 * 60);
const IDLE_THRESHOLD_SECONDS: u64 = 120;
const NOTIFICATION_DURATION: Duration = Duration::from_secs(60);
const COOLDOWN_DURATION: Duration = Duration::from_secs(30 * 60);
const PAUSE_DURATION: Duration = Duration::from_secs(2 * 60 * 60);
const NUDGE_DURATION: Duration = Duration::from_secs(5 * 60);
const DAILY_NOTIFICATION_CAP: u32 = 6;
const NOTIFICATION_TITLE: &str = "Feeling stuck?";
const NOTIFICATION_BODY: &str =
    "Looks like you've been bouncing between apps. Want to talk it through?";
const MEETING_APP_BUNDLE_IDS: &[&str] = &[
    "us.zoom.xos",
    "com.microsoft.teams2",
    "com.apple.FaceTime",
    "com.webex.meetingmanager",
];

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SuppressionReason {
    MeetingApp,
    TimerRunning,
    AppForegrounded,
    SignedOut,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectionStatus {
    Disabled,
    Active,
    Notifying,
    Cooldown,
    Paused,
    Suppressed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensitivity {
    Low,
    Medium,
    High,
}

impl Default for Sensitivity {
    fn default() -> Self {
        Self::Medium
    }
}

impl Sensitivity {
    fn threshold(self) -> usize {
        match self {
            Self::Low => 12,
            Self::Medium => 8,
            Self::High => 5,
        }
    }
}

#[allow(dead_code)]
pub struct DetectionState {
    pub status: DetectionStatus,
    pub sensitivity: Sensitivity,
    pub enabled: bool,
    pub signed_in: bool,
    pub app_switches: VecDeque<Instant>,
    pub app_foregrounded: bool,
    pub last_foreground_bundle_id: Option<String>,
    pub last_idle_seconds: u64,
    pub cooldown_remaining: Option<Duration>,
    pub notification_remaining: Option<Duration>,
    pub pause_remaining: Option<Duration>,
    pub last_tick: Instant,
    pub suppression_reasons: HashSet<SuppressionReason>,
    pub notifications_today: u32,
    pub today_date: NaiveDate,
    pub last_stuck_detected_at: Option<Instant>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DetectionRuntimeEffect {
    SendNotification,
    EmitStateChanged(DetectionStatusResponse),
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum EvaluationOutcome {
    ShouldNotify,
    NoAction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TransitionEvent {
    Enabled,
    EnabledWhileSuppressed,
    Disabled,
    StuckDetected,
    NotificationExpired,
    CooldownExpired,
    CooldownExpiredWhileSuppressed,
    PauseRequested,
    PauseExpired,
    PauseExpiredWhileSuppressed,
    ResumeRequested,
    ResumeRequestedWhileSuppressed,
    SuppressionActivated,
    SuppressionCleared,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TransitionSideEffect {
    SendNotification,
    StartCooldown,
    EmitStateChanged,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TransitionResult {
    next_status: DetectionStatus,
    side_effects: Vec<TransitionSideEffect>,
}

impl DetectionState {
    pub fn new() -> Self {
        Self {
            status: DetectionStatus::Disabled,
            sensitivity: Sensitivity::default(),
            enabled: false,
            signed_in: false,
            app_switches: VecDeque::new(),
            app_foregrounded: false,
            last_foreground_bundle_id: None,
            last_idle_seconds: 0,
            cooldown_remaining: None,
            notification_remaining: None,
            pause_remaining: None,
            last_tick: Instant::now(),
            suppression_reasons: HashSet::from([SuppressionReason::SignedOut]),
            notifications_today: 0,
            today_date: Local::now().date_naive(),
            last_stuck_detected_at: None,
        }
    }

    pub fn sync_config(
        &mut self,
        signed_in: bool,
        enabled: bool,
        sensitivity: Sensitivity,
    ) -> Vec<DetectionRuntimeEffect> {
        self.sync_config_at(signed_in, enabled, sensitivity, Instant::now())
    }

    pub fn pause(&mut self) -> Vec<DetectionRuntimeEffect> {
        self.pause_at(Instant::now())
    }

    pub fn resume(&mut self) -> Vec<DetectionRuntimeEffect> {
        self.resume_at(Instant::now())
    }

    pub fn dismiss_nudge(&mut self) -> Vec<DetectionRuntimeEffect> {
        self.dismiss_nudge_at(Instant::now())
    }

    pub fn record_app_switch(&mut self, bundle_id: Option<&str>) -> Vec<DetectionRuntimeEffect> {
        self.record_app_switch_at(bundle_id, Instant::now())
    }

    pub fn set_app_foregrounded(&mut self, app_foregrounded: bool) -> Vec<DetectionRuntimeEffect> {
        self.set_app_foregrounded_at(app_foregrounded, Instant::now())
    }

    pub fn set_timer_suppression(&mut self, active: bool) -> Vec<DetectionRuntimeEffect> {
        self.set_timer_suppression_at(active, Instant::now())
    }

    pub fn update_idle_seconds(&mut self, idle_seconds: u64) -> Vec<DetectionRuntimeEffect> {
        self.update_idle_seconds_at(idle_seconds, Instant::now(), Local::now().date_naive())
    }

    pub fn clear_app_switches(&mut self) -> Vec<DetectionRuntimeEffect> {
        self.clear_app_switches_at(Instant::now())
    }

    pub fn status_response(&self) -> DetectionStatusResponse {
        self.status_response_at(Instant::now())
    }

    pub(crate) fn recover_after_poison(&mut self, now: Instant) {
        let signed_in = self.signed_in;
        let enabled = self.enabled;
        let sensitivity = self.sensitivity;
        let app_foregrounded = self.app_foregrounded;
        let last_foreground_bundle_id = self.last_foreground_bundle_id.clone();
        let last_idle_seconds = self.last_idle_seconds;
        let notifications_today = self.notifications_today;
        let today_date = self.today_date;

        *self = Self::new();
        self.last_tick = now;
        self.signed_in = signed_in;
        self.enabled = enabled;
        self.sensitivity = sensitivity;
        self.app_foregrounded = app_foregrounded;
        self.last_foreground_bundle_id = last_foreground_bundle_id;
        self.last_idle_seconds = last_idle_seconds;
        self.notifications_today = notifications_today;
        self.today_date = today_date;

        if signed_in {
            self.suppression_reasons
                .remove(&SuppressionReason::SignedOut);
        }

        self.refresh_dynamic_suppression_reasons();

        if !signed_in || !enabled {
            let _ = self.disable(now);
            return;
        }

        let event = if self.has_runtime_suppression() {
            TransitionEvent::EnabledWhileSuppressed
        } else {
            TransitionEvent::Enabled
        };

        let _ = self.apply_transition(event, now);
    }

    #[cfg(debug_assertions)]
    pub fn app_switch_count(&self) -> usize {
        self.app_switches.len()
    }

    fn sync_config_at(
        &mut self,
        signed_in: bool,
        enabled: bool,
        sensitivity: Sensitivity,
        now: Instant,
    ) -> Vec<DetectionRuntimeEffect> {
        self.signed_in = signed_in;
        self.enabled = enabled;
        self.sensitivity = sensitivity;
        self.last_tick = now;

        if signed_in {
            self.suppression_reasons
                .remove(&SuppressionReason::SignedOut);
        } else {
            self.suppression_reasons
                .insert(SuppressionReason::SignedOut);
        }

        self.refresh_dynamic_suppression_reasons();

        if !signed_in || !enabled {
            return self.disable(now);
        }

        match self.status {
            DetectionStatus::Disabled => {
                let event = if self.has_runtime_suppression() {
                    TransitionEvent::EnabledWhileSuppressed
                } else {
                    TransitionEvent::Enabled
                };

                self.apply_transition(event, now)
            }
            DetectionStatus::Suppressed if !self.has_runtime_suppression() => {
                self.apply_transition(TransitionEvent::SuppressionCleared, now)
            }
            DetectionStatus::Active if self.has_runtime_suppression() => {
                self.apply_transition(TransitionEvent::SuppressionActivated, now)
            }
            _ => Vec::new(),
        }
    }

    fn pause_at(&mut self, now: Instant) -> Vec<DetectionRuntimeEffect> {
        if !matches!(
            self.status,
            DetectionStatus::Active | DetectionStatus::Cooldown | DetectionStatus::Suppressed
        ) {
            return Vec::new();
        }

        let effects = self.apply_transition(TransitionEvent::PauseRequested, now);
        self.pause_remaining = Some(PAUSE_DURATION);
        self.notification_remaining = None;
        effects
    }

    fn resume_at(&mut self, now: Instant) -> Vec<DetectionRuntimeEffect> {
        if self.status != DetectionStatus::Paused {
            return Vec::new();
        }

        self.pause_remaining = None;

        if !self.signed_in || !self.enabled {
            return self.apply_transition(TransitionEvent::Disabled, now);
        }

        self.restore_post_pause_state_at(
            now,
            TransitionEvent::ResumeRequested,
            TransitionEvent::ResumeRequestedWhileSuppressed,
        )
    }

    fn dismiss_nudge_at(&mut self, now: Instant) -> Vec<DetectionRuntimeEffect> {
        if self.last_stuck_detected_at.is_none() {
            return Vec::new();
        }

        self.last_stuck_detected_at = None;
        vec![DetectionRuntimeEffect::EmitStateChanged(
            self.status_response_at(now),
        )]
    }

    fn record_app_switch_at(
        &mut self,
        bundle_id: Option<&str>,
        now: Instant,
    ) -> Vec<DetectionRuntimeEffect> {
        self.last_foreground_bundle_id = bundle_id.map(ToOwned::to_owned);
        self.refresh_dynamic_suppression_reasons();

        let effects = self.refresh_suppression_state(now);

        if !(self.signed_in && self.enabled) {
            return effects;
        }

        self.prune_app_switches(now);
        self.app_switches.push_back(now);
        effects
    }

    fn set_app_foregrounded_at(
        &mut self,
        app_foregrounded: bool,
        now: Instant,
    ) -> Vec<DetectionRuntimeEffect> {
        self.app_foregrounded = app_foregrounded;
        self.refresh_dynamic_suppression_reasons();
        self.refresh_suppression_state(now)
    }

    fn set_timer_suppression_at(
        &mut self,
        active: bool,
        now: Instant,
    ) -> Vec<DetectionRuntimeEffect> {
        self.set_suppression_reason(SuppressionReason::TimerRunning, active);
        self.refresh_suppression_state(now)
    }

    fn update_idle_seconds_at(
        &mut self,
        idle_seconds: u64,
        now: Instant,
        today: NaiveDate,
    ) -> Vec<DetectionRuntimeEffect> {
        let elapsed = now.saturating_duration_since(self.last_tick);

        self.last_idle_seconds = idle_seconds;
        self.last_tick = now;
        self.reset_daily_cap_if_needed(today);
        self.prune_app_switches(now);

        let mut effects = self.advance_timers(elapsed, now);

        if self.clear_expired_nudge(now) {
            effects.push(DetectionRuntimeEffect::EmitStateChanged(
                self.status_response_at(now),
            ));
        }

        effects.extend(self.refresh_suppression_state(now));

        if matches!(self.status, DetectionStatus::Active)
            && self.evaluate() == EvaluationOutcome::ShouldNotify
        {
            self.notifications_today += 1;
            self.last_stuck_detected_at = Some(now);
            self.notification_remaining = Some(NOTIFICATION_DURATION);
            effects.extend(self.apply_transition(TransitionEvent::StuckDetected, now));
        }

        effects
    }

    fn clear_app_switches_at(&mut self, now: Instant) -> Vec<DetectionRuntimeEffect> {
        self.app_switches.clear();
        self.last_tick = now;
        Vec::new()
    }

    fn advance_timers(&mut self, elapsed: Duration, now: Instant) -> Vec<DetectionRuntimeEffect> {
        let mut effects = Vec::new();

        if let Some(remaining) = &mut self.pause_remaining {
            *remaining = remaining.saturating_sub(elapsed);

            if remaining.is_zero() {
                self.pause_remaining = None;
                effects.extend(self.restore_post_pause_state_at(
                    now,
                    TransitionEvent::PauseExpired,
                    TransitionEvent::PauseExpiredWhileSuppressed,
                ));
            }
        }

        if let Some(remaining) = &mut self.notification_remaining {
            *remaining = remaining.saturating_sub(elapsed);

            if remaining.is_zero() {
                self.notification_remaining = None;
                effects.extend(self.apply_transition(TransitionEvent::NotificationExpired, now));
            }
        }

        if let Some(remaining) = &mut self.cooldown_remaining {
            *remaining = remaining.saturating_sub(elapsed);

            if remaining.is_zero() {
                self.cooldown_remaining = None;
                self.last_stuck_detected_at = None;

                let event = if self.has_runtime_suppression() {
                    TransitionEvent::CooldownExpiredWhileSuppressed
                } else {
                    TransitionEvent::CooldownExpired
                };

                effects.extend(self.apply_transition(event, now));
            }
        }

        effects
    }

    fn restore_post_pause_state_at(
        &mut self,
        now: Instant,
        active_event: TransitionEvent,
        suppressed_event: TransitionEvent,
    ) -> Vec<DetectionRuntimeEffect> {
        if self.cooldown_remaining.is_some() {
            self.status = DetectionStatus::Cooldown;
            return vec![DetectionRuntimeEffect::EmitStateChanged(
                self.status_response_at(now),
            )];
        }

        let event = if self.has_runtime_suppression() {
            suppressed_event
        } else {
            active_event
        };

        self.apply_transition(event, now)
    }

    fn refresh_suppression_state(&mut self, now: Instant) -> Vec<DetectionRuntimeEffect> {
        if !self.signed_in || !self.enabled {
            return Vec::new();
        }

        match self.status {
            DetectionStatus::Active if self.has_runtime_suppression() => {
                self.apply_transition(TransitionEvent::SuppressionActivated, now)
            }
            DetectionStatus::Suppressed if !self.has_runtime_suppression() => {
                self.apply_transition(TransitionEvent::SuppressionCleared, now)
            }
            _ => Vec::new(),
        }
    }

    fn evaluate(&self) -> EvaluationOutcome {
        if self.app_switches.len() < self.sensitivity.threshold() {
            return EvaluationOutcome::NoAction;
        }

        if self.last_idle_seconds >= IDLE_THRESHOLD_SECONDS {
            return EvaluationOutcome::NoAction;
        }

        if self.notifications_today >= DAILY_NOTIFICATION_CAP {
            return EvaluationOutcome::NoAction;
        }

        EvaluationOutcome::ShouldNotify
    }

    fn apply_transition(
        &mut self,
        event: TransitionEvent,
        now: Instant,
    ) -> Vec<DetectionRuntimeEffect> {
        let result = transition(self.status, event);
        let mut effects = Vec::with_capacity(result.side_effects.len());

        self.status = result.next_status;

        for side_effect in result.side_effects {
            match side_effect {
                TransitionSideEffect::SendNotification => {
                    effects.push(DetectionRuntimeEffect::SendNotification);
                }
                TransitionSideEffect::StartCooldown => {
                    self.cooldown_remaining = Some(COOLDOWN_DURATION);
                }
                TransitionSideEffect::EmitStateChanged => {
                    effects.push(DetectionRuntimeEffect::EmitStateChanged(
                        self.status_response_at(now),
                    ));
                }
            }
        }

        effects
    }

    fn status_response_at(&self, now: Instant) -> DetectionStatusResponse {
        DetectionStatusResponse {
            status: self.status,
            resume_in_seconds: self.resume_in_seconds(),
            nudge_active: self.is_nudge_active_at(now),
        }
    }

    fn is_nudge_active_at(&self, now: Instant) -> bool {
        self.last_stuck_detected_at
            .is_some_and(|detected_at| now.saturating_duration_since(detected_at) < NUDGE_DURATION)
    }

    fn clear_expired_nudge(&mut self, now: Instant) -> bool {
        if self.is_nudge_active_at(now) {
            return false;
        }

        if self.last_stuck_detected_at.is_some() {
            self.last_stuck_detected_at = None;
            return true;
        }

        false
    }

    fn reset_daily_cap_if_needed(&mut self, today: NaiveDate) {
        if self.today_date == today {
            return;
        }

        self.today_date = today;
        self.notifications_today = 0;
    }

    fn prune_app_switches(&mut self, now: Instant) {
        while let Some(timestamp) = self.app_switches.front().copied() {
            if now.saturating_duration_since(timestamp) <= WINDOW_DURATION {
                break;
            }

            self.app_switches.pop_front();
        }
    }

    fn refresh_dynamic_suppression_reasons(&mut self) {
        self.set_suppression_reason(
            SuppressionReason::MeetingApp,
            self.last_foreground_bundle_id
                .as_deref()
                .is_some_and(is_meeting_app_bundle_id),
        );
        self.set_suppression_reason(SuppressionReason::AppForegrounded, self.app_foregrounded);
    }

    fn set_suppression_reason(&mut self, reason: SuppressionReason, active: bool) {
        if active {
            self.suppression_reasons.insert(reason);
        } else {
            self.suppression_reasons.remove(&reason);
        }
    }

    fn has_runtime_suppression(&self) -> bool {
        self.suppression_reasons
            .iter()
            .any(|reason| *reason != SuppressionReason::SignedOut)
    }

    fn resume_in_seconds(&self) -> Option<u64> {
        match self.status {
            DetectionStatus::Paused => self.pause_remaining.map(|duration| duration.as_secs()),
            DetectionStatus::Cooldown => self.cooldown_remaining.map(|duration| duration.as_secs()),
            _ => None,
        }
    }

    fn disable(&mut self, now: Instant) -> Vec<DetectionRuntimeEffect> {
        let should_emit_state_change = if self.status == DetectionStatus::Disabled {
            false
        } else {
            let result = transition(self.status, TransitionEvent::Disabled);
            self.status = result.next_status;
            result
                .side_effects
                .contains(&TransitionSideEffect::EmitStateChanged)
        };

        self.clear_disabled_runtime_state();

        should_emit_state_change
            .then(|| DetectionRuntimeEffect::EmitStateChanged(self.status_response_at(now)))
            .into_iter()
            .collect()
    }

    fn clear_disabled_runtime_state(&mut self) {
        self.notification_remaining = None;
        self.cooldown_remaining = None;
        self.pause_remaining = None;
        self.app_switches.clear();
        self.last_foreground_bundle_id = None;
        self.last_stuck_detected_at = None;
        self.suppression_reasons
            .retain(|reason| *reason == SuppressionReason::SignedOut);
    }
}

pub(crate) fn recover_detection_state_lock<'a>(
    mutex: &'a Mutex<DetectionState>,
    context: &str,
) -> MutexGuard<'a, DetectionState> {
    match mutex.lock() {
        Ok(state) => state,
        Err(error) => {
            let mut state = error.into_inner();
            state.recover_after_poison(Instant::now());
            mutex.clear_poison();
            log_lock_recovery(context);
            state
        }
    }
}

fn log_lock_recovery(context: &str) {
    #[cfg(debug_assertions)]
    eprintln!(
        "[detection] recovered poisoned detection state lock in {context}; cleared volatile runtime state"
    );
}

fn is_meeting_app_bundle_id(bundle_id: &str) -> bool {
    MEETING_APP_BUNDLE_IDS.contains(&bundle_id)
}

fn transition(status: DetectionStatus, event: TransitionEvent) -> TransitionResult {
    use DetectionStatus::{Active, Cooldown, Disabled, Notifying, Paused, Suppressed};
    use TransitionEvent::{
        CooldownExpired, CooldownExpiredWhileSuppressed, Disabled as DisableEvent, Enabled,
        EnabledWhileSuppressed, NotificationExpired, PauseExpired, PauseExpiredWhileSuppressed,
        PauseRequested, ResumeRequested, ResumeRequestedWhileSuppressed, StuckDetected,
        SuppressionActivated, SuppressionCleared,
    };
    use TransitionSideEffect::{EmitStateChanged, SendNotification, StartCooldown};

    let unchanged = || TransitionResult {
        next_status: status,
        side_effects: Vec::new(),
    };

    match (status, event) {
        (Disabled, Enabled) => TransitionResult {
            next_status: Active,
            side_effects: vec![EmitStateChanged],
        },
        (Disabled, EnabledWhileSuppressed) => TransitionResult {
            next_status: Suppressed,
            side_effects: vec![EmitStateChanged],
        },
        (Active, StuckDetected) => TransitionResult {
            next_status: Notifying,
            side_effects: vec![SendNotification, StartCooldown, EmitStateChanged],
        },
        (Notifying, NotificationExpired) => TransitionResult {
            next_status: Cooldown,
            side_effects: vec![EmitStateChanged],
        },
        (Cooldown, CooldownExpired) => TransitionResult {
            next_status: Active,
            side_effects: vec![EmitStateChanged],
        },
        (Cooldown, CooldownExpiredWhileSuppressed) => TransitionResult {
            next_status: Suppressed,
            side_effects: vec![EmitStateChanged],
        },
        (Active | Cooldown | Suppressed, PauseRequested) => TransitionResult {
            next_status: Paused,
            side_effects: vec![EmitStateChanged],
        },
        (Paused, PauseExpired) | (Paused, ResumeRequested) => TransitionResult {
            next_status: Active,
            side_effects: vec![EmitStateChanged],
        },
        (Paused, PauseExpiredWhileSuppressed) | (Paused, ResumeRequestedWhileSuppressed) => {
            TransitionResult {
                next_status: Suppressed,
                side_effects: vec![EmitStateChanged],
            }
        }
        (Active, SuppressionActivated) => TransitionResult {
            next_status: Suppressed,
            side_effects: vec![EmitStateChanged],
        },
        (Suppressed, SuppressionCleared) => TransitionResult {
            next_status: Active,
            side_effects: vec![EmitStateChanged],
        },
        (Active | Notifying | Cooldown | Paused | Suppressed, DisableEvent) => TransitionResult {
            next_status: Disabled,
            side_effects: vec![EmitStateChanged],
        },
        _ => unchanged(),
    }
}

pub fn execute_runtime_effects(
    app: &AppHandle<Wry>,
    effects: Vec<DetectionRuntimeEffect>,
) -> Result<(), String> {
    execute_runtime_effects_with(
        effects,
        || {
            app.notification()
                .builder()
                .title(NOTIFICATION_TITLE)
                .body(NOTIFICATION_BODY)
                .show()
                .map_err(|error| error.to_string())
        },
        |payload| {
            app.emit(DETECTION_STATE_CHANGED_EVENT, payload)
                .map_err(|error| error.to_string())
        },
    )
}

fn execute_runtime_effects_with<Notify, Emit>(
    effects: Vec<DetectionRuntimeEffect>,
    mut send_notification: Notify,
    mut emit_state_changed: Emit,
) -> Result<(), String>
where
    Notify: FnMut() -> Result<(), String>,
    Emit: FnMut(DetectionStatusResponse) -> Result<(), String>,
{
    let mut first_error = None;

    for effect in effects {
        let result = match effect {
            DetectionRuntimeEffect::SendNotification => send_notification().map_err(|error| {
                format_runtime_effect_error(&mut first_error, "send detection notification", error)
            }),
            DetectionRuntimeEffect::EmitStateChanged(payload) => emit_state_changed(payload)
                .map_err(|error| {
                    format_runtime_effect_error(
                        &mut first_error,
                        "emit detection state change",
                        error,
                    )
                }),
        };

        if result.is_err() {
            continue;
        }
    }

    first_error.map_or(Ok(()), Err)
}

fn format_runtime_effect_error(
    first_error: &mut Option<String>,
    action: &str,
    error: String,
) -> String {
    eprintln!("[detection] failed to {action}: {error}");

    if first_error.is_none() {
        *first_error = Some(error.clone());
    }

    error
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionStatusResponse {
    pub status: DetectionStatus,
    pub resume_in_seconds: Option<u64>,
    pub nudge_active: bool,
}

impl From<&DetectionState> for DetectionStatusResponse {
    fn from(state: &DetectionState) -> Self {
        state.status_response()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionDebugResponse {
    pub app_switch_count: usize,
    pub idle_seconds: u64,
    pub last_foreground_bundle_id: Option<String>,
}

#[cfg(debug_assertions)]
impl From<&DetectionState> for DetectionDebugResponse {
    fn from(state: &DetectionState) -> Self {
        Self {
            app_switch_count: state.app_switch_count(),
            idle_seconds: state.last_idle_seconds,
            last_foreground_bundle_id: state.last_foreground_bundle_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, panic::AssertUnwindSafe, sync::Mutex};

    fn signed_in_state(status: DetectionStatus) -> DetectionState {
        let mut state = DetectionState::new();
        state.status = status;
        state.signed_in = true;
        state.enabled = true;
        state
            .suppression_reasons
            .remove(&SuppressionReason::SignedOut);
        state
    }

    fn assert_state_changed(
        effects: &[DetectionRuntimeEffect],
        expected_status: DetectionStatus,
        expected_nudge_active: bool,
    ) {
        assert!(effects.iter().any(|effect| {
            matches!(
                effect,
                DetectionRuntimeEffect::EmitStateChanged(payload)
                    if payload.status == expected_status
                        && payload.nudge_active == expected_nudge_active
            )
        }));
    }

    #[test]
    fn sync_config_preserves_runtime_states_when_reenabled() {
        let now = Instant::now();

        for status in [
            DetectionStatus::Paused,
            DetectionStatus::Cooldown,
            DetectionStatus::Suppressed,
            DetectionStatus::Notifying,
        ] {
            let mut state = signed_in_state(status);
            state.pause_remaining = Some(Duration::from_secs(123));
            state.cooldown_remaining = Some(Duration::from_secs(456));
            state.notification_remaining = Some(Duration::from_secs(12));
            if status == DetectionStatus::Suppressed {
                state.last_foreground_bundle_id = Some("us.zoom.xos".to_string());
                state
                    .suppression_reasons
                    .insert(SuppressionReason::MeetingApp);
            }

            let effects = state.sync_config_at(true, true, Sensitivity::High, now);

            assert_eq!(state.status, status);
            assert_eq!(state.sensitivity, Sensitivity::High);
            assert_eq!(state.pause_remaining, Some(Duration::from_secs(123)));
            assert_eq!(state.cooldown_remaining, Some(Duration::from_secs(456)));
            assert_eq!(state.notification_remaining, Some(Duration::from_secs(12)));
            assert!(effects.is_empty());
        }
    }

    #[test]
    fn sync_config_activates_from_disabled_when_enabled() {
        let mut state = DetectionState::new();

        let effects = state.sync_config_at(true, true, Sensitivity::Low, Instant::now());

        assert_eq!(state.status, DetectionStatus::Active);
        assert_eq!(state.sensitivity, Sensitivity::Low);
        assert!(!state
            .suppression_reasons
            .contains(&SuppressionReason::SignedOut));
        assert_state_changed(&effects, DetectionStatus::Active, false);
    }

    #[test]
    fn sync_config_disables_on_sign_out() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Paused);
        state.pause_remaining = Some(Duration::from_secs(99));
        state.cooldown_remaining = Some(Duration::from_secs(88));
        state.notification_remaining = Some(Duration::from_secs(11));
        state.app_switches.push_back(now);
        state.last_stuck_detected_at = Some(now);

        let effects = state.sync_config_at(false, true, Sensitivity::Medium, now);

        assert_eq!(state.status, DetectionStatus::Disabled);
        assert!(state.app_switches.is_empty());
        assert_eq!(state.pause_remaining, None);
        assert_eq!(state.cooldown_remaining, None);
        assert_eq!(state.notification_remaining, None);
        assert_eq!(state.last_stuck_detected_at, None);
        assert!(state
            .suppression_reasons
            .contains(&SuppressionReason::SignedOut));
        assert_state_changed(&effects, DetectionStatus::Disabled, false);
    }

    #[test]
    fn sync_config_disables_when_detection_is_turned_off() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Cooldown);
        state.cooldown_remaining = Some(Duration::from_secs(88));
        state.notification_remaining = Some(Duration::from_secs(21));
        state.app_switches.push_back(now);
        state.last_stuck_detected_at = Some(now);
        state.suppression_reasons.extend([
            SuppressionReason::MeetingApp,
            SuppressionReason::AppForegrounded,
        ]);

        let effects = state.sync_config_at(true, false, Sensitivity::Medium, now);

        assert_eq!(state.status, DetectionStatus::Disabled);
        assert!(state.app_switches.is_empty());
        assert_eq!(state.pause_remaining, None);
        assert_eq!(state.cooldown_remaining, None);
        assert_eq!(state.notification_remaining, None);
        assert_eq!(state.last_stuck_detected_at, None);
        assert!(state.suppression_reasons.is_empty());
        assert!(!state
            .suppression_reasons
            .contains(&SuppressionReason::SignedOut));
        assert_state_changed(&effects, DetectionStatus::Disabled, false);
    }

    #[test]
    fn sync_config_sign_out_keeps_only_signed_out_suppression() {
        let mut state = signed_in_state(DetectionStatus::Suppressed);
        state.suppression_reasons.extend([
            SuppressionReason::MeetingApp,
            SuppressionReason::TimerRunning,
            SuppressionReason::AppForegrounded,
        ]);

        state.sync_config_at(false, true, Sensitivity::Medium, Instant::now());

        assert_eq!(state.status, DetectionStatus::Disabled);
        assert_eq!(
            state.suppression_reasons,
            HashSet::from([SuppressionReason::SignedOut])
        );
    }

    #[test]
    fn resume_only_transitions_from_paused() {
        let now = Instant::now();
        let mut paused = signed_in_state(DetectionStatus::Paused);
        paused.pause_remaining = Some(Duration::from_secs(50));

        let effects = paused.resume_at(now);

        assert_eq!(paused.status, DetectionStatus::Active);
        assert_eq!(paused.pause_remaining, None);
        assert_state_changed(&effects, DetectionStatus::Active, false);

        let mut cooldown = signed_in_state(DetectionStatus::Cooldown);
        cooldown.cooldown_remaining = Some(Duration::from_secs(70));

        let effects = cooldown.resume_at(now);

        assert_eq!(cooldown.status, DetectionStatus::Cooldown);
        assert_eq!(cooldown.cooldown_remaining, Some(Duration::from_secs(70)));
        assert!(effects.is_empty());
    }

    #[test]
    fn resume_from_paused_disables_when_signed_out_or_disabled() {
        let now = Instant::now();

        for (signed_in, enabled) in [(false, true), (true, false)] {
            let mut state = signed_in_state(DetectionStatus::Paused);
            state.signed_in = signed_in;
            state.enabled = enabled;
            state.pause_remaining = Some(Duration::from_secs(50));

            if !signed_in {
                state
                    .suppression_reasons
                    .insert(SuppressionReason::SignedOut);
            }

            let effects = state.resume_at(now);

            assert_eq!(state.status, DetectionStatus::Disabled);
            assert_eq!(state.pause_remaining, None);
            assert_eq!(state.cooldown_remaining, None);
            assert_eq!(state.notification_remaining, None);
            assert!(state.app_switches.is_empty());
            assert_eq!(state.last_foreground_bundle_id, None);
            assert_eq!(state.last_stuck_detected_at, None);
            assert_state_changed(&effects, DetectionStatus::Disabled, false);
        }
    }

    #[test]
    fn pause_ignores_invalid_states_and_keeps_allowed_ones() {
        let now = Instant::now();
        let mut disabled = DetectionState::new();
        let effects = disabled.pause_at(now);
        assert_eq!(disabled.status, DetectionStatus::Disabled);
        assert_eq!(disabled.pause_remaining, None);
        assert!(effects.is_empty());

        let mut notifying = signed_in_state(DetectionStatus::Notifying);
        let effects = notifying.pause_at(now);
        assert_eq!(notifying.status, DetectionStatus::Notifying);
        assert_eq!(notifying.pause_remaining, None);
        assert!(effects.is_empty());

        for status in [
            DetectionStatus::Active,
            DetectionStatus::Cooldown,
            DetectionStatus::Suppressed,
        ] {
            let mut state = signed_in_state(status);
            let effects = state.pause_at(now);

            assert_eq!(state.status, DetectionStatus::Paused);
            assert_eq!(state.pause_remaining, Some(PAUSE_DURATION));
            assert_eq!(state.notification_remaining, None);
            assert_state_changed(&effects, DetectionStatus::Paused, false);
        }
    }

    #[test]
    fn pause_is_idempotent_while_already_paused() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Paused);
        state.pause_remaining = Some(Duration::from_secs(123));
        state.cooldown_remaining = Some(Duration::from_secs(456));
        state.notification_remaining = Some(Duration::from_secs(12));

        let effects = state.pause_at(now);

        assert_eq!(state.status, DetectionStatus::Paused);
        assert_eq!(state.pause_remaining, Some(Duration::from_secs(123)));
        assert_eq!(state.cooldown_remaining, Some(Duration::from_secs(456)));
        assert_eq!(state.notification_remaining, Some(Duration::from_secs(12)));
        assert!(effects.is_empty());
    }

    #[test]
    fn dismiss_nudge_only_clears_nudge_state() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Cooldown);
        state.cooldown_remaining = Some(Duration::from_secs(30));
        state.last_stuck_detected_at = Some(now);

        let effects = state.dismiss_nudge_at(now);

        assert_eq!(state.status, DetectionStatus::Cooldown);
        assert_eq!(state.cooldown_remaining, Some(Duration::from_secs(30)));
        assert_eq!(state.last_stuck_detected_at, None);
        assert_state_changed(&effects, DetectionStatus::Cooldown, false);
    }

    #[test]
    fn recover_detection_state_lock_rebuilds_clean_active_state() {
        let now = Instant::now();
        let mutex = Mutex::new(signed_in_state(DetectionStatus::Paused));

        let panic_result = std::panic::catch_unwind(AssertUnwindSafe(|| {
            let mut state = mutex.lock().unwrap();
            state.sensitivity = Sensitivity::High;
            state.pause_remaining = Some(Duration::from_secs(90));
            state.cooldown_remaining = Some(Duration::from_secs(45));
            state.last_idle_seconds = 17;
            state.notifications_today = 3;
            state.app_switches.push_back(now);
            state.last_stuck_detected_at = Some(now);
            panic!("poison detection state");
        }));

        assert!(panic_result.is_err());

        let state = recover_detection_state_lock(&mutex, "test");

        assert_eq!(state.status, DetectionStatus::Active);
        assert_eq!(state.sensitivity, Sensitivity::High);
        assert_eq!(state.last_idle_seconds, 17);
        assert_eq!(state.notifications_today, 3);
        assert_eq!(state.pause_remaining, None);
        assert_eq!(state.cooldown_remaining, None);
        assert_eq!(state.notification_remaining, None);
        assert_eq!(state.last_stuck_detected_at, None);
        assert!(state.app_switches.is_empty());
    }

    #[test]
    fn recover_detection_state_lock_restores_runtime_suppression() {
        let mutex = Mutex::new(signed_in_state(DetectionStatus::Active));

        let panic_result = std::panic::catch_unwind(AssertUnwindSafe(|| {
            let mut state = mutex.lock().unwrap();
            state.app_foregrounded = true;
            panic!("poison detection state");
        }));

        assert!(panic_result.is_err());

        let state = recover_detection_state_lock(&mutex, "test");

        assert_eq!(state.status, DetectionStatus::Suppressed);
        assert!(state
            .suppression_reasons
            .contains(&SuppressionReason::AppForegrounded));
    }

    #[test]
    fn recover_detection_state_lock_clears_mutex_poison_after_recovery() {
        let now = Instant::now();
        let mutex = Mutex::new(signed_in_state(DetectionStatus::Paused));

        let panic_result = std::panic::catch_unwind(AssertUnwindSafe(|| {
            let mut state = mutex.lock().unwrap();
            state.pause_remaining = Some(Duration::from_secs(90));
            panic!("poison detection state");
        }));

        assert!(panic_result.is_err());
        assert!(mutex.is_poisoned());

        {
            let mut state = recover_detection_state_lock(&mutex, "test");
            state.pause_remaining = Some(Duration::from_secs(12));
            state.app_switches.push_back(now);
        }

        assert!(!mutex.is_poisoned());

        let state = mutex
            .lock()
            .expect("poison should be cleared after the first recovery");

        assert_eq!(state.status, DetectionStatus::Active);
        assert_eq!(state.pause_remaining, Some(Duration::from_secs(12)));
        assert_eq!(state.app_switches.len(), 1);
    }

    #[test]
    fn record_app_switch_is_ignored_while_disabled() {
        let now = Instant::now();
        let mut state = DetectionState::new();

        state.record_app_switch_at(Some("com.apple.TextEdit"), now);

        assert_eq!(state.app_switch_count(), 0);
        assert_eq!(
            state.last_foreground_bundle_id.as_deref(),
            Some("com.apple.TextEdit")
        );
    }

    #[test]
    fn record_app_switch_tracks_enabled_runtime_and_clear_resets_window() {
        let now = Instant::now();
        let mut state = DetectionState::new();
        state.sync_config_at(true, true, Sensitivity::Medium, now);

        state.record_app_switch_at(Some("com.apple.TextEdit"), now);
        state.update_idle_seconds_at(42, now + Duration::from_secs(5), state.today_date);

        assert_eq!(state.app_switch_count(), 1);
        assert_eq!(state.last_idle_seconds, 42);
        assert_eq!(
            state.last_foreground_bundle_id.as_deref(),
            Some("com.apple.TextEdit")
        );

        state.clear_app_switches_at(now + Duration::from_secs(10));

        assert_eq!(state.app_switch_count(), 0);
    }

    #[test]
    fn idle_tick_prunes_stale_switches_before_evaluating() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Active);
        state.sensitivity = Sensitivity::High;
        state.last_tick = now;
        state
            .app_switches
            .push_back(now - WINDOW_DURATION - Duration::from_secs(1));

        for offset in 1..=4 {
            state
                .app_switches
                .push_back(now - Duration::from_secs(offset * 30));
        }

        let effects =
            state.update_idle_seconds_at(30, now + Duration::from_secs(5), state.today_date);

        assert_eq!(state.app_switch_count(), 4);
        assert!(effects.is_empty());
        assert_eq!(state.status, DetectionStatus::Active);
    }

    #[test]
    fn meeting_app_switch_toggles_runtime_suppression() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Active);

        let effects = state.record_app_switch_at(Some("us.zoom.xos"), now);

        assert_eq!(state.status, DetectionStatus::Suppressed);
        assert!(state
            .suppression_reasons
            .contains(&SuppressionReason::MeetingApp));
        assert_state_changed(&effects, DetectionStatus::Suppressed, false);

        let effects = state.record_app_switch_at(Some("com.apple.TextEdit"), now);

        assert_eq!(state.status, DetectionStatus::Active);
        assert!(!state
            .suppression_reasons
            .contains(&SuppressionReason::MeetingApp));
        assert_state_changed(&effects, DetectionStatus::Active, false);
    }

    #[test]
    fn app_foreground_suppression_applies_immediately_and_survives_reenable() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Active);

        let effects = state.set_app_foregrounded_at(true, now);

        assert_eq!(state.status, DetectionStatus::Suppressed);
        assert!(state
            .suppression_reasons
            .contains(&SuppressionReason::AppForegrounded));
        assert_state_changed(&effects, DetectionStatus::Suppressed, false);

        let effects = state.sync_config_at(true, false, Sensitivity::Medium, now);
        assert_eq!(state.status, DetectionStatus::Disabled);
        assert_state_changed(&effects, DetectionStatus::Disabled, false);

        let effects = state.sync_config_at(true, true, Sensitivity::Medium, now);
        assert_eq!(state.status, DetectionStatus::Suppressed);
        assert!(state
            .suppression_reasons
            .contains(&SuppressionReason::AppForegrounded));
        assert_state_changed(&effects, DetectionStatus::Suppressed, false);

        let effects = state.set_app_foregrounded_at(false, now);
        assert_eq!(state.status, DetectionStatus::Active);
        assert!(!state
            .suppression_reasons
            .contains(&SuppressionReason::AppForegrounded));
        assert_state_changed(&effects, DetectionStatus::Active, false);
    }

    #[test]
    fn detection_triggers_notification_and_starts_cooldown_tracking() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Active);
        state.sensitivity = Sensitivity::High;
        state.last_tick = now;

        for offset in 0..5 {
            state
                .app_switches
                .push_back(now - Duration::from_secs(offset * 20));
        }

        let effects =
            state.update_idle_seconds_at(15, now + Duration::from_secs(5), state.today_date);

        assert_eq!(state.status, DetectionStatus::Notifying);
        assert_eq!(state.notifications_today, 1);
        assert_eq!(state.cooldown_remaining, Some(COOLDOWN_DURATION));
        assert_eq!(state.notification_remaining, Some(NOTIFICATION_DURATION));
        assert_eq!(
            state.last_stuck_detected_at,
            Some(now + Duration::from_secs(5))
        );
        assert!(effects
            .iter()
            .any(|effect| matches!(effect, DetectionRuntimeEffect::SendNotification)));
        assert_state_changed(&effects, DetectionStatus::Notifying, true);
    }

    #[test]
    fn notification_expiry_transitions_to_cooldown_without_second_notification() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Notifying);
        state.last_tick = now;
        state.cooldown_remaining = Some(COOLDOWN_DURATION);
        state.notification_remaining = Some(Duration::from_secs(10));
        state.last_stuck_detected_at = Some(now);

        let effects =
            state.update_idle_seconds_at(20, now + Duration::from_secs(10), state.today_date);

        assert_eq!(state.status, DetectionStatus::Cooldown);
        assert_eq!(
            state.cooldown_remaining,
            Some(COOLDOWN_DURATION.saturating_sub(Duration::from_secs(10)))
        );
        assert_eq!(state.notification_remaining, None);
        assert!(!effects
            .iter()
            .any(|effect| matches!(effect, DetectionRuntimeEffect::SendNotification)));
        assert_state_changed(&effects, DetectionStatus::Cooldown, true);
    }

    #[test]
    fn pausing_and_resuming_from_cooldown_restores_cooldown_state() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Cooldown);
        state.cooldown_remaining = Some(Duration::from_secs(70));

        let pause_effects = state.pause_at(now);

        assert_eq!(state.status, DetectionStatus::Paused);
        assert_eq!(state.pause_remaining, Some(PAUSE_DURATION));
        assert_eq!(state.cooldown_remaining, Some(Duration::from_secs(70)));
        assert_state_changed(&pause_effects, DetectionStatus::Paused, false);

        let resume_effects = state.resume_at(now + Duration::from_secs(5));

        assert_eq!(state.status, DetectionStatus::Cooldown);
        assert_eq!(state.pause_remaining, None);
        assert_eq!(state.cooldown_remaining, Some(Duration::from_secs(70)));
        assert_eq!(
            state
                .status_response_at(now + Duration::from_secs(5))
                .resume_in_seconds,
            Some(70)
        );
        assert_state_changed(&resume_effects, DetectionStatus::Cooldown, false);
    }

    #[test]
    fn pause_expiry_from_cooldown_restores_cooldown_state() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Paused);
        state.last_tick = now;
        state.pause_remaining = Some(Duration::from_secs(5));
        state.cooldown_remaining = Some(Duration::from_secs(70));

        let effects =
            state.update_idle_seconds_at(30, now + Duration::from_secs(5), state.today_date);

        assert_eq!(state.status, DetectionStatus::Cooldown);
        assert_eq!(state.pause_remaining, None);
        assert_eq!(state.cooldown_remaining, Some(Duration::from_secs(65)));
        assert_eq!(
            state
                .status_response_at(now + Duration::from_secs(5))
                .resume_in_seconds,
            Some(65)
        );
        assert_state_changed(&effects, DetectionStatus::Cooldown, false);
    }

    #[test]
    fn cooldown_expiry_returns_to_active_and_clears_nudge() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Cooldown);
        state.last_tick = now;
        state.cooldown_remaining = Some(Duration::from_secs(5));
        state.last_stuck_detected_at = Some(now - Duration::from_secs(10));

        let effects =
            state.update_idle_seconds_at(20, now + Duration::from_secs(5), state.today_date);

        assert_eq!(state.status, DetectionStatus::Active);
        assert_eq!(state.cooldown_remaining, None);
        assert_eq!(state.last_stuck_detected_at, None);
        assert_state_changed(&effects, DetectionStatus::Active, false);
    }

    #[test]
    fn daily_notification_cap_blocks_additional_notifications_until_day_rollover() {
        let now = Instant::now();
        let today = Local::now().date_naive();
        let tomorrow = today.succ_opt().expect("tomorrow exists");
        let mut state = signed_in_state(DetectionStatus::Active);
        state.sensitivity = Sensitivity::High;
        state.last_tick = now;
        state.notifications_today = DAILY_NOTIFICATION_CAP;

        for offset in 0..5 {
            state
                .app_switches
                .push_back(now - Duration::from_secs(offset * 20));
        }

        let effects = state.update_idle_seconds_at(10, now + Duration::from_secs(5), today);

        assert_eq!(state.status, DetectionStatus::Active);
        assert_eq!(state.notifications_today, DAILY_NOTIFICATION_CAP);
        assert!(effects.is_empty());

        let effects = state.update_idle_seconds_at(10, now + Duration::from_secs(10), tomorrow);

        assert_eq!(state.today_date, tomorrow);
        assert_eq!(state.status, DetectionStatus::Notifying);
        assert_eq!(state.notifications_today, 1);
        assert!(effects
            .iter()
            .any(|effect| matches!(effect, DetectionRuntimeEffect::SendNotification)));
    }

    #[test]
    fn stale_nudge_is_cleared_even_without_status_change() {
        let now = Instant::now();
        let mut state = signed_in_state(DetectionStatus::Cooldown);
        state.last_tick = now;
        state.cooldown_remaining = Some(Duration::from_secs(120));
        state.last_stuck_detected_at = Some(now - NUDGE_DURATION - Duration::from_secs(1));

        let effects =
            state.update_idle_seconds_at(10, now + Duration::from_secs(5), state.today_date);

        assert_eq!(state.status, DetectionStatus::Cooldown);
        assert_eq!(state.last_stuck_detected_at, None);
        assert_state_changed(&effects, DetectionStatus::Cooldown, false);
    }

    #[test]
    fn runtime_effect_execution_continues_after_notification_failures() {
        let calls = RefCell::new(Vec::new());
        let payload = DetectionStatusResponse {
            status: DetectionStatus::Notifying,
            resume_in_seconds: None,
            nudge_active: true,
        };

        let result = execute_runtime_effects_with(
            vec![
                DetectionRuntimeEffect::SendNotification,
                DetectionRuntimeEffect::EmitStateChanged(payload.clone()),
            ],
            || {
                calls.borrow_mut().push("notify");
                Err("notification failed".to_string())
            },
            |emitted_payload| {
                calls.borrow_mut().push("emit");
                assert_eq!(emitted_payload, payload);
                Ok(())
            },
        );

        assert_eq!(*calls.borrow(), vec!["notify", "emit"]);
        assert_eq!(result, Err("notification failed".to_string()));
    }
}
