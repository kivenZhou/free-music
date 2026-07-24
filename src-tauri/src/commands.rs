use crate::cache::{self, CacheStats};
use crate::db::Database;
use crate::models::{
    Chart, FavoriteItem, PlayUrl, Playlist, PlaylistTrackItem, SearchHistoryItem, Track,
};
use crate::providers::ProviderRegistry;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub db: Database,
    pub providers: ProviderRegistry,
    pub cache_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub fn list_providers(state: State<'_, Arc<AppState>>) -> Vec<ProviderInfo> {
    state
        .providers
        .list()
        .into_iter()
        .map(|(id, name)| ProviderInfo { id, name })
        .collect()
}

#[tauri::command]
pub async fn search_tracks(
    state: State<'_, Arc<AppState>>,
    query: String,
    provider: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<Track>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let _ = state.db.add_search_history(&q);
    let limit = limit.unwrap_or(50);
    match provider.as_deref() {
        Some("all") | None => Ok(state.providers.search_all(&q, limit).await),
        Some(id) => {
            let p = state
                .providers
                .get(id)
                .ok_or_else(|| format!("unknown provider: {id}"))?;
            p.search(&q, limit).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub async fn list_charts(
    state: State<'_, Arc<AppState>>,
    provider: Option<String>,
) -> Result<Vec<Chart>, String> {
    let p = match provider.as_deref() {
        Some(id) => state
            .providers
            .get(id)
            .ok_or_else(|| format!("unknown provider: {id}"))?,
        None => state.providers.primary(),
    };
    p.charts().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chart_tracks(
    state: State<'_, Arc<AppState>>,
    chart_id: String,
    provider: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<Track>, String> {
    let limit = limit.unwrap_or(20);
    let offset = offset.unwrap_or(0);
    let p = match provider.as_deref() {
        Some(id) => state
            .providers
            .get(id)
            .ok_or_else(|| format!("unknown provider: {id}"))?,
        None => state.providers.primary(),
    };
    p.chart_tracks(&chart_id, limit, offset)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resolve_play_url(
    state: State<'_, Arc<AppState>>,
    track_id: String,
    provider: Option<String>,
    title: Option<String>,
    artist: Option<String>,
) -> Result<PlayUrl, String> {
    let provider_name = provider.unwrap_or_else(|| "netease".into());
    let res = state
        .providers
        .resolve_play(
            &track_id,
            &provider_name,
            title.as_deref(),
            artist.as_deref(),
        )
        .await;

    match res {
        Ok(play_url) => Ok(play_url),
        Err(e) => {
            // Kugou is often broken due to strict signature/rate-limiting.
            // Transparently fallback to Kuwo for the stream.
            if provider_name == "kugou" {
                if let (Some(t), Some(a)) = (title.as_ref(), artist.as_ref()) {
                    let query = format!("{t} {a}");
                    if let Some(kuwo_p) = state.providers.get("kuwo") {
                        if let Ok(tracks) = kuwo_p.search(&query, 5).await {
                            for track in tracks {
                                if crate::providers::titles_similar(t, &track.title)
                                    && crate::providers::artists_similar(a, &track.artist)
                                {
                                    if let Ok(fallback_url) = state
                                        .providers
                                        .resolve_play(
                                            &track.id,
                                            "kuwo",
                                            Some(t),
                                            Some(a),
                                        )
                                        .await
                                    {
                                        return Ok(fallback_url);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub fn get_search_history(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<SearchHistoryItem>, String> {
    state
        .db
        .list_search_history(limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_search_history(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.db.clear_search_history().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_favorite(state: State<'_, Arc<AppState>>, track: Track) -> Result<(), String> {
    state.db.add_favorite(&track).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_favorite(
    state: State<'_, Arc<AppState>>,
    provider: String,
    track_id: String,
) -> Result<(), String> {
    state
        .db
        .remove_favorite(&provider, &track_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_favorites(state: State<'_, Arc<AppState>>) -> Result<Vec<FavoriteItem>, String> {
    state.db.list_favorites().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_favorite(
    state: State<'_, Arc<AppState>>,
    provider: String,
    track_id: String,
) -> Result<bool, String> {
    state
        .db
        .is_favorite(&provider, &track_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_cache_stats(state: State<'_, Arc<AppState>>) -> CacheStats {
    cache::stats(&state.cache_dir)
}

#[tauri::command]
pub fn clear_audio_cache(state: State<'_, Arc<AppState>>) -> Result<CacheStats, String> {
    cache::clear_all(&state.cache_dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsPayload {
    pub lrc: Option<String>,
    pub translated_lrc: Option<String>,
    pub source: String,
}

#[tauri::command]
pub async fn fetch_lyrics(
    state: State<'_, Arc<AppState>>,
    track_id: String,
    provider: String,
    title: Option<String>,
    artist: Option<String>,
) -> Result<LyricsPayload, String> {
    let (lrc, translated_lrc, source) = state
        .providers
        .resolve_lyrics(
            &track_id,
            &provider,
            title.as_deref(),
            artist.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(LyricsPayload {
        lrc,
        translated_lrc,
        source,
    })
}

#[tauri::command]
pub fn list_playlists(state: State<'_, Arc<AppState>>) -> Result<Vec<Playlist>, String> {
    state.db.list_playlists().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_playlist(state: State<'_, Arc<AppState>>, name: String) -> Result<Playlist, String> {
    state.db.create_playlist(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_playlist(
    state: State<'_, Arc<AppState>>,
    id: i64,
    name: String,
) -> Result<(), String> {
    state
        .db
        .rename_playlist(id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_playlist(state: State<'_, Arc<AppState>>, id: i64) -> Result<(), String> {
    state.db.delete_playlist(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_playlist_tracks(
    state: State<'_, Arc<AppState>>,
    playlist_id: i64,
) -> Result<Vec<PlaylistTrackItem>, String> {
    state
        .db
        .list_playlist_tracks(playlist_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_to_playlist(
    state: State<'_, Arc<AppState>>,
    playlist_id: i64,
    track: Track,
) -> Result<(), String> {
    state
        .db
        .add_to_playlist(playlist_id, &track)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_from_playlist(
    state: State<'_, Arc<AppState>>,
    playlist_id: i64,
    provider: String,
    track_id: String,
) -> Result<(), String> {
    state
        .db
        .remove_from_playlist(playlist_id, &provider, &track_id)
        .map_err(|e| e.to_string())
}
