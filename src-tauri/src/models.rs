use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Playability {
    Full,
    Preview,
    Unavailable,
}

/// Preferred stream quality. Providers fall back when a tier is unavailable.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AudioQuality {
    Standard,
    #[default]
    High,
    Highest,
}

impl AudioQuality {
    /// Netease `br` parameter (bps upper bound).
    pub fn netease_br(self) -> u32 {
        match self {
            Self::Standard => 128_000,
            Self::High => 320_000,
            Self::Highest => 320_000,
        }
    }

    /// Kuwo `br=` ladder, preferred first.
    pub fn kuwo_brs(self) -> &'static [&'static str] {
        match self {
            Self::Standard => &["128kmp3"],
            Self::High => &["192kmp3", "128kmp3", "320kmp3"],
            Self::Highest => &["320kmp3", "192kmp3", "128kmp3"],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    pub duration_ms: Option<u64>,
    pub playability: Playability,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayUrl {
    pub url: String,
    /// Local cached file path for in-app playback (avoids CDN CORS / mixed-content).
    pub local_path: Option<String>,
    pub playability: Playability,
    pub quality: Option<String>,
    pub expires_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chart {
    pub id: String,
    pub name: String,
    pub region: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHistoryItem {
    pub id: i64,
    pub query: String,
    pub searched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteItem {
    pub id: i64,
    pub track: Track,
    pub favorited_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub track_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistTrackItem {
    pub id: i64,
    pub track: Track,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryItem {
    pub id: i64,
    pub track: Track,
    pub played_at: String,
}
