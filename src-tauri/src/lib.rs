mod cache;
mod commands;
mod db;
mod models;
mod providers;

use commands::AppState;
use db::Database;
use directories::ProjectDirs;
use providers::ProviderRegistry;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Database::open_default().expect("open local database");
    let dirs = ProjectDirs::from("com", "zzy", "yinzhan").expect("app dirs");
    let cache_dir = dirs.cache_dir().to_path_buf();
    let _ = std::fs::create_dir_all(cache_dir.join("audio"));

    let state = Arc::new(AppState {
        db,
        providers: ProviderRegistry::with_defaults(cache_dir.clone()),
        cache_dir,
    });

    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出音栈", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("missing default window icon");

            let _tray = TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("音栈")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => show_main(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Close button hides to tray; use tray menu「退出音栈」to quit.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_providers,
            commands::search_tracks,
            commands::list_charts,
            commands::chart_tracks,
            commands::resolve_play_url,
            commands::get_search_history,
            commands::clear_search_history,
            commands::add_favorite,
            commands::remove_favorite,
            commands::list_favorites,
            commands::is_favorite,
            commands::get_cache_stats,
            commands::clear_audio_cache,
            commands::fetch_lyrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
