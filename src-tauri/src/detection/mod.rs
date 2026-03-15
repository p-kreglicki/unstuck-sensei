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
            self.app_switches.clear();
            self.cooldown_remaining = None;
            self.pause_remaining = None;
            self.last_stuck_detected_at = None;
        }

        self.status = if signed_in && enabled {
            DetectionStatus::Active
        } else {
            DetectionStatus::Disabled
        };
    }

    pub fn pause(&mut self) {
        self.status = DetectionStatus::Paused;
        self.pause_remaining = Some(PAUSE_DURATION);
    }

    pub fn resume(&mut self) {
        self.pause_remaining = None;
        self.status = if self.signed_in && self.enabled {
            DetectionStatus::Active
        } else {
            DetectionStatus::Disabled
        };
    }

    pub fn dismiss_nudge(&mut self) {
        self.last_stuck_detected_at = None;
    }

    fn resume_in_seconds(&self) -> Option<u64> {
        match self.status {
            DetectionStatus::Paused => self.pause_remaining.map(|duration| duration.as_secs()),
            DetectionStatus::Cooldown => self.cooldown_remaining.map(|duration| duration.as_secs()),
            _ => None,
        }
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
