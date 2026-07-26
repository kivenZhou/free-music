mod cache;
mod commands;
mod db;
mod models;
mod providers;
mod voice;

use commands::AppState;
use db::Database;
use directories::ProjectDirs;
use providers::ProviderRegistry;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use voice::VoiceState;

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn emit_tray_action(app: &tauri::AppHandle, action: &str) {
    let _ = app.emit("tray-action", action);
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
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .manage(VoiceState::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            }

            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let toggle_i =
                MenuItem::with_id(app, "toggle", "播放 / 暂停", true, None::<&str>)?;
            let next_i = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
            let prev_i = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
            let fav_i = MenuItem::with_id(app, "favorite", "收藏当前曲", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出音栈", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show_i,
                    &sep1,
                    &toggle_i,
                    &next_i,
                    &prev_i,
                    &fav_i,
                    &sep2,
                    &quit_i,
                ],
            )?;

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
                        voice::stop_on_exit(app);
                        app.exit(0);
                    }
                    "show" => show_main(app),
                    "toggle" => emit_tray_action(app, "toggle"),
                    "next" => emit_tray_action(app, "next"),
                    "prev" => emit_tray_action(app, "prev"),
                    "favorite" => emit_tray_action(app, "favorite"),
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
            commands::remove_search_history,
            commands::add_favorite,
            commands::remove_favorite,
            commands::list_favorites,
            commands::is_favorite,
            commands::get_cache_stats,
            commands::clear_audio_cache,
            commands::fetch_lyrics,
            commands::list_playlists,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::list_playlist_tracks,
            commands::add_to_playlist,
            commands::remove_from_playlist,
            voice::voice_assistant_info,
            voice::start_voice_assistant,
            voice::stop_voice_assistant,
            voice::report_voice_web_status,
            voice::voice_speak,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
