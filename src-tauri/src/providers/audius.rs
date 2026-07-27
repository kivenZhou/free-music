use super::{MusicProvider, ProviderError};
use crate::models::{AudioQuality, Chart, PlayUrl, Playability, Track};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde_json::Value;
use std::path::PathBuf;

const UA: &str = "YinZhan/0.1.2 (https://github.com/kivenZhou/free-music; personal, non-commercial)";
const APP_NAME: &str = "yinzhan";
const API: &str = "https://api.audius.co";

/// Curated discovery charts — no user login; public trending endpoints.
const CHARTS: &[(&str, &str, &str, &str)] = &[
    ("trending", "全球热门", "global", "Audius 全站趋势曲"),
    ("underground", "地下精选", "global", "Audius 地下趋势曲"),
    ("Electronic", "电子", "global", "Electronic 趋势"),
    ("Hip-Hop/Rap", "说唱", "global", "Hip-Hop / Rap 趋势"),
    ("Pop", "流行", "global", "Pop 趋势"),
    ("Alternative", "另类", "global", "Alternative 趋势"),
    ("Ambient", "氛围", "global", "Ambient 趋势"),
    ("Jazz", "爵士", "global", "Jazz 趋势"),
];

pub struct AudiusProvider {
    client: reqwest::Client,
    cache_dir: PathBuf,
}

impl AudiusProvider {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(UA));
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("http client");
        Self { client, cache_dir }
    }

    fn map_track(item: &Value) -> Option<Track> {
        let id = item.get("id")?.as_str()?.to_string();
        if id.is_empty() {
            return None;
        }
        // Skip gated / unlistenable tracks — keep only free full streams.
        let streamable = item
            .get("is_streamable")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let gated = item
            .get("is_stream_gated")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let access_stream = item
            .pointer("/access/stream")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if !streamable || gated || !access_stream {
            return None;
        }

        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("未知歌曲")
            .to_string();
        let artist = item
            .pointer("/user/name")
            .and_then(|v| v.as_str())
            .or_else(|| item.pointer("/user/handle").and_then(|v| v.as_str()))
            .unwrap_or("未知艺人")
            .to_string();
        let album = item
            .get("genre")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let duration_ms = item
            .get("duration")
            .and_then(|v| v.as_u64())
            .map(|s| s.saturating_mul(1000));
        let cover_url = item
            .pointer("/artwork/480x480")
            .or_else(|| item.pointer("/artwork/150x150"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Some(Track {
            id,
            provider: "audius".into(),
            title,
            artist,
            album,
            cover_url,
            duration_ms,
            playability: Playability::Full,
        })
    }

    async fn get_json(&self, url: &str) -> Result<Value, ProviderError> {
        let resp = self.client.get(url).send().await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Msg(format!(
                "Audius HTTP {}",
                resp.status()
            )));
        }
        resp.json()
            .await
            .map_err(|e| ProviderError::Parse(format!("audius json: {e}")))
    }

    async fn search_raw(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let url = format!(
            "{API}/v1/tracks/search?query={}&limit={}&app_name={APP_NAME}",
            urlencoding::encode(query),
            limit.max(1).min(50)
        );
        let json = self.get_json(&url).await?;
        let list = json
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list.iter().filter_map(Self::map_track).collect())
    }

    async fn trending_raw(
        &self,
        chart_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        let limit = limit.max(1).min(50);
        let offset = offset.min(200);
        let url = match chart_id {
            "trending" => format!(
                "{API}/v1/tracks/trending?limit={limit}&offset={offset}&app_name={APP_NAME}"
            ),
            "underground" => format!(
                "{API}/v1/tracks/trending/underground?limit={limit}&offset={offset}&app_name={APP_NAME}"
            ),
            genre => format!(
                "{API}/v1/tracks/trending?genre={}&limit={limit}&offset={offset}&app_name={APP_NAME}",
                urlencoding::encode(genre)
            ),
        };
        let json = self.get_json(&url).await?;
        let list = json
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list.iter().filter_map(Self::map_track).collect())
    }

    /// Collect primary stream URL + host mirrors (same path/query on alternate nodes).
    fn collect_stream_urls(item: &Value) -> Vec<String> {
        let mut urls = Vec::new();
        let Some(primary) = item
            .pointer("/stream/url")
            .and_then(|v| v.as_str())
            .filter(|u| u.starts_with("http"))
        else {
            return urls;
        };
        urls.push(primary.to_string());

        if let Ok(parsed) = reqwest::Url::parse(primary) {
            let path = parsed.path();
            let query = parsed
                .query()
                .map(|q| format!("?{q}"))
                .unwrap_or_default();
            if let Some(mirrors) = item.pointer("/stream/mirrors").and_then(|v| v.as_array()) {
                for m in mirrors {
                    let Some(base) = m.as_str() else { continue };
                    let base = base.trim_end_matches('/');
                    let candidate = format!("{base}{path}{query}");
                    if !urls.iter().any(|x| x == &candidate) {
                        urls.push(candidate);
                    }
                }
            }
        }
        urls
    }

    /// Prefer embedded signed stream URL(s); fall back to /stream redirect.
    async fn resolve_stream_candidates(&self, track_id: &str) -> Result<Vec<String>, ProviderError> {
        let detail = format!("{API}/v1/tracks/{track_id}?app_name={APP_NAME}");
        if let Ok(json) = self.get_json(&detail).await {
            if let Some(item) = json.get("data") {
                if Self::map_track(item).is_none() {
                    return Err(ProviderError::Msg("该曲不可免费完整播放".into()));
                }
                let urls = Self::collect_stream_urls(item);
                if !urls.is_empty() {
                    return Ok(urls);
                }
            }
        }

        let stream_api = format!("{API}/v1/tracks/{track_id}/stream?app_name={APP_NAME}");
        let resp = self
            .client
            .get(&stream_api)
            .send()
            .await
            .map_err(|e| ProviderError::Msg(format!("Audius 流请求失败: {e}")))?;
        if !resp.status().is_success() {
            return Err(ProviderError::Msg(format!(
                "Audius 流不可用 HTTP {}",
                resp.status()
            )));
        }
        Ok(vec![resp.url().to_string()])
    }

    async fn first_reachable(&self, urls: &[String]) -> Result<String, ProviderError> {
        let mut last = ProviderError::Msg("Audius 线路均不可用".into());
        for remote in urls {
            match self
                .client
                .get(remote)
                .header(reqwest::header::RANGE, "bytes=0-2047")
                .send()
                .await
            {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() || status.as_u16() == 206 {
                        if let Ok(bytes) = resp.bytes().await {
                            if bytes.len() >= 64 {
                                return Ok(remote.clone());
                            }
                            last = ProviderError::Msg("Audius 线路返回空数据".into());
                            continue;
                        }
                        return Ok(remote.clone());
                    }
                    last = ProviderError::Msg(format!("Audius 线路 HTTP {status}"));
                }
                Err(e) => {
                    last = ProviderError::Msg(format!("Audius 线路错误: {e}"));
                }
            }
        }
        Err(last)
    }

    async fn download_to_cache(&self, track_id: &str, urls: &[String]) -> Result<PathBuf, ProviderError> {
        let path = self.cache_dir.join(format!("audius_{track_id}.mp3"));
        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 50_000 {
                    return Ok(path);
                }
            }
        }

        let mut last = ProviderError::Msg("Audius 下载失败".into());
        for remote in urls {
            let resp = match self.client.get(remote).send().await {
                Ok(r) => r,
                Err(e) => {
                    last = ProviderError::Msg(format!("Audius 下载失败: {e}"));
                    continue;
                }
            };
            if !resp.status().is_success() {
                last = ProviderError::Msg(format!("Audius 下载失败 HTTP {}", resp.status()));
                continue;
            }
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    last = ProviderError::Msg(format!("Audius 下载中断: {e}"));
                    continue;
                }
            };
            if bytes.len() < 20_000 {
                last = ProviderError::Msg("Audius 音源过小，换线路重试".into());
                continue;
            }
            let tmp = path.with_extension("mp3.part");
            if std::fs::write(&tmp, &bytes).is_err() {
                last = ProviderError::Msg("写入缓存失败".into());
                continue;
            }
            if std::fs::rename(&tmp, &path).is_err() {
                let _ = std::fs::remove_file(&tmp);
                last = ProviderError::Msg("保存缓存失败".into());
                continue;
            }
            crate::cache::enforce_limit(&self.cache_dir);
            return Ok(path);
        }
        Err(last)
    }
}

#[async_trait]
impl MusicProvider for AudiusProvider {
    fn id(&self) -> &'static str {
        "audius"
    }

    fn name(&self) -> &'static str {
        "Audius"
    }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let tracks = self.search_raw(query, limit).await?;
        Ok(tracks.into_iter().take(limit as usize).collect())
    }

    async fn charts(&self) -> Result<Vec<Chart>, ProviderError> {
        Ok(CHARTS
            .iter()
            .map(|(id, name, region, desc)| Chart {
                id: (*id).into(),
                name: (*name).into(),
                region: (*region).into(),
                description: (*desc).into(),
            })
            .collect())
    }

    async fn chart_tracks(
        &self,
        chart_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        let tracks = self.trending_raw(chart_id, limit, offset).await?;
        Ok(tracks.into_iter().take(limit as usize).collect())
    }

    async fn play_url(
        &self,
        track_id: &str,
        _quality: AudioQuality,
    ) -> Result<PlayUrl, ProviderError> {
        let cached = self.cache_dir.join(format!("audius_{track_id}.mp3"));
        if cached.exists() {
            if let Ok(meta) = std::fs::metadata(&cached) {
                if meta.len() > 50_000 {
                    return Ok(PlayUrl {
                        url: format!("{API}/v1/tracks/{track_id}/stream?app_name={APP_NAME}"),
                        local_path: Some(cached.to_string_lossy().into_owned()),
                        playability: Playability::Full,
                        quality: None,
                        expires_hint: Some("cached".into()),
                    });
                }
            }
        }

        let urls = self.resolve_stream_candidates(track_id).await?;
        let remote = self.first_reachable(&urls).await?;

        let client = self.client.clone();
        let cache_dir = self.cache_dir.clone();
        let tid = track_id.to_string();
        let urls_bg = urls.clone();
        tauri::async_runtime::spawn(async move {
            let p = AudiusProvider { client, cache_dir };
            let _ = p.download_to_cache(&tid, &urls_bg).await;
        });

        Ok(PlayUrl {
            url: remote,
            local_path: None,
            playability: Playability::Full,
            quality: None,
            expires_hint: Some("stream".into()),
        })
    }
}
