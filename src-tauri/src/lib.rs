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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
