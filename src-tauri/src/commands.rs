use std::sync::Mutex;

use tauri::{plugin::PermissionState, AppHandle, State, Wry};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

use crate::detection::DetectionDebugResponse;
use crate::{
    detection::{
        recover_detection_state_lock, DetectionState, DetectionStatusResponse, Sensitivity,
    },
    execute_detection_effects,
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

fn log_nonblocking_error(message: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[commands] {message}");
}
