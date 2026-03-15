use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent, Wry,
};

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
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--minimized"])
                .app_name("Unstuck Sensei")
                .build(),
        )
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
            let start_session = MenuItemBuilder::with_id("start-session", "Start Session").build(app)?;
            let pause_detection = MenuItemBuilder::with_id("pause-detection", "Pause Detection")
                .enabled(false)
                .build(app)?;
            let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .items(&[
                    &start_session,
                    &pause_detection,
                    &separator,
                    &settings,
                    &quit,
                ])
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("main")
                .menu(&tray_menu)
                .tooltip("Unstuck Sensei")
                .show_menu_on_left_click(false)
                .on_menu_event({
                    let window_visible = Arc::clone(&window_visible);

                    move |app, event| match event.id().as_ref() {
                        "start-session" | "settings" => show_main_window(app, &window_visible),
                        "quit" => app.exit(0),
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
