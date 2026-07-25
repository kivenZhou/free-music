mod audius;
mod bilibili;
mod kugou;
mod kuwo;
mod lrclib;
mod netease;
mod qq;

pub use audius::AudiusProvider;
pub use bilibili::BilibiliProvider;
pub use kugou::KugouProvider;
pub use kuwo::KuwoProvider;
pub use lrclib::LrclibClient;
pub use netease::NeteaseProvider;
pub use qq::QqProvider;

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

/// Strip Bilibili / playlist prefixes and split "歌名-歌手" style titles for lyric matching.
pub fn clean_lyric_hints(
    title: &str,
    artist: Option<&str>,
) -> (String, Option<String>) {
    let mut t = title.trim().to_string();

    // "P12 01.xxx" / "P1 xxx"
    if let Some(rest) = t.strip_prefix('P').or_else(|| t.strip_prefix('p')) {
        let digit_end = rest
            .char_indices()
            .find(|(_, c)| !c.is_ascii_digit())
            .map(|(i, _)| i);
        if let Some(i) = digit_end.filter(|&i| i > 0) {
            let sep = rest[i..].chars().next();
            if matches!(sep, Some(' ' | '.' | '、' | '-' | '·')) {
                let skip = i + sep.unwrap().len_utf8();
                let cleaned = rest[skip..].trim();
                if !cleaned.is_empty() {
                    t = cleaned.to_string();
                }
            }
        }
    }

    // "合集标题 · P2 分P名" → prefer the part name after ·
    if let Some((_, right)) = t.rsplit_once(" · ") {
        let right = right.trim();
        if !right.is_empty() {
            t = right.to_string();
            // Part may itself start with "P2 "
            if let Some(rest) = t.strip_prefix('P').or_else(|| t.strip_prefix('p')) {
                let digit_end = rest
                    .char_indices()
                    .find(|(_, c)| !c.is_ascii_digit())
                    .map(|(i, _)| i);
                if let Some(i) = digit_end.filter(|&i| i > 0) {
                    let sep = rest[i..].chars().next();
                    if matches!(sep, Some(' ' | '.' | '、' | '-' | '·')) {
                        let skip = i + sep.unwrap().len_utf8();
                        let cleaned = rest[skip..].trim();
                        if !cleaned.is_empty() {
                            t = cleaned.to_string();
                        }
                    }
                }
            }
        }
    }

    // Leading track index: "01." "01、" "1 "
    {
        let digit_end = t
            .char_indices()
            .find(|(_, c)| !c.is_ascii_digit())
            .map(|(i, _)| i);
        if let Some(i) = digit_end.filter(|&i| i > 0) {
            let sep = t[i..].chars().next();
            if matches!(sep, Some('.' | ' ' | '、' | '-')) {
                let skip = i + sep.unwrap().len_utf8();
                let cleaned = t[skip..].trim();
                if !cleaned.is_empty() {
                    t = cleaned.to_string();
                }
            }
        }
    }

    let mut artist_out = artist
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "未知艺人" && *s != "未知歌手")
        .map(|s| s.to_string());

    // "歌名-歌手" / "歌名 - 歌手"
    // B站常见：artist 字段是 UP 主，真正歌手写在分 P 标题里 —— 优先用标题里的歌手。
    for sep in [" - ", " – ", " — ", "-", "–", "—"] {
        if let Some((left, right)) = t.rsplit_once(sep) {
            let left = left.trim();
            let right = right.trim();
            if !left.is_empty() && !right.is_empty() && looks_like_embedded_artist(right) {
                artist_out = Some(right.to_string());
                t = left.to_string();
                break;
            }
        }
    }

    (t, artist_out)
}

fn looks_like_embedded_artist(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() || s.chars().count() > 24 {
        return false;
    }
    if s.contains('《') || s.contains('》') {
        return false;
    }
    // Years / pure numbers / quality tags are not artists.
    if s.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    const NOISE: &[&str] = &[
        "live", "remix", "mix", "cover", "ver", "version", "official", "audio", "mv", "hd",
        "伴奏", "纯音乐", "片段", "试听", "完整版", "现场", "翻唱", "男声", "女声", "dj",
    ];
    if NOISE.iter().any(|n| lower == *n || lower == format!("({n})") || lower == format!("[{n}]")) {
        return false;
    }
    true
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
    lrclib: LrclibClient,
}

impl ProviderRegistry {
    pub fn with_defaults(cache_dir: PathBuf) -> Self {
        let audio = cache_dir.join("audio");
        let _ = std::fs::create_dir_all(&audio);
        Self {
            providers: vec![
                // Default / primary: 网易云 (matches UI + README)
                Box::new(NeteaseProvider::new(audio.join("netease"))),
                Box::new(QqProvider::new(audio.join("qq"))),
                Box::new(BilibiliProvider::new(audio.join("bilibili"))),
                Box::new(KugouProvider::new(audio.join("kugou"))),
                Box::new(KuwoProvider::new(audio.join("kuwo"))),
                // 咪咕：公开搜索可用，但免费播放地址接口已关闭，暂不接入
                // Audius：免登录开放音源，国内通常可直连
                // Openverse / Archive.org / YouTube：国内多数网络不通，不默认接入
                Box::new(AudiusProvider::new(audio.join("audius"))),
            ],
            lrclib: LrclibClient::new(),
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
        hint_album: Option<&str>,
        duration_ms: Option<u64>,
    ) -> Result<(Option<String>, Option<String>, String), ProviderError> {
        // 1) Native lyrics from the current provider (QQ / 酷狗 / 酷我 / 网易云).
        if let Some(p) = self.get(provider) {
            if let Ok((lrc, tlyric)) = p.lyrics(track_id).await {
                let has = lrc.as_ref().is_some_and(|s| !s.trim().is_empty())
                    || tlyric.as_ref().is_some_and(|s| !s.trim().is_empty());
                if has {
                    return Ok((lrc, tlyric, provider.to_string()));
                }
            }
        }

        let raw_title = hint_title.filter(|s| !s.is_empty());
        let (clean_title, clean_artist) = match raw_title {
            Some(t) => clean_lyric_hints(t, hint_artist),
            None => {
                return Err(ProviderError::Msg("缺少曲名，无法匹配歌词".into()));
            }
        };
        let artist_ref = clean_artist.as_deref().or(hint_artist.filter(|s| !s.is_empty()));

        // 2) Cross-match on NetEase with cleaned title/artist.
        if let Some(netease) = self.get("netease") {
            let mut candidates = Vec::new();
            let mut seen = std::collections::HashSet::new();
            let queries: Vec<String> = match artist_ref {
                Some(a) => vec![format!("{clean_title} {a}"), clean_title.clone()],
                None => vec![clean_title.clone()],
            };
            for q in queries {
                if let Ok(tracks) = netease.search(&q, 12).await {
                    for t in tracks {
                        if seen.insert(t.id.clone()) {
                            candidates.push(t);
                        }
                    }
                }
            }

            // Prefer title+artist hits, then title-only (UP 主名对不上时仍能命中).
            for require_artist in [true, false] {
                if require_artist && artist_ref.is_none() {
                    continue;
                }
                for t in &candidates {
                    if !titles_similar(&clean_title, &t.title) {
                        continue;
                    }
                    if require_artist {
                        if let Some(artist) = artist_ref {
                            if !artists_similar(artist, &t.artist) {
                                continue;
                            }
                        }
                    }
                    if let Ok((lrc, tlyric)) = netease.lyrics(&t.id).await {
                        let has = lrc.as_ref().is_some_and(|s| !s.trim().is_empty())
                            || tlyric.as_ref().is_some_and(|s| !s.trim().is_empty());
                        if has {
                            return Ok((lrc, tlyric, "netease".into()));
                        }
                    }
                }
            }
        }

        // 3) LRCLIB open lyrics database (try cleaned artist, then title-only).
        if let Ok(lrc) = self
            .lrclib
            .fetch(&clean_title, artist_ref, hint_album, duration_ms)
            .await
        {
            return Ok((Some(lrc), None, "lrclib".into()));
        }
        if artist_ref.is_some() {
            if let Ok(lrc) = self
                .lrclib
                .fetch(&clean_title, None, hint_album, duration_ms)
                .await
            {
                return Ok((Some(lrc), None, "lrclib".into()));
            }
        }
        Err(ProviderError::Msg("未找到匹配歌词".into()))
    }
}
