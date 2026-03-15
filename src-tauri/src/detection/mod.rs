pub mod platform;

use std::{
    collections::{HashSet, VecDeque},
    time::{Duration, Instant},
};

use chrono::{Local, NaiveDate};
use serde::Serialize;

const PAUSE_DURATION: Duration = Duration::from_secs(2 * 60 * 60);

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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
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
    pub fn from_input(value: &str) -> Option<Self> {
        match value {
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            _ => None,
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
    pub last_foreground_bundle_id: Option<String>,
    pub last_idle_seconds: u64,
    pub cooldown_remaining: Option<Duration>,
    pub pause_remaining: Option<Duration>,
    pub last_tick: Instant,
    pub suppression_reasons: HashSet<SuppressionReason>,
    pub notifications_today: u32,
    pub today_date: NaiveDate,
    pub last_stuck_detected_at: Option<Instant>,
}

impl DetectionState {
    pub fn new() -> Self {
        Self {
            status: DetectionStatus::Disabled,
            sensitivity: Sensitivity::default(),
            enabled: false,
            signed_in: false,
            app_switches: VecDeque::new(),
            last_foreground_bundle_id: None,
            last_idle_seconds: 0,
            cooldown_remaining: None,
            pause_remaining: None,
            last_tick: Instant::now(),
            suppression_reasons: HashSet::from([SuppressionReason::SignedOut]),
            notifications_today: 0,
            today_date: Local::now().date_naive(),
            last_stuck_detected_at: None,
        }
    }

    pub fn sync_config(&mut self, signed_in: bool, enabled: bool, sensitivity: Sensitivity) {
        self.signed_in = signed_in;
        self.enabled = enabled;
        self.sensitivity = sensitivity;
        self.last_tick = Instant::now();

        if signed_in {
            self.suppression_reasons
                .remove(&SuppressionReason::SignedOut);
        } else {
            self.suppression_reasons
                .insert(SuppressionReason::SignedOut);
        }

        if !signed_in || !enabled {
            self.disable();
            return;
        }

        if self.status == DetectionStatus::Disabled {
            self.status = DetectionStatus::Active;
        }
    }

    pub fn pause(&mut self) {
        if matches!(
            self.status,
            DetectionStatus::Active | DetectionStatus::Cooldown | DetectionStatus::Suppressed
        ) {
            self.status = DetectionStatus::Paused;
            self.pause_remaining = Some(PAUSE_DURATION);
        }
    }

    pub fn resume(&mut self) {
        if self.status == DetectionStatus::Paused {
            self.pause_remaining = None;
            self.status = if self.signed_in && self.enabled {
                DetectionStatus::Active
            } else {
                DetectionStatus::Disabled
            };
        }
    }

    pub fn dismiss_nudge(&mut self) {
        self.last_stuck_detected_at = None;
    }

    pub fn record_app_switch(&mut self, bundle_id: Option<&str>) {
        self.last_foreground_bundle_id = bundle_id.map(ToOwned::to_owned);

        if !(self.signed_in && self.enabled) {
            return;
        }

        self.app_switches.push_back(Instant::now());
    }

    pub fn update_idle_seconds(&mut self, idle_seconds: u64) {
        self.last_idle_seconds = idle_seconds;
        self.last_tick = Instant::now();
    }

    pub fn clear_app_switches(&mut self) {
        self.app_switches.clear();
        self.last_tick = Instant::now();
    }

    pub fn app_switch_count(&self) -> usize {
        self.app_switches.len()
    }

    fn resume_in_seconds(&self) -> Option<u64> {
        match self.status {
            DetectionStatus::Paused => self.pause_remaining.map(|duration| duration.as_secs()),
            DetectionStatus::Cooldown => self.cooldown_remaining.map(|duration| duration.as_secs()),
            _ => None,
        }
    }

    fn disable(&mut self) {
        self.status = DetectionStatus::Disabled;
        self.app_switches.clear();
        self.last_foreground_bundle_id = None;
        self.cooldown_remaining = None;
        self.pause_remaining = None;
        self.last_stuck_detected_at = None;
        self.suppression_reasons
            .retain(|reason| *reason == SuppressionReason::SignedOut);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionStatusResponse {
    pub status: DetectionStatus,
    pub resume_in_seconds: Option<u64>,
    pub nudge_active: bool,
}

impl From<&DetectionState> for DetectionStatusResponse {
    fn from(state: &DetectionState) -> Self {
        Self {
            status: state.status,
            resume_in_seconds: state.resume_in_seconds(),
            nudge_active: state.last_stuck_detected_at.is_some(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionDebugResponse {
    pub app_switch_count: usize,
    pub idle_seconds: u64,
    pub last_foreground_bundle_id: Option<String>,
}

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

    #[test]
    fn sync_config_preserves_runtime_states_when_reenabled() {
        for status in [
            DetectionStatus::Paused,
            DetectionStatus::Cooldown,
            DetectionStatus::Suppressed,
            DetectionStatus::Notifying,
        ] {
            let mut state = signed_in_state(status);
            state.pause_remaining = Some(Duration::from_secs(123));
            state.cooldown_remaining = Some(Duration::from_secs(456));

            state.sync_config(true, true, Sensitivity::High);

            assert_eq!(state.status, status);
            assert_eq!(state.sensitivity, Sensitivity::High);
        }
    }

    #[test]
    fn sync_config_activates_from_disabled_when_enabled() {
        let mut state = DetectionState::new();

        state.sync_config(true, true, Sensitivity::Low);

        assert_eq!(state.status, DetectionStatus::Active);
        assert_eq!(state.sensitivity, Sensitivity::Low);
        assert!(!state
            .suppression_reasons
            .contains(&SuppressionReason::SignedOut));
    }

    #[test]
    fn sync_config_disables_on_sign_out() {
        let mut state = signed_in_state(DetectionStatus::Paused);
        state.pause_remaining = Some(Duration::from_secs(99));
        state.cooldown_remaining = Some(Duration::from_secs(88));
        state.app_switches.push_back(Instant::now());
        state.last_stuck_detected_at = Some(Instant::now());

        state.sync_config(false, true, Sensitivity::Medium);

        assert_eq!(state.status, DetectionStatus::Disabled);
        assert!(state.app_switches.is_empty());
        assert_eq!(state.pause_remaining, None);
        assert_eq!(state.cooldown_remaining, None);
        assert_eq!(state.last_stuck_detected_at, None);
        assert!(state
            .suppression_reasons
            .contains(&SuppressionReason::SignedOut));
    }

    #[test]
    fn sync_config_disables_when_detection_is_turned_off() {
        let mut state = signed_in_state(DetectionStatus::Cooldown);
        state.cooldown_remaining = Some(Duration::from_secs(88));
        state.app_switches.push_back(Instant::now());
        state.last_stuck_detected_at = Some(Instant::now());
        state.suppression_reasons.extend([
            SuppressionReason::MeetingApp,
            SuppressionReason::AppForegrounded,
        ]);

        state.sync_config(true, false, Sensitivity::Medium);

        assert_eq!(state.status, DetectionStatus::Disabled);
        assert!(state.app_switches.is_empty());
        assert_eq!(state.pause_remaining, None);
        assert_eq!(state.cooldown_remaining, None);
        assert_eq!(state.last_stuck_detected_at, None);
        assert!(state.suppression_reasons.is_empty());
        assert!(!state
            .suppression_reasons
            .contains(&SuppressionReason::SignedOut));
    }

    #[test]
    fn sync_config_sign_out_keeps_only_signed_out_suppression() {
        let mut state = signed_in_state(DetectionStatus::Suppressed);
        state.suppression_reasons.extend([
            SuppressionReason::MeetingApp,
            SuppressionReason::TimerRunning,
            SuppressionReason::AppForegrounded,
        ]);

        state.sync_config(false, true, Sensitivity::Medium);

        assert_eq!(state.status, DetectionStatus::Disabled);
        assert_eq!(
            state.suppression_reasons,
            HashSet::from([SuppressionReason::SignedOut])
        );
    }

    #[test]
    fn resume_only_transitions_from_paused() {
        let mut paused = signed_in_state(DetectionStatus::Paused);
        paused.pause_remaining = Some(Duration::from_secs(50));

        paused.resume();

        assert_eq!(paused.status, DetectionStatus::Active);
        assert_eq!(paused.pause_remaining, None);

        let mut cooldown = signed_in_state(DetectionStatus::Cooldown);
        cooldown.cooldown_remaining = Some(Duration::from_secs(70));

        cooldown.resume();

        assert_eq!(cooldown.status, DetectionStatus::Cooldown);
        assert_eq!(cooldown.cooldown_remaining, Some(Duration::from_secs(70)));
    }

    #[test]
    fn pause_ignores_invalid_states_and_keeps_allowed_ones() {
        let mut disabled = DetectionState::new();
        disabled.pause();
        assert_eq!(disabled.status, DetectionStatus::Disabled);
        assert_eq!(disabled.pause_remaining, None);

        let mut notifying = signed_in_state(DetectionStatus::Notifying);
        notifying.pause();
        assert_eq!(notifying.status, DetectionStatus::Notifying);
        assert_eq!(notifying.pause_remaining, None);

        for status in [
            DetectionStatus::Active,
            DetectionStatus::Cooldown,
            DetectionStatus::Suppressed,
        ] {
            let mut state = signed_in_state(status);
            state.pause();

            assert_eq!(state.status, DetectionStatus::Paused);
            assert_eq!(state.pause_remaining, Some(PAUSE_DURATION));
        }
    }

    #[test]
    fn dismiss_nudge_only_clears_nudge_state() {
        let mut state = signed_in_state(DetectionStatus::Cooldown);
        state.cooldown_remaining = Some(Duration::from_secs(30));
        state.last_stuck_detected_at = Some(Instant::now());

        state.dismiss_nudge();

        assert_eq!(state.status, DetectionStatus::Cooldown);
        assert_eq!(state.cooldown_remaining, Some(Duration::from_secs(30)));
        assert_eq!(state.last_stuck_detected_at, None);
    }

    #[test]
    fn record_app_switch_is_ignored_while_disabled() {
        let mut state = DetectionState::new();

        state.record_app_switch(Some("com.apple.TextEdit"));

        assert_eq!(state.app_switch_count(), 0);
        assert_eq!(
            state.last_foreground_bundle_id.as_deref(),
            Some("com.apple.TextEdit")
        );
    }

    #[test]
    fn record_app_switch_tracks_enabled_runtime_and_clear_resets_window() {
        let mut state = DetectionState::new();
        state.sync_config(true, true, Sensitivity::Medium);

        state.record_app_switch(Some("com.apple.TextEdit"));
        state.update_idle_seconds(42);

        assert_eq!(state.app_switch_count(), 1);
        assert_eq!(state.last_idle_seconds, 42);
        assert_eq!(
            state.last_foreground_bundle_id.as_deref(),
            Some("com.apple.TextEdit")
        );

        state.clear_app_switches();

        assert_eq!(state.app_switch_count(), 0);
    }
}
