mod bilibili;
mod kugou;
mod kuwo;
mod netease;
mod youtube;

pub use bilibili::BilibiliProvider;
pub use kugou::KugouProvider;
pub use kuwo::KuwoProvider;
pub use netease::NeteaseProvider;
pub use youtube::YoutubeProvider;

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
    async fn chart_tracks(&self, chart_id: &str, limit: u32) -> Result<Vec<Track>, ProviderError>;
    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError>;
}

pub struct ProviderRegistry {
    providers: Vec<Box<dyn MusicProvider>>,
}

impl ProviderRegistry {
    pub fn with_defaults(cache_dir: PathBuf) -> Self {
        let audio = cache_dir.join("audio");
        Self {
            providers: vec![
                Box::new(BilibiliProvider::new(audio.join("bilibili"))),
                Box::new(NeteaseProvider::new(audio.join("netease"))),
                Box::new(KugouProvider::new(audio.join("kugou"))),
                Box::new(KuwoProvider::new(audio.join("kuwo"))),
                // 咪咕：公开搜索可用，但免费播放地址接口已关闭，暂不接入
                Box::new(YoutubeProvider::new(audio.join("youtube"))),
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
        let want_youtube =
            query.contains("youtube.com") || query.contains("youtu.be") || query.contains("yt:");

        // YouTube is much slower — only include when the query looks like a YT link/keyword.
        let active: Vec<&dyn MusicProvider> = self
            .providers
            .iter()
            .map(|p| p.as_ref())
            .filter(|p| want_youtube || p.id() != "youtube")
            .collect();

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
                if p.id() == "youtube" {
                    continue;
                }
                if let Ok(tracks) = p.search(&q, 5).await {
                    for t in tracks {
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
}
