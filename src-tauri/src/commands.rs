use std::sync::Mutex;

use tauri::{AppHandle, State, Wry};

use crate::{
    detection::{DetectionState, DetectionStatusResponse, Sensitivity},
    sync_tray_auth_state,
};

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

    {
        let mut state = state
            .lock()
            .map_err(|_| "Detection state lock is poisoned.".to_string())?;
        state.sync_config(signed_in, enabled, sensitivity);
    }

    sync_tray_auth_state(&app, signed_in)
}

#[tauri::command]
pub fn get_detection_status(
    state: State<'_, Mutex<DetectionState>>,
) -> Result<DetectionStatusResponse, String> {
    let state = state
        .lock()
        .map_err(|_| "Detection state lock is poisoned.".to_string())?;

    Ok(DetectionStatusResponse::from(&*state))
}

#[tauri::command]
pub fn pause_detection(state: State<'_, Mutex<DetectionState>>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Detection state lock is poisoned.".to_string())?;
    state.pause();
    Ok(())
}

#[tauri::command]
pub fn resume_detection(state: State<'_, Mutex<DetectionState>>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Detection state lock is poisoned.".to_string())?;
    state.resume();
    Ok(())
}

#[tauri::command]
pub fn dismiss_nudge(state: State<'_, Mutex<DetectionState>>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Detection state lock is poisoned.".to_string())?;
    state.dismiss_nudge();
    Ok(())
}
