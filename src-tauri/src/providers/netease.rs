use super::{MusicProvider, ProviderError};
use crate::models::{Chart, PlayUrl, Playability, Track};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
use serde_json::Value;
use std::path::PathBuf;

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



    async fn fetch_song_details(&self, ids: &[u64]) -> Result<Vec<Value>, ProviderError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids_param = ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let url = format!("https://music.163.com/api/song/detail?ids=[{ids_param}]");
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp.json().await?;
        Ok(json
            .get("songs")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default())
    }

    async fn fetch_playlist_tracks(
        &self,
        playlist_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        // `n` asks for more embedded tracks; full charts still need trackIds + song/detail.
        let url = format!(
            "https://music.163.com/api/v3/playlist/detail?id={playlist_id}&n=1000&s=0"
        );
        let resp = self.client.post(&url).send().await?;
        let text = resp.text().await?;
        let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

        if json.get("code").and_then(|c| c.as_i64()) == Some(-447) {
            return Err(ProviderError::Parse("Netease rate limited (-447)".into()));
        }

        let mut ids: Vec<u64> = json
            .pointer("/playlist/trackIds")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("id").and_then(|v| v.as_u64()))
                    .collect()
            })
            .unwrap_or_default();

        if ids.is_empty() {
            ids = json
                .pointer("/playlist/tracks")
                .or_else(|| json.pointer("/result/tracks"))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.get("id").and_then(|v| v.as_u64()))
                        .collect()
                })
                .unwrap_or_default();
        }

        if ids.is_empty() {
            return Err(ProviderError::Parse(format!(
                "playlist tracks missing (code: {:?})",
                json.get("code")
            )));
        }

        // Collect free/playable tracks, then apply offset/limit in that filtered space
        // so VIP songs don't shrink a page below PAGE_SIZE and hide「加载更多」.
        let mut skipped = 0u32;
        let mut out = Vec::new();
        const BATCH: usize = 50;

        for chunk in ids.chunks(BATCH) {
            if out.len() >= limit as usize {
                break;
            }
            let songs = self.fetch_song_details(chunk).await?;
            for song in songs {
                let Some(track) = Self::map_song(&song) else {
                    continue;
                };
                if skipped < offset {
                    skipped += 1;
                    continue;
                }
                out.push(track);
                if out.len() >= limit as usize {
                    break;
                }
            }
        }

        Ok(out)
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

    async fn fetch_lyrics(&self, track_id: &str) -> Result<(Option<String>, Option<String>), ProviderError> {
        let url = format!(
            "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1",
            track_id
        );
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp.json().await?;
        let lrc = json
            .pointer("/lrc/lyric")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let tlyric = json
            .pointer("/tlyric/lyric")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        if lrc.is_none() && tlyric.is_none() {
            return Err(ProviderError::Msg("未找到歌词".into()));
        }
        Ok((lrc, tlyric))
    }

    async fn resolve_play_candidates(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        let cached = self.cache_dir.join(format!("{track_id}.mp3"));
        if cached.exists() {
            if let Ok(meta) = std::fs::metadata(&cached) {
                if meta.len() > 64 * 1024 {
                    // Still try to expose a remote URL for reference, but play from cache.
                    let remote = self
                        .fetch_official_url(track_id)
                        .await
                        .ok()
                        .flatten()
                        .map(|(u, _)| u)
                        .unwrap_or_default();
                    return Ok(PlayUrl {
                        url: remote,
                        local_path: Some(cached.to_string_lossy().into_owned()),
                        playability: Playability::Full,
                        quality: Some("cache".into()),
                        expires_hint: Some("cached".into()),
                    });
                }
            }
        }

        // 1) Official API — stream first, warm cache in background
        if let Some((remote, br)) = self.fetch_official_url(track_id).await? {
            self.spawn_cache(track_id, &remote);
            return Ok(PlayUrl {
                url: remote,
                local_path: None,
                playability: Playability::Full,
                quality: Some(format!("{br}")),
                expires_hint: Some("stream".into()),
            });
        }

        // 2) Outer media URL
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
                    self.spawn_cache(track_id, &final_url);
                    return Ok(PlayUrl {
                        url: final_url,
                        local_path: None,
                        playability: Playability::Full,
                        quality: Some("outer".into()),
                        expires_hint: Some("stream".into()),
                    });
                }
            }
        }

        Err(ProviderError::Msg(
            "该曲在网易云无免费完整音源".into(),
        ))
    }

    fn spawn_cache(&self, track_id: &str, remote: &str) {
        let client = self.client.clone();
        let cache_dir = self.cache_dir.clone();
        let track_id = track_id.to_string();
        let remote = remote.to_string();
        tauri::async_runtime::spawn(async move {
            let provider = NeteaseProvider {
                client,
                cache_dir,
            };
            let _ = provider.download_to_cache(&track_id, &remote).await;
        });
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
        // Official boards + curated genre playlists (粤语 / 怀旧 / 韩日语等).
        // Curated playlist IDs are not always present in /api/toplist — always expose them.
        const CHARTS: &[(&str, &str, &str, &str)] = &[
            ("3778678", "热歌榜", "cn", "网易云音乐热歌榜"),
            ("3779629", "新歌榜", "cn", "华语/流行新歌"),
            ("19723756", "飙升榜", "cn", "近期飙升曲目"),
            ("2884035", "原创榜", "cn", "原创音乐榜"),
            ("8577528546", "粤语金曲", "hk", "粤语流行精选"),
            ("825521241", "粤语怀旧", "hk", "七八十年代粤语经典"),
            ("2168337803", "80年代经典", "cn", "八十年代华语怀旧"),
            ("7438859223", "8090经典", "cn", "八九十年代流行金曲"),
            ("745956260", "韩语榜", "kr", "韩国流行"),
            ("5059644681", "日语榜", "jp", "日本流行"),
            ("60131", "日本Oricon", "jp", "Oricon 周榜向"),
            ("2809513713", "欧美热歌", "us", "欧美热门流行"),
        ];

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
        let tracks = self.fetch_playlist_tracks(chart_id, limit, offset).await?;
        Ok(tracks)
    }

    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        self.resolve_play_candidates(track_id).await
    }

    async fn lyrics(
        &self,
        track_id: &str,
    ) -> Result<(Option<String>, Option<String>), ProviderError> {
        self.fetch_lyrics(track_id).await
    }
}
