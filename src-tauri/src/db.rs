use crate::models::{FavoriteItem, Playability, SearchHistoryItem, Track};
use directories::ProjectDirs;
use rusqlite::{params, Connection};
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
        // Keep last 50
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
            // Ensure enum deserializes even for older rows
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
}
