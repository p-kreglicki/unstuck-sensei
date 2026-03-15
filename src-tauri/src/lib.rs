use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

mod commands;
mod detection;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent, Wry,
};

const TRAY_ID: &str = "main";
const MENU_SIGN_IN: &str = "sign-in";
const MENU_START_SESSION: &str = "start-session";
const MENU_PAUSE_DETECTION: &str = "pause-detection";
const MENU_SETTINGS: &str = "settings";
const MENU_QUIT: &str = "quit";

fn build_tray_menu<M: Manager<Wry>>(
    manager: &M,
    signed_in: bool,
) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let quit = MenuItemBuilder::with_id(MENU_QUIT, "Quit").build(manager)?;

    if signed_in {
        let start_session =
            MenuItemBuilder::with_id(MENU_START_SESSION, "Start Session").build(manager)?;
        let pause_detection = MenuItemBuilder::with_id(MENU_PAUSE_DETECTION, "Pause Detection")
            .enabled(false)
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

pub(crate) fn sync_tray_auth_state(app: &AppHandle<Wry>, signed_in: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Main tray icon not available.".to_string())?;
    let menu = build_tray_menu(app, signed_in).map_err(|error| error.to_string())?;

    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

fn show_main_window(app: &AppHandle<Wry>, window_visible: &AtomicBool) {
    #[cfg(target_os = "macos")]
    let _ = app.show();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        window_visible.store(true, Ordering::SeqCst);
    }
}

fn toggle_main_window(app: &AppHandle<Wry>, window_visible: &AtomicBool) {
    if let Some(window) = app.get_webview_window("main") {
        if window_visible.load(Ordering::SeqCst) {
            let _ = window.hide();
            window_visible.store(false, Ordering::SeqCst);
        } else {
            show_main_window(app, window_visible);
        }
    }
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
        ])
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

                let tray_menu = build_tray_menu(app, false)?;

                let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
                    .menu(&tray_menu)
                    .tooltip("Unstuck Sensei")
                    .show_menu_on_left_click(false)
                    .on_menu_event({
                        let window_visible = Arc::clone(&window_visible);

                        move |app, event| match event.id().as_ref() {
                            MENU_SIGN_IN | MENU_START_SESSION | MENU_SETTINGS => {
                                show_main_window(app, &window_visible)
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
