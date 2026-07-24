use super::{MusicProvider, ProviderError};
use crate::models::{Chart, Playability, PlayUrl, Track};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::Mutex;

pub struct BilibiliProvider {
    client: Client,
    cache_dir: PathBuf,
    /// Serialize outbound API calls — rapid chart switching was tripping Bilibili risk control.
    api_lock: Mutex<()>,
}

const CHARTS: &[(&str, &str, &str, &str)] = &[
    ("bili_hot", "热门金曲", "bilibili", "B站最热流行音乐视频"),
    ("bili_new", "最新音乐", "bilibili", "B站最新上传音乐"),
    ("bili_cover", "翻唱大赏", "bilibili", "高质量民间翻唱"),
    ("bili_acg", "二次元", "bilibili", "ACG神曲全收录"),
    ("bili_elec", "抖腿电音", "bilibili", "超燃电音与鬼畜"),
];

impl BilibiliProvider {
    pub fn new(cache_dir: PathBuf) -> Self {
        if !cache_dir.exists() {
            let _ = std::fs::create_dir_all(&cache_dir);
        }

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::USER_AGENT,
            reqwest::header::HeaderValue::from_static(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            ),
        );
        headers.insert(
            reqwest::header::REFERER,
            reqwest::header::HeaderValue::from_static("https://www.bilibili.com/"),
        );
        headers.insert(
            reqwest::header::ORIGIN,
            reqwest::header::HeaderValue::from_static("https://www.bilibili.com"),
        );
        headers.insert(
            reqwest::header::ACCEPT,
            reqwest::header::HeaderValue::from_static("application/json, text/plain, */*"),
        );
        headers.insert(
            reqwest::header::COOKIE,
            reqwest::header::HeaderValue::from_static(
                "buvid3=E1B3B3B3-B3B3-B3B3-B3B3-B3B3B3B3B3B316715infoc",
            ),
        );

        Self {
            client: Client::builder()
                .default_headers(headers)
                .timeout(Duration::from_secs(20))
                .build()
                .unwrap(),
            cache_dir,
            api_lock: Mutex::new(()),
        }
    }

    fn map_video_item(item: &Value) -> Option<Track> {
        let bvid = item.get("bvid").and_then(|v| v.as_str())?;
        if bvid.is_empty() {
            return None;
        }
        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("未知歌曲")
            .replace("<em class=\"keyword\">", "")
            .replace("</em>", "");
        let artist = item
            .get("author")
            .and_then(|v| v.as_str())
            .unwrap_or("B站UP主")
            .to_string();
        let cover = item.get("pic").and_then(|v| v.as_str()).map(|s| {
            if s.starts_with("//") {
                format!("https:{s}")
            } else {
                s.to_string()
            }
        });

        let dur_str = item
            .get("duration")
            .and_then(|v| v.as_str())
            .unwrap_or("00:00");
        let parts: Vec<&str> = dur_str.split(':').collect();
        let mut ms = 0u64;
        if parts.len() == 2 {
            let m: u64 = parts[0].parse().unwrap_or(0);
            let s: u64 = parts[1].parse().unwrap_or(0);
            ms = (m * 60 + s) * 1000;
        } else if parts.len() == 3 {
            let h: u64 = parts[0].parse().unwrap_or(0);
            let m: u64 = parts[1].parse().unwrap_or(0);
            let s: u64 = parts[2].parse().unwrap_or(0);
            ms = (h * 3600 + m * 60 + s) * 1000;
        }

        Some(Track {
            id: bvid.to_string(),
            provider: "bilibili".into(),
            title,
            artist,
            album: None,
            cover_url: cover,
            duration_ms: Some(ms),
            playability: Playability::Full,
        })
    }

    async fn fetch_json(&self, url: &str) -> Result<Value, ProviderError> {
        let mut last_err = ProviderError::Msg("B站请求失败".into());

        for attempt in 0..3u32 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(350 * u64::from(attempt))).await;
            }

            let resp = match self.client.get(url).send().await {
                Ok(r) => r,
                Err(e) => {
                    last_err = ProviderError::Msg(format!("B站网络错误: {e}"));
                    continue;
                }
            };

            let status = resp.status();
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    last_err = ProviderError::Msg(format!("B站读取响应失败: {e}"));
                    continue;
                }
            };

            if bytes.is_empty() {
                last_err = ProviderError::Msg("B站返回空响应，请稍后重试".into());
                continue;
            }

            // Risk-control / HTML challenge pages are not JSON
            let starts_like_json = bytes
                .iter()
                .find(|b| !b.is_ascii_whitespace())
                .is_some_and(|b| *b == b'{' || *b == b'[');
            if !starts_like_json {
                last_err = ProviderError::Msg(
                    "B站接口繁忙或触发风控，请稍等几秒后点「重新加载」".into(),
                );
                continue;
            }

            match serde_json::from_slice::<Value>(&bytes) {
                Ok(json) => {
                    if !status.is_success() {
                        last_err = ProviderError::Msg(format!("B站 HTTP {status}"));
                        continue;
                    }
                    return Ok(json);
                }
                Err(_) => {
                    last_err = ProviderError::Msg(
                        "B站返回异常内容（可能被限流），请稍后再试".into(),
                    );
                    continue;
                }
            }
        }

        Err(last_err)
    }

    async fn search_raw(
        &self,
        query: &str,
        limit: u32,
        expand: bool,
    ) -> Result<Vec<Track>, ProviderError> {
        let _guard = self.api_lock.lock().await;

        let url = format!(
            "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={}&page=1&tids=3",
            urlencoding::encode(query)
        );

        let json = self.fetch_json(&url).await?;
        let code = json.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        if code != 0 {
            let msg = json
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            // -412 / -799 style risk control
            if code == -412 || code == -799 || code == -352 {
                return Err(ProviderError::Msg(format!(
                    "B站搜索被限制 ({code})，请稍后再试"
                )));
            }
            return Err(ProviderError::Msg(format!(
                "B站搜索失败 ({code}): {msg}"
            )));
        }

        let mut tracks = Vec::new();
        if let Some(arr) = json.pointer("/data/result").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(t) = Self::map_video_item(item) {
                    tracks.push(t);
                    if tracks.len() >= limit as usize {
                        break;
                    }
                }
            }
        }

        tracks.truncate(limit as usize);
        if expand {
            Ok(self.expand_collections(tracks, 3).await)
        } else {
            Ok(tracks)
        }
    }

    async fn expand_collections(&self, tracks: Vec<Track>, max_expand: usize) -> Vec<Track> {
        let mut expanded = Vec::new();
        let mut expanded_count = 0usize;
        for t in tracks {
            let should_try =
                expanded_count < max_expand && t.duration_ms.unwrap_or(0) > 900_000;
            if should_try {
                let cid_url = format!(
                    "https://api.bilibili.com/x/player/pagelist?bvid={}&jsonp=jsonp",
                    t.id
                );
                if let Ok(json) = self.fetch_json(&cid_url).await {
                    if let Some(arr) = json.pointer("/data").and_then(|v| v.as_array()) {
                        if arr.len() > 1 {
                            expanded_count += 1;
                            for item in arr.iter().take(12) {
                                if let Some(cid) = item.get("cid").and_then(|v| v.as_u64()) {
                                    let page =
                                        item.get("page").and_then(|v| v.as_u64()).unwrap_or(1);
                                    let part =
                                        item.get("part").and_then(|v| v.as_str()).unwrap_or("");
                                    let duration = item
                                        .get("duration")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0);

                                    let title = if part.is_empty() {
                                        format!("{} (P{})", t.title, page)
                                    } else {
                                        part.to_string()
                                    };

                                    expanded.push(Track {
                                        id: format!("{}?cid={}", t.id, cid),
                                        provider: t.provider.clone(),
                                        title,
                                        artist: t.artist.clone(),
                                        album: t.album.clone(),
                                        cover_url: t.cover_url.clone(),
                                        duration_ms: Some(duration * 1000),
                                        playability: Playability::Full,
                                    });
                                }
                            }
                            continue;
                        }
                    }
                }
            }
            expanded.push(t);
        }
        expanded
    }

    async fn get_play_url(&self, track_id: &str) -> Result<String, ProviderError> {
        let _guard = self.api_lock.lock().await;

        let mut bvid = track_id;
        let mut explicit_cid = None;
        if let Some((b, c)) = track_id.split_once("?cid=") {
            bvid = b;
            explicit_cid = c.parse::<u64>().ok();
        }

        let cid = if let Some(c) = explicit_cid {
            c
        } else {
            let cid_url =
                format!("https://api.bilibili.com/x/player/pagelist?bvid={bvid}&jsonp=jsonp");
            let cid_resp = self.fetch_json(&cid_url).await?;
            cid_resp
                .pointer("/data/0/cid")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| ProviderError::Msg("无法获取CID".into()))?
        };

        let play_url =
            format!("https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16");
        let play_resp = self.fetch_json(&play_url).await?;

        let audio_url = play_resp
            .pointer("/data/dash/audio/0/baseUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ProviderError::Msg("无法获取B站音频流".into()))?;
        Ok(audio_url)
    }

    async fn download_to_cache(&self, track_id: &str, url: &str) -> Result<PathBuf, ProviderError> {
        let safe_id = track_id.replace("?cid=", "_");
        let path = self.cache_dir.join(format!("{}.m4a", safe_id));
        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 100_000 {
                    return Ok(path);
                }
            }
        }
        let resp = self
            .client
            .get(url)
            .header("Referer", "https://www.bilibili.com")
            .send()
            .await?;
        let bytes = resp.bytes().await?;
        std::fs::write(&path, bytes).map_err(|e| ProviderError::Msg(e.to_string()))?;
        Ok(path)
    }
}

#[async_trait]
impl MusicProvider for BilibiliProvider {
    fn id(&self) -> &'static str {
        "bilibili"
    }
    fn name(&self) -> &'static str {
        "B站免源音乐"
    }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let candidates = self.search_raw(query, limit, true).await?;
        Ok(candidates.into_iter().take(limit as usize).collect())
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

    async fn chart_tracks(&self, chart_id: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let kw = match chart_id {
            "bili_new" => "最新上传 音乐",
            "bili_cover" => "翻唱",
            "bili_acg" => "二次元 音乐",
            "bili_elec" => "抖腿 电音",
            "bili_hot" => "热门 华语 音乐",
            _ => "华语流行 音乐",
        };
        let candidates = self.search_raw(kw, limit, false).await?;
        Ok(candidates.into_iter().take(limit as usize).collect())
    }

    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        let remote = self.get_play_url(track_id).await?;
        let local = self.download_to_cache(track_id, &remote).await?;

        Ok(PlayUrl {
            url: format!("file://{}", local.to_string_lossy()),
            local_path: Some(local.to_string_lossy().into_owned()),
            playability: Playability::Full,
            quality: Some("HQ".into()),
            expires_hint: Some("cached".into()),
        })
    }
}
