use std::sync::Mutex;

use tauri::{AppHandle, State, Wry};

#[cfg(debug_assertions)]
use crate::detection::DetectionDebugResponse;
use crate::{
    detection::{execute_runtime_effects, DetectionState, DetectionStatusResponse, Sensitivity},
    sync_tray_auth_state,
};

fn with_detection_state<T>(
    state: &State<'_, Mutex<DetectionState>>,
    handler: impl FnOnce(&mut DetectionState) -> T,
) -> Result<T, String> {
    let mut state = state
        .lock()
        .map_err(|_| "Detection state lock is poisoned.".to_string())?;

    Ok(handler(&mut state))
}

#[tauri::command]
pub fn sync_detection_config(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<DetectionState>>,
    signed_in: bool,
    enabled: bool,
    sensitivity: String,
) -> Result<(), String> {
    let sensitivity = Sensitivity::from_input(&sensitivity)
        .ok_or_else(|| format!("Unsupported sensitivity: {sensitivity}"))?;

    let effects = with_detection_state(&state, |state| {
        state.sync_config(signed_in, enabled, sensitivity)
    })?;

    execute_runtime_effects(&app, effects)?;
    sync_tray_auth_state(&app, signed_in)
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

#[tauri::command]
pub fn pause_detection(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<DetectionState>>,
) -> Result<(), String> {
    let effects = with_detection_state(&state, |state| state.pause())?;
    execute_runtime_effects(&app, effects)
}

#[tauri::command]
pub fn resume_detection(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<DetectionState>>,
) -> Result<(), String> {
    let effects = with_detection_state(&state, |state| state.resume())?;
    execute_runtime_effects(&app, effects)
}

#[tauri::command]
pub fn dismiss_nudge(
    app: AppHandle<Wry>,
    state: State<'_, Mutex<DetectionState>>,
) -> Result<(), String> {
    let effects = with_detection_state(&state, |state| state.dismiss_nudge())?;
    execute_runtime_effects(&app, effects)
}
