use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

mod commands;
mod detection;

use serde::Serialize;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent, Wry,
};

use crate::detection::{
    execute_runtime_effects, recover_detection_state_lock, DetectionRuntimeEffect, DetectionState,
    DetectionStatus,
};

const TRAY_ID: &str = "main";
const APP_NAVIGATE_EVENT: &str = "app:navigate";
const MENU_SIGN_IN: &str = "sign-in";
const MENU_START_SESSION: &str = "start-session";
const MENU_PAUSE_DETECTION: &str = "pause-detection";
const MENU_SETTINGS: &str = "settings";
const MENU_QUIT: &str = "quit";

#[derive(Clone, Serialize)]
struct AppNavigatePayload {
    to: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<&'static str>,
}

fn build_tray_menu<M: Manager<Wry>>(
    manager: &M,
    signed_in: bool,
    detection_status: DetectionStatus,
) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let quit = MenuItemBuilder::with_id(MENU_QUIT, "Quit").build(manager)?;

    if signed_in {
        let (pause_label, pause_enabled) = pause_menu_state(detection_status);
        let start_session =
            MenuItemBuilder::with_id(MENU_START_SESSION, "Start Session").build(manager)?;
        let pause_detection = MenuItemBuilder::with_id(MENU_PAUSE_DETECTION, pause_label)
            .enabled(pause_enabled)
            .build(manager)?;
        let settings = MenuItemBuilder::with_id(MENU_SETTINGS, "Settings").build(manager)?;
        let separator = PredefinedMenuItem::separator(manager)?;

        MenuBuilder::new(manager)
            .items(&[
                &start_session,
                &pause_detection,
                &separator,
                &settings,
                &quit,
            ])
            .build()
    } else {
        let sign_in = MenuItemBuilder::with_id(MENU_SIGN_IN, "Sign In").build(manager)?;

        MenuBuilder::new(manager).items(&[&sign_in, &quit]).build()
    }
}

fn pause_menu_state(status: DetectionStatus) -> (&'static str, bool) {
    match status {
        DetectionStatus::Paused => ("Resume Detection", true),
        DetectionStatus::Active | DetectionStatus::Cooldown | DetectionStatus::Suppressed => {
            ("Pause Detection", true)
        }
        DetectionStatus::Disabled | DetectionStatus::Notifying => ("Pause Detection", false),
    }
}

pub(crate) fn sync_tray_menu(app: &AppHandle<Wry>) -> Result<(), String> {
    let detection_state = app.state::<Mutex<DetectionState>>();
    let state = recover_detection_state_lock(detection_state.inner(), "tray_menu");
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Main tray icon not available.".to_string())?;
    let menu =
        build_tray_menu(app, state.signed_in, state.status).map_err(|error| error.to_string())?;

    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

pub(crate) fn execute_detection_effects(
    app: &AppHandle<Wry>,
    effects: Vec<DetectionRuntimeEffect>,
    force_tray_sync: bool,
) -> Result<(), String> {
    let should_sync_tray = force_tray_sync
        || effects
            .iter()
            .any(|effect| matches!(effect, DetectionRuntimeEffect::EmitStateChanged(_)));

    let effect_error = execute_runtime_effects(app, effects).err();

    let tray_error = should_sync_tray
        .then(|| sync_tray_menu(app))
        .transpose()
        .err();

    match (effect_error, tray_error) {
        (None, None) => Ok(()),
        (Some(error), None) | (None, Some(error)) => Err(error),
        (Some(effect_error), Some(tray_error)) => Err(format!(
            "{effect_error}; failed to sync tray menu: {tray_error}"
        )),
    }
}

fn show_main_window(app: &AppHandle<Wry>, window_visible: &AtomicBool) {
    #[cfg(target_os = "macos")]
    let _ = app.show();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        window_visible.store(true, Ordering::SeqCst);
        sync_detection_window_visibility(app, true);
    }
}

fn navigate_app(app: &AppHandle<Wry>, to: &'static str, source: Option<&'static str>) {
    if let Err(error) = app.emit(APP_NAVIGATE_EVENT, AppNavigatePayload { to, source }) {
        eprintln!("[tray] failed to emit app navigation event: {error}");
    }
}

fn show_main_window_and_route(
    app: &AppHandle<Wry>,
    window_visible: &AtomicBool,
    to: &'static str,
    source: Option<&'static str>,
) {
    show_main_window(app, window_visible);
    navigate_app(app, to, source);
}

fn toggle_main_window(app: &AppHandle<Wry>, window_visible: &AtomicBool) {
    if let Some(window) = app.get_webview_window("main") {
        if window_visible.load(Ordering::SeqCst) {
            let _ = window.hide();
            window_visible.store(false, Ordering::SeqCst);
            sync_detection_window_visibility(app, false);
        } else {
            show_main_window(app, window_visible);
        }
    }
}

fn sync_detection_window_visibility(app: &AppHandle<Wry>, visible: bool) {
    let detection_state = app.state::<Mutex<DetectionState>>();
    let mut state = recover_detection_state_lock(detection_state.inner(), "tray_visibility");
    let effects = state.set_app_foregrounded(visible);

    if let Err(error) = execute_detection_effects(app, effects, false) {
        eprintln!("[tray] failed to execute detection effects: {error}");
    }
}

fn toggle_detection_pause(app: &AppHandle<Wry>) -> Result<(), String> {
    let detection_state = app.state::<Mutex<DetectionState>>();
    let effects = {
        let mut state = recover_detection_state_lock(detection_state.inner(), "tray_toggle_pause");

        match state.status {
            DetectionStatus::Paused => state.resume(),
            _ => state.pause(),
        }
    };

    execute_detection_effects(app, effects, false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let window_visible = Arc::new(AtomicBool::new(true));

    let app = tauri::Builder::default()
        .manage(Mutex::new(detection::DetectionState::new()))
        .invoke_handler(tauri::generate_handler![
            commands::sync_detection_config,
            commands::get_detection_status,
            commands::get_detection_debug,
            commands::pause_detection,
            commands::resume_detection,
            commands::dismiss_nudge
        ]);
    let app = app
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--minimized"])
                .app_name("Unstuck Sensei")
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_secure_storage::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init({
            let window_visible = Arc::clone(&window_visible);

            move |app, _argv, _cwd| {
                show_main_window(&app, &window_visible);
            }
        }))
        .setup({
            let window_visible = Arc::clone(&window_visible);

            move |app| {
                detection::platform::setup(&app.handle());

                let tray_menu = build_tray_menu(app, false, DetectionStatus::Disabled)?;

                let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
                    .menu(&tray_menu)
                    .tooltip("Unstuck Sensei")
                    .show_menu_on_left_click(false)
                    .on_menu_event({
                        let window_visible = Arc::clone(&window_visible);

                        move |app, event| match event.id().as_ref() {
                            MENU_SIGN_IN => show_main_window(app, &window_visible),
                            MENU_START_SESSION => {
                                show_main_window_and_route(app, &window_visible, "/", Some("tray"))
                            }
                            MENU_SETTINGS => show_main_window_and_route(
                                app,
                                &window_visible,
                                "/settings",
                                Some("tray"),
                            ),
                            MENU_PAUSE_DETECTION => {
                                if let Err(error) = toggle_detection_pause(app) {
                                    eprintln!("[tray] failed to toggle detection pause: {error}");
                                }
                            }
                            MENU_QUIT => app.exit(0),
                            _ => {}
                        }
                    })
                    .on_tray_icon_event({
                        let window_visible = Arc::clone(&window_visible);

                        move |tray, event| match event {
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } => toggle_main_window(&tray.app_handle(), &window_visible),
                            TrayIconEvent::DoubleClick {
                                button: MouseButton::Left,
                                ..
                            } => toggle_main_window(&tray.app_handle(), &window_visible),
                            _ => {}
                        }
                    });

                if let Some(default_icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(default_icon.clone());

                    #[cfg(target_os = "macos")]
                    {
                        tray_builder = tray_builder.icon_as_template(true);
                    }
                }

                let _tray = tray_builder.build(app)?;

                if std::env::args().any(|arg| arg == "--minimized") {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                        window_visible.store(false, Ordering::SeqCst);
                    }
                }

                sync_detection_window_visibility(
                    &app.handle(),
                    window_visible.load(Ordering::SeqCst),
                );

                Ok(())
            }
        })
        .on_window_event({
            let window_visible = Arc::clone(&window_visible);

            move |window, event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    window_visible.store(false, Ordering::SeqCst);
                    sync_detection_window_visibility(&window.app_handle(), false);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run({
        let window_visible = Arc::clone(&window_visible);

        move |app, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    show_main_window(app, &window_visible);
                }
            }
        }
    });
}
