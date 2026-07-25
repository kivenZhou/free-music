//! LRCLIB open lyrics API — fallback when NetEase has no match.
//! Docs: https://lrclib.net/docs

use super::{artists_similar, titles_similar, ProviderError};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use serde::Deserialize;

const BASE: &str = "https://lrclib.net";
const CLIENT_UA: &str = "YinZhan/0.1.2 (https://github.com/kivenZhou/free-music)";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibRecord {
    #[serde(default)]
    track_name: Option<String>,
    #[serde(default)]
    artist_name: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    instrumental: Option<bool>,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

pub struct LrclibClient {
    client: reqwest::Client,
}

impl LrclibClient {
    pub fn new() -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(CLIENT_UA));
        headers.insert(
            HeaderName::from_static("lrclib-client"),
            HeaderValue::from_static(CLIENT_UA),
        );
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .expect("lrclib client");
        Self { client }
    }

    /// Search then pick the best synced (or plain) lyrics match.
    pub async fn fetch(
        &self,
        title: &str,
        artist: Option<&str>,
        album: Option<&str>,
        duration_ms: Option<u64>,
    ) -> Result<String, ProviderError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(ProviderError::Msg("缺少曲名，无法匹配歌词".into()));
        }
        let artist = artist.map(str::trim).filter(|s| !s.is_empty());
        let album = album.map(str::trim).filter(|s| !s.is_empty());
        let duration_sec = duration_ms
            .filter(|&ms| ms > 0)
            .map(|ms| (ms as f64 / 1000.0).round() as u64);

        // Precise signature lookup when we have enough metadata.
        if let (Some(a), Some(d)) = (artist, duration_sec) {
            if let Ok(lrc) = self
                .get_by_signature(title, a, album.unwrap_or(title), d)
                .await
            {
                return Ok(lrc);
            }
        }

        self.search_best(title, artist, duration_sec).await
    }

    async fn get_by_signature(
        &self,
        track_name: &str,
        artist_name: &str,
        album_name: &str,
        duration_sec: u64,
    ) -> Result<String, ProviderError> {
        let url = format!("{BASE}/api/get");
        let resp = self
            .client
            .get(&url)
            .query(&[
                ("track_name", track_name),
                ("artist_name", artist_name),
                ("album_name", album_name),
                ("duration", &duration_sec.to_string()),
            ])
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(ProviderError::Msg("LRCLIB 未找到".into()));
        }
        if !resp.status().is_success() {
            return Err(ProviderError::Msg(format!(
                "LRCLIB 请求失败: {}",
                resp.status()
            )));
        }
        let rec: LrclibRecord = resp.json().await?;
        record_to_lrc(&rec)
    }

    async fn search_best(
        &self,
        title: &str,
        artist: Option<&str>,
        duration_sec: Option<u64>,
    ) -> Result<String, ProviderError> {
        let url = format!("{BASE}/api/search");
        let mut req = self.client.get(&url).query(&[("track_name", title)]);
        if let Some(a) = artist {
            req = req.query(&[("artist_name", a)]);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Msg(format!(
                "LRCLIB 搜索失败: {}",
                resp.status()
            )));
        }
        let records: Vec<LrclibRecord> = resp.json().await?;
        if records.is_empty() {
            return Err(ProviderError::Msg("未找到匹配歌词".into()));
        }

        let mut scored: Vec<(i32, &LrclibRecord)> = records
            .iter()
            .filter_map(|r| {
                let t = r.track_name.as_deref().unwrap_or("");
                if !titles_similar(title, t) {
                    return None;
                }
                if let Some(a) = artist {
                    let ra = r.artist_name.as_deref().unwrap_or("");
                    if !artists_similar(a, ra) {
                        return None;
                    }
                }
                let mut score = 0;
                if r.synced_lyrics
                    .as_deref()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false)
                {
                    score += 100;
                } else if r
                    .plain_lyrics
                    .as_deref()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false)
                {
                    score += 40;
                } else if r.instrumental == Some(true) {
                    return None;
                } else {
                    return None;
                }
                if let (Some(want), Some(got)) = (duration_sec, r.duration) {
                    let diff = (want as f64 - got).abs();
                    if diff <= 2.0 {
                        score += 50;
                    } else if diff <= 5.0 {
                        score += 20;
                    } else if diff > 15.0 {
                        score -= 30;
                    }
                }
                Some((score, r))
            })
            .collect();

        scored.sort_by(|a, b| b.0.cmp(&a.0));
        let Some((_, best)) = scored.first() else {
            return Err(ProviderError::Msg("未找到匹配歌词".into()));
        };
        record_to_lrc(best)
    }
}

fn record_to_lrc(rec: &LrclibRecord) -> Result<String, ProviderError> {
    if let Some(synced) = rec
        .synced_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Ok(synced.to_string());
    }
    if let Some(plain) = rec
        .plain_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Ok(plain_to_pseudo_lrc(plain));
    }
    Err(ProviderError::Msg("该曲目无歌词".into()))
}

/// Turn unsynced plain text into timed LRC so the panel can still render lines.
fn plain_to_pseudo_lrc(plain: &str) -> String {
    plain
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .enumerate()
        .map(|(i, line)| {
            let sec = (i as u32) * 4;
            let m = sec / 60;
            let s = sec % 60;
            format!("[{m:02}:{s:02}.00]{line}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}
