mod audius;
mod bilibili;
mod kugou;
mod kuwo;
mod netease;

pub use audius::AudiusProvider;
pub use bilibili::BilibiliProvider;
pub use kugou::KugouProvider;
pub use kuwo::KuwoProvider;
pub use netease::NeteaseProvider;

use crate::models::{Chart, PlayUrl, Track};
use async_trait::async_trait;
use futures::future::join_all;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("parse: {0}")]
    Parse(String),
    #[error("{0}")]
    Msg(String),
}

#[async_trait]
pub trait MusicProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError>;
    async fn charts(&self) -> Result<Vec<Chart>, ProviderError>;
    async fn chart_tracks(
        &self,
        chart_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Track>, ProviderError>;
    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError>;
    /// Optional synced lyrics (LRC). Default: unsupported.
    async fn lyrics(
        &self,
        _track_id: &str,
    ) -> Result<(Option<String>, Option<String>), ProviderError> {
        Err(ProviderError::Msg("该音源暂不支持歌词".into()))
    }
}

fn normalize_text(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Loose title match for cross-provider play fallback (avoid wrong-track playback).
pub fn titles_similar(a: &str, b: &str) -> bool {
    let na = normalize_text(a);
    let nb = normalize_text(b);
    if na.is_empty() || nb.is_empty() {
        return false;
    }
    if na == nb {
        return true;
    }
    let (longer, shorter) = if na.len() >= nb.len() {
        (&na, &nb)
    } else {
        (&nb, &na)
    };
    // Require the shorter side to be meaningful and contained.
    shorter.len() >= 2 && longer.contains(shorter)
}

pub fn artists_similar(a: &str, b: &str) -> bool {
    let na = normalize_text(a);
    let nb = normalize_text(b);
    if na.is_empty() || nb.is_empty() {
        // Unknown artist on either side — allow title-only match.
        return true;
    }
    if na == nb {
        return true;
    }
    na.contains(&nb) || nb.contains(&na)
}

pub struct ProviderRegistry {
    providers: Vec<Box<dyn MusicProvider>>,
}

impl ProviderRegistry {
    pub fn with_defaults(cache_dir: PathBuf) -> Self {
        let audio = cache_dir.join("audio");
        let _ = std::fs::create_dir_all(&audio);
        Self {
            providers: vec![
                // Default / primary: 网易云 (matches UI + README)
                Box::new(NeteaseProvider::new(audio.join("netease"))),
                Box::new(BilibiliProvider::new(audio.join("bilibili"))),
                Box::new(KugouProvider::new(audio.join("kugou"))),
                Box::new(KuwoProvider::new(audio.join("kuwo"))),
                // 咪咕：公开搜索可用，但免费播放地址接口已关闭，暂不接入
                // Audius：免登录开放音源，国内通常可直连
                // Openverse / Archive.org / YouTube：国内多数网络不通，不默认接入
                Box::new(AudiusProvider::new(audio.join("audius"))),
            ],
        }
    }

    pub fn list(&self) -> Vec<(String, String)> {
        self.providers
            .iter()
            .map(|p| (p.id().to_string(), p.name().to_string()))
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<&dyn MusicProvider> {
        self.providers
            .iter()
            .find(|p| p.id() == id)
            .map(|p| p.as_ref())
    }

    pub fn primary(&self) -> &dyn MusicProvider {
        self.providers[0].as_ref()
    }

    pub async fn search_all(&self, query: &str, limit: u32) -> Vec<Track> {
        let active: Vec<&dyn MusicProvider> =
            self.providers.iter().map(|p| p.as_ref()).collect();

        let n = active.len().max(1);
        let per = ((limit as usize) / n).max(8).min(16) as u32;

        // Parallel fan-out — sequential search was the main latency source.
        let futs = active.iter().map(|p| p.search(query, per));
        let results = join_all(futs).await;

        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for res in results {
            if let Ok(tracks) = res {
                for t in tracks {
                    let key = format!(
                        "{}:{}",
                        t.title.to_lowercase(),
                        t.artist.to_lowercase()
                    );
                    if seen.insert(key) {
                        out.push(t);
                    }
                }
            }
        }
        out.truncate(limit as usize);
        out
    }

    pub async fn resolve_play(
        &self,
        track_id: &str,
        provider: &str,
        hint_title: Option<&str>,
        hint_artist: Option<&str>,
    ) -> Result<PlayUrl, ProviderError> {
        if let Some(p) = self.get(provider) {
            if let Ok(url) = p.play_url(track_id).await {
                return Ok(url);
            }
        }
        if let Some(title) = hint_title.filter(|s| !s.is_empty()) {
            let q = match hint_artist.filter(|s| !s.is_empty()) {
                Some(a) => format!("{title} {a}"),
                None => title.to_string(),
            };
            for p in &self.providers {
                if p.id() == provider {
                    continue;
                }
                if let Ok(tracks) = p.search(&q, 5).await {
                    for t in tracks {
                        if !titles_similar(title, &t.title) {
                            continue;
                        }
                        if let Some(artist) = hint_artist.filter(|s| !s.is_empty()) {
                            if !artists_similar(artist, &t.artist) {
                                continue;
                            }
                        }
                        if let Ok(url) = p.play_url(&t.id).await {
                            return Ok(url);
                        }
                    }
                }
            }
        }
        Err(ProviderError::Msg(
            "所有音源均无免费完整播放地址".into(),
        ))
    }

    pub async fn resolve_lyrics(
        &self,
        track_id: &str,
        provider: &str,
        hint_title: Option<&str>,
        hint_artist: Option<&str>,
    ) -> Result<(Option<String>, Option<String>, String), ProviderError> {
        if provider == "netease" {
            if let Some(p) = self.get("netease") {
                if let Ok((lrc, tlyric)) = p.lyrics(track_id).await {
                    return Ok((lrc, tlyric, "netease".into()));
                }
            }
        }

        let title = hint_title.filter(|s| !s.is_empty()).ok_or_else(|| {
            ProviderError::Msg("缺少曲名，无法匹配歌词".into())
        })?;
        let netease = self
            .get("netease")
            .ok_or_else(|| ProviderError::Msg("网易云音源不可用".into()))?;
        let q = match hint_artist.filter(|s| !s.is_empty()) {
            Some(a) => format!("{title} {a}"),
            None => title.to_string(),
        };
        let tracks = netease.search(&q, 8).await?;
        for t in tracks {
            if !titles_similar(title, &t.title) {
                continue;
            }
            if let Some(artist) = hint_artist.filter(|s| !s.is_empty()) {
                if !artists_similar(artist, &t.artist) {
                    continue;
                }
            }
            if let Ok((lrc, tlyric)) = netease.lyrics(&t.id).await {
                return Ok((lrc, tlyric, "netease".into()));
            }
        }
        Err(ProviderError::Msg("未找到匹配歌词".into()))
    }
}
