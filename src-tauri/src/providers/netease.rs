use super::{MusicProvider, ProviderError};
use crate::models::{Chart, PlayUrl, Playability, Track};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
use serde_json::Value;
use std::path::PathBuf;


const FALLBACK_CHARTS: &[(&str, &str, &str, &str)] = &[
    ("3778678", "热歌榜", "cn", "网易云音乐热歌榜"),
    ("3779629", "新歌榜", "cn", "华语/流行新歌"),
    ("19723756", "飙升榜", "cn", "近期飙升曲目"),
    ("2884035", "原创榜", "cn", "原创音乐榜"),
    ("745956260", "韩语榜", "kr", "韩国流行"),
    ("5059661515", "日语榜", "jp", "日本流行"),
];

fn https_url(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        url.to_string()
    }
}

pub struct NeteaseProvider {
    client: reqwest::Client,
    cache_dir: PathBuf,
}

impl NeteaseProvider {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            ),
        );
        headers.insert(REFERER, HeaderValue::from_static("https://music.163.com/"));
        headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("application/json, text/plain, */*"),
        );
        headers.insert(
            reqwest::header::ACCEPT_LANGUAGE,
            HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
        );
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("http client");
        Self { client, cache_dir }
    }

    fn map_song(song: &Value) -> Option<Track> {
        let id = song.get("id")?.as_u64()?.to_string();
        let title = song
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("未知歌曲")
            .to_string();
        let artist = song
            .get("artists")
            .or_else(|| song.get("ar"))
            .and_then(|arr| arr.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                    .collect::<Vec<_>>()
                    .join(" / ")
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "未知艺人".into());
        let album = song
            .get("album")
            .or_else(|| song.get("al"))
            .and_then(|a| a.get("name"))
            .and_then(|n| n.as_str())
            .map(|s| s.to_string());
        let cover_url = song
            .get("album")
            .or_else(|| song.get("al"))
            .and_then(|a| {
                a.get("picUrl")
                    .or_else(|| a.get("pic_url"))
                    .or_else(|| a.get("cover"))
            })
            .and_then(|n| n.as_str())
            .map(https_url);
        let duration_ms = song
            .get("duration")
            .or_else(|| song.get("dt"))
            .and_then(|v| v.as_u64());
        let fee = song.get("fee").and_then(|v| v.as_u64()).unwrap_or(0);
        // Only free / freemium full tracks (skip VIP / album-only)
        if matches!(fee, 1 | 4) {
            return None;
        }
        Some(Track {
            id,
            provider: "netease".into(),
            title,
            artist,
            album,
            cover_url,
            duration_ms,
            playability: Playability::Full,
        })
    }



    async fn fetch_playlist_tracks(
        &self,
        playlist_id: &str,
        limit: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        let url = format!(
            "https://music.163.com/api/v3/playlist/detail?id={}",
            playlist_id
        );
        let resp = self.client.post(&url).send().await?;
        let text = resp.text().await?;
        let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        
        // Handle code: -447 or missing tracks
        if json.get("code").and_then(|c| c.as_i64()) == Some(-447) {
            return Err(ProviderError::Parse("Netease rate limited (-447)".into()));
        }

        let tracks = json
            .pointer("/playlist/tracks")
            .or_else(|| json.pointer("/result/tracks"))
            .and_then(|v| v.as_array())
            .ok_or_else(|| ProviderError::Parse(format!("playlist tracks missing (code: {:?})", json.get("code"))))?;
        Ok(tracks
            .iter()
            .filter_map(Self::map_song)
            .take(limit as usize)
            .collect())
    }

    /// Official anonymous player URL API (works for free / fee=8 tracks).
    async fn fetch_official_url(&self, track_id: &str) -> Result<Option<(String, u64)>, ProviderError> {
        let url = format!(
            "https://music.163.com/api/song/enhance/player/url?ids=[{}]&br=320000",
            track_id
        );
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp.json().await?;
        let item = json
            .pointer("/data/0")
            .ok_or_else(|| ProviderError::Parse("player url missing".into()))?;
        let code = item.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
        let remote = item
            .get("url")
            .and_then(|v| v.as_str())
            .filter(|u| !u.is_empty())
            .map(https_url);
        let br = item.get("br").and_then(|v| v.as_u64()).unwrap_or(0);
        if remote.is_none() || code == -110 {
            return Ok(None);
        }
        Ok(remote.map(|u| (u, br)))
    }

    async fn is_audio_url(&self, url: &str) -> bool {
        let Ok(resp) = self.client.get(url).send().await else {
            return false;
        };
        if !resp.status().is_success() {
            return false;
        }
        let final_url = resp.url().to_string();
        if final_url.contains("/404") {
            return false;
        }
        let ctype = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ctype.contains("audio") || ctype.contains("mpeg") || ctype.contains("mp3") {
            return true;
        }
        // Some CDNs omit content-type; sniff magic
        if let Ok(bytes) = resp.bytes().await {
            if bytes.len() > 3 && &bytes[0..3] == b"ID3" {
                return true;
            }
            if bytes.len() > 1 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0 {
                return true;
            }
        }
        false
    }

    async fn download_to_cache(&self, track_id: &str, remote: &str) -> Result<PathBuf, ProviderError> {
        let _ = std::fs::create_dir_all(&self.cache_dir);
        let path = self.cache_dir.join(format!("{track_id}.mp3"));
        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 64 * 1024 {
                    return Ok(path);
                }
            }
        }
        let resp = self.client.get(remote).send().await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Msg(format!(
                "下载音源失败: HTTP {}",
                resp.status()
            )));
        }
        let bytes = resp.bytes().await?;
        if bytes.len() < 1024 {
            return Err(ProviderError::Msg("音源文件异常过小".into()));
        }
        // Reject HTML error pages
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(64)]).to_ascii_lowercase();
        if head.contains("<!doctype") || head.contains("<html") {
            return Err(ProviderError::Msg("音源返回了网页而非音频".into()));
        }
        let tmp = path.with_extension("mp3.part");
        std::fs::write(&tmp, &bytes).map_err(|e| ProviderError::Msg(e.to_string()))?;
        std::fs::rename(&tmp, &path).map_err(|e| ProviderError::Msg(e.to_string()))?;
        crate::cache::enforce_limit(&self.cache_dir.parent().unwrap_or(&self.cache_dir));
        Ok(path)
    }

    async fn resolve_play_candidates(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        // 1) Official API
        if let Some((remote, br)) = self.fetch_official_url(track_id).await? {
            match self.download_to_cache(track_id, &remote).await {
                Ok(local) => {
                    return Ok(PlayUrl {
                        url: remote,
                        local_path: Some(local.to_string_lossy().into_owned()),
                        playability: Playability::Full,
                        quality: Some(format!("{br}")),
                        expires_hint: Some("cached".into()),
                    });
                }
                Err(_) => {
                    // Fall back to direct HTTPS stream if download failed
                    if self.is_audio_url(&remote).await {
                        return Ok(PlayUrl {
                            url: remote,
                            local_path: None,
                            playability: Playability::Full,
                            quality: Some(format!("{br}")),
                            expires_hint: Some("direct".into()),
                        });
                    }
                }
            }
        }

        // 2) Outer media URL (only if it really redirects to audio)
        let outer = format!(
            "https://music.163.com/song/media/outer/url?id={}.mp3",
            track_id
        );
        if let Ok(resp) = self.client.get(&outer).send().await {
            let final_url = https_url(resp.url().as_str());
            if !final_url.contains("/404") {
                let ctype = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let looks_audio = ctype.contains("audio")
                    || ctype.contains("mpeg")
                    || ctype.contains("octet-stream");
                if looks_audio || self.is_audio_url(&final_url).await {
                    if let Ok(local) = self.download_to_cache(track_id, &final_url).await {
                        return Ok(PlayUrl {
                            url: final_url,
                            local_path: Some(local.to_string_lossy().into_owned()),
                            playability: Playability::Full,
                            quality: Some("outer".into()),
                            expires_hint: Some("cached".into()),
                        });
                    }
                }
            }
        }

        Err(ProviderError::Msg(
            "该曲在网易云无免费完整音源".into(),
        ))
    }
}

#[async_trait]
impl MusicProvider for NeteaseProvider {
    fn id(&self) -> &'static str {
        "netease"
    }

    fn name(&self) -> &'static str {
        "网易云音乐"
    }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let fetch_n = (limit * 3).max(30);
        let url = format!(
            "https://music.163.com/api/search/get/web?csrf_token=&s={}&type=1&offset=0&limit={}",
            urlencoding::encode(query),
            fetch_n
        );
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp.json().await?;
        let songs = json
            .pointer("/result/songs")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let tracks: Vec<Track> = songs.iter().filter_map(Self::map_song).take(limit as usize).collect();
        Ok(tracks)
    }

    async fn charts(&self) -> Result<Vec<Chart>, ProviderError> {
        let url = "https://music.163.com/api/toplist";
        // Official core boards only — avoid matching every "*热歌榜*" / "*日本*" variant.
        const OFFICIAL: &[(&str, &str, &str, &str)] = &[
            ("3778678", "热歌榜", "cn", "网易云音乐热歌榜"),
            ("3779629", "新歌榜", "cn", "华语/流行新歌"),
            ("19723756", "飙升榜", "cn", "近期飙升曲目"),
            ("2884035", "原创榜", "cn", "原创音乐榜"),
            ("745956260", "韩语榜", "kr", "韩国流行"),
            ("5059661515", "日语榜", "jp", "日本流行"),
        ];

        if let Ok(resp) = self.client.get(url).send().await {
            if let Ok(json) = resp.json::<Value>().await {
                if let Some(list) = json.get("list").and_then(|v| v.as_array()) {
                    let mut charts = Vec::new();
                    for (id, name, region, desc) in OFFICIAL {
                        let exists = list.iter().any(|item| {
                            item.get("id")
                                .and_then(|v| v.as_u64())
                                .map(|n| n.to_string() == *id)
                                .unwrap_or(false)
                        });
                        if exists {
                            charts.push(Chart {
                                id: (*id).into(),
                                name: (*name).into(),
                                region: (*region).into(),
                                description: (*desc).into(),
                            });
                        }
                    }
                    if !charts.is_empty() {
                        return Ok(charts);
                    }
                }
            }
        }

        Ok(FALLBACK_CHARTS
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
        let tracks = self.fetch_playlist_tracks(chart_id, limit).await?;
        Ok(tracks)
    }

    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        self.resolve_play_candidates(track_id).await
    }
}
