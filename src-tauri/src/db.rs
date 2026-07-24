use crate::models::{
    FavoriteItem, Playability, Playlist, PlaylistTrackItem, SearchHistoryItem, Track,
};
use directories::ProjectDirs;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("dirs unavailable")]
    NoDirs,
    #[error("{0}")]
    Msg(String),
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open_default() -> Result<Self, DbError> {
        let dirs = ProjectDirs::from("com", "zzy", "yinzhan").ok_or(DbError::NoDirs)?;
        let data_dir = dirs.data_dir();
        std::fs::create_dir_all(data_dir)?;
        let path = data_dir.join("yinzhan.db");
        Self::open_path(path)
    }

    pub fn open_path(path: PathBuf) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS search_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL UNIQUE,
                searched_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                track_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                favorited_at TEXT NOT NULL,
                UNIQUE(provider, track_id)
            );
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playlist_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                track_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                added_at TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                UNIQUE(playlist_id, provider, track_id),
                FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            );
            "#,
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn add_search_history(&self, query: &str) -> Result<(), DbError> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(());
        }
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            r#"
            INSERT INTO search_history (query, searched_at) VALUES (?1, ?2)
            ON CONFLICT(query) DO UPDATE SET searched_at = excluded.searched_at
            "#,
            params![q, now],
        )?;
        conn.execute(
            r#"
            DELETE FROM search_history WHERE id NOT IN (
              SELECT id FROM search_history ORDER BY searched_at DESC LIMIT 50
            )
            "#,
            [],
        )?;
        Ok(())
    }

    pub fn list_search_history(&self, limit: i64) -> Result<Vec<SearchHistoryItem>, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let mut stmt = conn.prepare(
            "SELECT id, query, searched_at FROM search_history ORDER BY searched_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(SearchHistoryItem {
                id: row.get(0)?,
                query: row.get(1)?,
                searched_at: row.get(2)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn clear_search_history(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute("DELETE FROM search_history", [])?;
        Ok(())
    }

    pub fn add_favorite(&self, track: &Track) -> Result<(), DbError> {
        let now = chrono::Utc::now().to_rfc3339();
        let payload = serde_json::to_string(track)?;
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            r#"
            INSERT INTO favorites (provider, track_id, payload, favorited_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(provider, track_id) DO UPDATE SET
              payload = excluded.payload,
              favorited_at = excluded.favorited_at
            "#,
            params![track.provider, track.id, payload, now],
        )?;
        Ok(())
    }

    pub fn remove_favorite(&self, provider: &str, track_id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "DELETE FROM favorites WHERE provider = ?1 AND track_id = ?2",
            params![provider, track_id],
        )?;
        Ok(())
    }

    pub fn list_favorites(&self) -> Result<Vec<FavoriteItem>, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let mut stmt =
            conn.prepare("SELECT id, payload, favorited_at FROM favorites ORDER BY favorited_at DESC")?;
        let rows = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let payload: String = row.get(1)?;
            let favorited_at: String = row.get(2)?;
            Ok((id, payload, favorited_at))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, payload, favorited_at) = row?;
            let mut track: Track = serde_json::from_str(&payload)?;
            if track.title.is_empty() {
                track.playability = Playability::Unavailable;
            }
            out.push(FavoriteItem {
                id,
                track,
                favorited_at,
            });
        }
        Ok(out)
    }

    pub fn is_favorite(&self, provider: &str, track_id: &str) -> Result<bool, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let mut stmt =
            conn.prepare("SELECT 1 FROM favorites WHERE provider = ?1 AND track_id = ?2 LIMIT 1")?;
        let exists = stmt.exists(params![provider, track_id])?;
        Ok(exists)
    }

    pub fn list_playlists(&self) -> Result<Vec<Playlist>, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let mut stmt = conn.prepare(
            r#"
            SELECT p.id, p.name, p.created_at, p.updated_at,
                   (SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS track_count
            FROM playlists p
            ORDER BY p.updated_at DESC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                track_count: row.get(4)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn create_playlist(&self, name: &str) -> Result<Playlist, DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Msg("歌单名不能为空".into()));
        }
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "INSERT INTO playlists (name, created_at, updated_at) VALUES (?1, ?2, ?3)",
            params![name, now, now],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Playlist {
            id,
            name: name.to_string(),
            created_at: now.clone(),
            updated_at: now,
            track_count: 0,
        })
    }

    pub fn rename_playlist(&self, id: i64, name: &str) -> Result<(), DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Msg("歌单名不能为空".into()));
        }
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().expect("db lock");
        let n = conn.execute(
            "UPDATE playlists SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )?;
        if n == 0 {
            return Err(DbError::Msg("歌单不存在".into()));
        }
        Ok(())
    }

    pub fn delete_playlist(&self, id: i64) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_playlist_tracks(&self, playlist_id: i64) -> Result<Vec<PlaylistTrackItem>, DbError> {
        let conn = self.conn.lock().expect("db lock");
        let mut stmt = conn.prepare(
            r#"
            SELECT id, payload, added_at
            FROM playlist_tracks
            WHERE playlist_id = ?1
            ORDER BY position ASC, id ASC
            "#,
        )?;
        let rows = stmt.query_map(params![playlist_id], |row| {
            let id: i64 = row.get(0)?;
            let payload: String = row.get(1)?;
            let added_at: String = row.get(2)?;
            Ok((id, payload, added_at))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, payload, added_at) = row?;
            let track: Track = serde_json::from_str(&payload)?;
            out.push(PlaylistTrackItem {
                id,
                track,
                added_at,
            });
        }
        Ok(out)
    }

    pub fn add_to_playlist(&self, playlist_id: i64, track: &Track) -> Result<(), DbError> {
        let now = chrono::Utc::now().to_rfc3339();
        let payload = serde_json::to_string(track)?;
        let conn = self.conn.lock().expect("db lock");
        let exists: Option<i64> = conn
            .query_row(
                "SELECT id FROM playlists WHERE id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            return Err(DbError::Msg("歌单不存在".into()));
        }
        let next_pos: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            r#"
            INSERT INTO playlist_tracks (playlist_id, provider, track_id, payload, added_at, position)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(playlist_id, provider, track_id) DO UPDATE SET
              payload = excluded.payload
            "#,
            params![
                playlist_id,
                track.provider,
                track.id,
                payload,
                now,
                next_pos
            ],
        )?;
        conn.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )?;
        Ok(())
    }

    pub fn remove_from_playlist(
        &self,
        playlist_id: i64,
        provider: &str,
        track_id: &str,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND provider = ?2 AND track_id = ?3",
            params![playlist_id, provider, track_id],
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )?;
        Ok(())
    }
}
