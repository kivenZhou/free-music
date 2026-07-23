use super::{MusicProvider, ProviderError};
use crate::models::{Chart, Playability, PlayUrl, Track};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;
use std::path::PathBuf;

pub struct BilibiliProvider {
    client: Client,
    cache_dir: PathBuf,
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
            reqwest::header::HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36")
        );
        headers.insert(
            reqwest::header::COOKIE,
            reqwest::header::HeaderValue::from_static("buvid3=E1B3B3B3-B3B3-B3B3-B3B3-B3B3B3B3B3B316715infoc")
        );

        Self {
            client: Client::builder()
                .default_headers(headers)
                .build()
                .unwrap(),
            cache_dir,
        }
    }

    fn map_video_item(item: &Value) -> Option<Track> {
        let bvid = item.get("bvid").and_then(|v| v.as_str())?;
        if bvid.is_empty() { return None; }
        let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("未知歌曲")
            .replace("<em class=\"keyword\">", "")
            .replace("</em>", "");
        let artist = item.get("author").and_then(|v| v.as_str()).unwrap_or("B站UP主").to_string();
        let cover = item.get("pic").and_then(|v| v.as_str()).map(|s| {
            if s.starts_with("//") { format!("https:{s}") } else { s.to_string() }
        });
        
        let dur_str = item.get("duration").and_then(|v| v.as_str()).unwrap_or("00:00");
        let mut parts = dur_str.split(':').collect::<Vec<_>>();
        let mut ms = 0;
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

    async fn search_raw(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let mut tracks = Vec::new();
        let pages = ((limit + 49) / 50).max(1);
        
        for p in 1..=pages {
            let url = format!("https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={}&page={p}&tids=3", urlencoding::encode(query));
            if let Ok(resp) = self.client.get(&url).send().await {
                if let Ok(json) = resp.json::<Value>().await {
                    if let Some(arr) = json.pointer("/data/result").and_then(|v| v.as_array()) {
                        for item in arr {
                            if let Some(t) = Self::map_video_item(item) {
                                tracks.push(t);
                            }
                        }
                    }
                }
            }
        }
        Ok(self.expand_collections(tracks).await)
    }

    async fn expand_collections(&self, tracks: Vec<Track>) -> Vec<Track> {
        let mut expanded = Vec::new();
        for t in tracks {
            if t.duration_ms.unwrap_or(0) > 900_000 {
                let cid_url = format!("https://api.bilibili.com/x/player/pagelist?bvid={}&jsonp=jsonp", t.id);
                if let Ok(resp) = self.client.get(&cid_url).send().await {
                    if let Ok(json) = resp.json::<Value>().await {
                        if let Some(arr) = json.pointer("/data").and_then(|v| v.as_array()) {
                            if arr.len() > 1 {
                                for item in arr {
                                    if let Some(cid) = item.get("cid").and_then(|v| v.as_u64()) {
                                        let page = item.get("page").and_then(|v| v.as_u64()).unwrap_or(1);
                                        let part = item.get("part").and_then(|v| v.as_str()).unwrap_or("");
                                        let duration = item.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);
                                        
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
            }
            expanded.push(t);
        }
        expanded
    }

    async fn get_play_url(&self, track_id: &str) -> Result<String, ProviderError> {
        let mut bvid = track_id;
        let mut explicit_cid = None;
        if let Some((b, c)) = track_id.split_once("?cid=") {
            bvid = b;
            explicit_cid = c.parse::<u64>().ok();
        }

        let cid = if let Some(c) = explicit_cid {
            c
        } else {
            let cid_url = format!("https://api.bilibili.com/x/player/pagelist?bvid={bvid}&jsonp=jsonp");
            let cid_resp = self.client.get(&cid_url).send().await?.json::<Value>().await?;
            cid_resp.pointer("/data/0/cid").and_then(|v| v.as_u64()).ok_or_else(|| ProviderError::Msg("无法获取CID".into()))?
        };
        
        let play_url = format!("https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16");
        let play_resp = self.client.get(&play_url).send().await?.json::<Value>().await?;
        
        let audio_url = play_resp.pointer("/data/dash/audio/0/baseUrl")
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
        let resp = self.client.get(url)
            .header("Referer", "https://www.bilibili.com")
            .send().await?;
        let bytes = resp.bytes().await?;
        std::fs::write(&path, bytes).map_err(|e| ProviderError::Msg(e.to_string()))?;
        Ok(path)
    }
}

#[async_trait]
impl MusicProvider for BilibiliProvider {
    fn id(&self) -> &'static str { "bilibili" }
    fn name(&self) -> &'static str { "B站免源音乐" }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let candidates = self.search_raw(query, limit).await?;
        Ok(candidates.into_iter().take(limit as usize).collect())
    }

    async fn charts(&self) -> Result<Vec<Chart>, ProviderError> {
        Ok(CHARTS.iter().map(|(id, name, region, desc)| Chart {
            id: (*id).into(),
            name: (*name).into(),
            region: (*region).into(),
            description: (*desc).into(),
        }).collect())
    }

    async fn chart_tracks(&self, chart_id: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let kw = match chart_id {
            "bili_new" => "最新上传 音乐",
            "bili_cover" => "翻唱",
            "bili_acg" => "二次元 音乐",
            "bili_elec" => "抖腿 电音",
            _ => "华语流行 音乐",
        };
        let candidates = self.search_raw(kw, limit).await?;
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
