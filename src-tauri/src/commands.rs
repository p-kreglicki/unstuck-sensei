use std::sync::Mutex;

use chrono::{DateTime, Utc};
use tauri::{plugin::PermissionState, AppHandle, State, Wry};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

use crate::detection::DetectionDebugResponse;
use crate::{
    detection::{
        recover_detection_state_lock, DetectionState, DetectionStatusResponse, Sensitivity,
    },
    execute_detection_effects,
    timer::{
        execute_timer_effects, maybe_spawn_tick_loop, recover_timer_state_lock, TimerPendingSync,
        TimerRuntimeEffect, TimerState, TimerStatusResponse,
    },
};

const APP_PREFERENCES_STORE: &str = "app-preferences.json";
const NOTIFICATION_PERMISSION_ASKED_KEY: &str = "notificationPermissionAsked";

fn with_detection_state<T>(
    state: &State<'_, Mutex<DetectionState>>,
    handler: impl FnOnce(&mut DetectionState) -> T,
) -> Result<T, String> {
    let mut state = recover_detection_state_lock(state.inner(), "commands");

    Ok(handler(&mut state))
}

fn with_timer_state<T>(
    state: &State<'_, Mutex<TimerState>>,
    handler: impl FnOnce(&mut TimerState) -> T,
) -> Result<T, String> {
    let mut state = recover_timer_state_lock(state.inner(), "commands");
    Ok(handler(&mut state))
}

#[tauri::command]
pub fn sync_detection_config(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<DetectionState>>,
    signed_in: bool,
    enabled: bool,
    sensitivity: Sensitivity,
) -> Result<(), String> {
    let effects = with_detection_state(&state, |state| {
        state.sync_config(signed_in, enabled, sensitivity)
    })?;

    execute_detection_effects(&app, effects, true)?;
    maybe_request_notification_permission(&app, signed_in);

    Ok(())
}

#[tauri::command]
pub fn get_detection_status(
    state: State<'_, Mutex<DetectionState>>,
) -> Result<DetectionStatusResponse, String> {
    with_detection_state(&state, |state| state.status_response())
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn get_detection_debug(
    state: State<'_, Mutex<DetectionState>>,
) -> Result<DetectionDebugResponse, String> {
    with_detection_state(&state, |state| DetectionDebugResponse::from(&*state))
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn get_detection_debug(
    _state: State<'_, Mutex<DetectionState>>,
) -> Result<DetectionDebugResponse, String> {
    Err("Detection debug is not available in release builds.".to_string())
}

#[tauri::command]
pub fn pause_detection(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<DetectionState>>,
) -> Result<(), String> {
    let effects = with_detection_state(&state, |state| state.pause())?;
    execute_detection_effects(&app, effects, false)
}

#[tauri::command]
pub fn resume_detection(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<DetectionState>>,
) -> Result<(), String> {
    let effects = with_detection_state(&state, |state| state.resume())?;
    execute_detection_effects(&app, effects, false)
}

#[tauri::command]
pub fn dismiss_nudge(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<DetectionState>>,
) -> Result<(), String> {
    let effects = with_detection_state(&state, |state| state.dismiss_nudge())?;
    execute_detection_effects(&app, effects, false)
}

fn maybe_request_notification_permission(app: &AppHandle<Wry>, signed_in: bool) {
    if !signed_in {
        return;
    }

    let store = match app.store(APP_PREFERENCES_STORE) {
        Ok(store) => store,
        Err(error) => {
            log_nonblocking_error(&format!("failed to open app store: {error}"));
            return;
        }
    };

    if store
        .get(NOTIFICATION_PERMISSION_ASKED_KEY)
        .and_then(|value| value.as_bool())
        == Some(true)
    {
        return;
    }

    let permission_state = match app.notification().permission_state() {
        Ok(permission_state) => permission_state,
        Err(error) => {
            log_nonblocking_error(&format!(
                "failed to read notification permission state: {error}"
            ));
            return;
        }
    };

    if !matches!(
        permission_state,
        PermissionState::Prompt | PermissionState::PromptWithRationale
    ) {
        return;
    }

    let request_result = app.notification().request_permission();

    if let Err(error) = request_result {
        log_nonblocking_error(&format!(
            "failed to request notification permission: {error}"
        ));
        return;
    }

    store.set(NOTIFICATION_PERMISSION_ASKED_KEY, true);

    if let Err(error) = store.save() {
        log_nonblocking_error(&format!(
            "failed to persist notification permission flag: {error}"
        ));
    }
}

#[tauri::command]
pub fn start_timer(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<TimerState>>,
    session_id: String,
    block_id: String,
    started_at: String,
    duration_secs: u32,
    timer_revision: i32,
) -> Result<TimerStatusResponse, String> {
    let started_at = parse_timestamp(&started_at)?;
    let effects = with_timer_state(&state, |state| {
        state.start(session_id, block_id, started_at, duration_secs, timer_revision)
    })??;

    execute_timer_effects(&app, effects)?;
    maybe_spawn_tick_loop(app.clone());

    get_timer_state(state)
}

#[tauri::command]
pub fn stop_timer(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<TimerState>>,
) -> Result<TimerStatusResponse, String> {
    let effects = with_timer_state(&state, |state| state.stop())??;
    execute_timer_effects(&app, effects)?;
    get_timer_state(state)
}

#[tauri::command]
pub fn extend_timer(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<TimerState>>,
    session_id: String,
    block_id: String,
    started_at: String,
    duration_secs: u32,
    timer_revision: i32,
) -> Result<TimerStatusResponse, String> {
    let started_at = parse_timestamp(&started_at)?;
    let effects = with_timer_state(&state, |state| {
        state.extend(session_id, block_id, started_at, duration_secs, timer_revision)
    })??;

    execute_timer_effects(&app, effects)?;
    maybe_spawn_tick_loop(app.clone());

    get_timer_state(state)
}

#[tauri::command]
pub fn resolve_checkin(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<TimerState>>,
) -> Result<TimerStatusResponse, String> {
    let effects = with_timer_state(&state, |state| state.resolve_checkin())??;
    execute_timer_effects(&app, effects)?;
    get_timer_state(state)
}

#[tauri::command]
pub fn get_timer_state(
    state: State<'_, Mutex<TimerState>>,
) -> Result<TimerStatusResponse, String> {
    with_timer_state(&state, |state| state.status_response())
}

#[tauri::command]
pub fn get_pending_timer_syncs(
    state: State<'_, Mutex<TimerState>>,
) -> Result<Vec<TimerPendingSync>, String> {
    with_timer_state(&state, |state| state.pending_syncs.clone())
}

#[tauri::command]
pub fn clear_pending_timer_syncs(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<TimerState>>,
    sync_ids: Vec<String>,
) -> Result<(), String> {
    with_timer_state(&state, |state| {
        state.pending_syncs.retain(|sync| !sync_ids.contains(&sync.id));
    })?;

    execute_timer_effects(&app, vec![TimerRuntimeEffect::PersistSnapshot])
}

#[tauri::command]
pub fn hydrate_running_timer(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<TimerState>>,
    session_id: String,
    block_id: String,
    started_at: String,
    duration_secs: u32,
    extended: bool,
    timer_revision: i32,
) -> Result<TimerStatusResponse, String> {
    let started_at = parse_timestamp(&started_at)?;
    let effects = with_timer_state(&state, |state| {
        state.hydrate_running(
            session_id,
            block_id,
            started_at,
            duration_secs,
            extended,
            timer_revision,
        )
    })?;

    execute_timer_effects(&app, effects)?;
    maybe_spawn_tick_loop(app.clone());
    get_timer_state(state)
}

#[tauri::command]
pub fn hydrate_awaiting_checkin(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<TimerState>>,
    session_id: String,
    block_id: String,
    checkin_started_at: String,
    duration_secs: u32,
    extended: bool,
    timer_revision: i32,
) -> Result<TimerStatusResponse, String> {
    let checkin_started_at = parse_timestamp(&checkin_started_at)?;
    let effects = with_timer_state(&state, |state| {
        state.hydrate_awaiting_checkin(
            session_id,
            block_id,
            checkin_started_at,
            duration_secs,
            extended,
            timer_revision,
        )
    })?;

    execute_timer_effects(&app, effects)?;
    get_timer_state(state)
}

#[tauri::command]
pub fn clear_timer_state(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<TimerState>>,
) -> Result<TimerStatusResponse, String> {
    let effects = with_timer_state(&state, |state| state.clear_runtime())?;
    execute_timer_effects(&app, effects)?;
    get_timer_state(state)
}

fn log_nonblocking_error(message: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[commands] {message}");
}

fn parse_timestamp(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| error.to_string())
}
