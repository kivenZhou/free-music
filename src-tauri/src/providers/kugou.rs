use super::{MusicProvider, ProviderError};
use crate::models::{AudioQuality, Chart, PlayUrl, Playability, Track};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
use serde_json::Value;
use std::path::PathBuf;

const UA: &str = "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

const CHARTS: &[(&str, &str, &str, &str)] = &[
    ("华语流行", "热歌精选", "cn", "酷狗搜索精选（部分需转酷我播放）"),
    ("华语新歌", "新歌精选", "cn", "酷狗免费向新歌"),
    ("粤语经典", "粤语金曲", "hk", "粤语免费精选"),
    ("粤语歌", "粤语流行", "hk", "粤语流行向"),
    ("80年代经典", "80年代", "cn", "八十年代怀旧"),
    ("90年代经典", "90年代", "cn", "九十年代怀旧"),
    ("怀旧金曲", "怀旧金曲", "cn", "经典怀旧精选"),
    ("韩语流行", "韩国流行", "kr", "韩流免费精选"),
    ("日语流行", "日本流行", "jp", "日流免费精选"),
    ("轻音乐", "轻音乐", "cn", "轻音乐 / 纯音乐"),
];

fn is_junk_title(title: &str) -> bool {
    const NEEDLES: &[&str] = &["伴奏", "片段", "试听", "铃声", "消音", "DJ版", "抖音热搜"];
    NEEDLES.iter().any(|n| title.contains(n))
}

fn prefer_http(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://") {
        // sharefs usually works on https; keep as-is for kugou CDN
        let _ = rest;
        url.to_string()
    } else {
        url.to_string()
    }
}

pub struct KugouProvider {
    client: reqwest::Client,
    cache_dir: PathBuf,
}

impl KugouProvider {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(UA));
        headers.insert(REFERER, HeaderValue::from_static("https://m.kugou.com/"));
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(25))
            .build()
            .expect("http client");
        Self { client, cache_dir }
    }

    fn map_search_item(item: &Value) -> Option<Track> {
        let hash = item.get("hash").and_then(|v| v.as_str())?.to_string();
        if hash.is_empty() {
            return None;
        }
        let title = item
            .get("songname")
            .or_else(|| item.get("songName"))
            .and_then(|v| v.as_str())
            .unwrap_or("未知歌曲")
            .to_string();
        if is_junk_title(&title) {
            return None;
        }
        let artist = item
            .get("singername")
            .or_else(|| item.get("singerName"))
            .and_then(|v| v.as_str())
            .unwrap_or("未知艺人")
            .to_string();
        let album = item
            .get("album_name")
            .or_else(|| item.get("albumName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let duration_ms = item
            .get("duration")
            .and_then(|v| v.as_u64())
            .map(|s| s * 1000);
        let cover_url = item
            .get("album_img")
            .or_else(|| item.get("imgUrl"))
            .and_then(|v| v.as_str())
            .map(|s| s.replace("{size}", "240"));
        Some(Track {
            id: hash.to_ascii_lowercase(),
            provider: "kugou".into(),
            title,
            artist,
            album,
            cover_url,
            duration_ms,
            playability: Playability::Full,
        })
    }

    async fn search_raw(
        &self,
        query: &str,
        pagesize: u32,
        page: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        let url = format!(
            "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword={}&page={}&pagesize={}&showtype=1",
            urlencoding::encode(query),
            page.max(1),
            pagesize
        );
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp.json().await?;
        let list = json
            .pointer("/data/info")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list.iter().filter_map(Self::map_search_item).collect())
    }

    async fn fetch_play_candidates(&self, hash: &str) -> Result<(Vec<String>, u64), ProviderError> {
        let url = format!("http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash={hash}");
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp.json().await?;
        let size = json.get("fileSize").and_then(|v| v.as_u64()).unwrap_or(0);
        if size > 0 && size < 100_000 {
            return Err(ProviderError::Msg("酷狗返回异常音源".into()));
        }

        let mut urls = Vec::new();
        if let Some(u) = json
            .get("url")
            .and_then(|v| v.as_str())
            .filter(|u| u.starts_with("http"))
        {
            urls.push(prefer_http(u));
        }
        if let Some(arr) = json.get("backup_url").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(u) = item.as_str().filter(|u| u.starts_with("http")) {
                    let p = prefer_http(u);
                    if !urls.iter().any(|x| x == &p) {
                        urls.push(p);
                    }
                }
            }
        }
        if urls.is_empty() {
            return Err(ProviderError::Msg("酷狗无免费播放地址".into()));
        }
        Ok((urls, size))
    }

    /// Probe candidates; return first that answers with audio bytes.
    async fn first_reachable(&self, urls: &[String]) -> Result<String, ProviderError> {
        let mut last = ProviderError::Msg("酷狗线路均不可用".into());
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
                        // Ensure body isn't an HTML error page.
                        if let Ok(bytes) = resp.bytes().await {
                            if bytes.len() >= 64 {
                                return Ok(remote.clone());
                            }
                            last = ProviderError::Msg("酷狗线路返回空数据".into());
                            continue;
                        }
                        return Ok(remote.clone());
                    }
                    last = ProviderError::Msg(format!("酷狗线路 HTTP {status}"));
                }
                Err(e) => {
                    last = ProviderError::Msg(format!("酷狗线路错误: {e}"));
                }
            }
        }
        Err(last)
    }

    async fn download_to_cache(&self, hash: &str, urls: &[String]) -> Result<PathBuf, ProviderError> {
        let path = self.cache_dir.join(format!("kugou_{hash}.mp3"));
        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 200_000 {
                    return Ok(path);
                }
            }
        }

        let mut last = ProviderError::Msg("酷狗下载失败".into());
        for remote in urls {
            let resp = match self.client.get(remote).send().await {
                Ok(r) => r,
                Err(e) => {
                    last = ProviderError::Msg(format!("下载失败: {e}"));
                    continue;
                }
            };
            if !resp.status().is_success() {
                last = ProviderError::Msg(format!("下载失败 HTTP {}", resp.status()));
                continue;
            }
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    last = ProviderError::Msg(format!("下载中断: {e}"));
                    continue;
                }
            };
            if bytes.len() < 100_000 {
                last = ProviderError::Msg("音源过小，换线路重试".into());
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

    async fn fetch_lyrics(
        &self,
        hash: &str,
    ) -> Result<(Option<String>, Option<String>), ProviderError> {
        use base64::Engine;

        let mut candidates: Vec<Value> = Vec::new();

        let search_hash = format!(
            "https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash={hash}"
        );
        if let Ok(search) = self
            .client
            .get(&search_hash)
            .send()
            .await
            .and_then(|r| r.error_for_status())
        {
            if let Ok(json) = search.json::<Value>().await {
                if let Some(arr) = json.get("candidates").and_then(|v| v.as_array()) {
                    candidates = arr.clone();
                }
            }
        }

        // Hash-only miss: pull title/duration from play info and search by keyword.
        if candidates.is_empty() {
            let info_url =
                format!("http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash={hash}");
            if let Ok(info) = self
                .client
                .get(&info_url)
                .send()
                .await
                .and_then(|r| r.error_for_status())
            {
                if let Ok(json) = info.json::<Value>().await {
                    let file_name = json
                        .get("fileName")
                        .or_else(|| json.get("songName"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim();
                    let duration_ms = json
                        .get("timeLength")
                        .and_then(|v| v.as_u64())
                        .map(|s| s.saturating_mul(1000))
                        .unwrap_or(0);
                    if !file_name.is_empty() {
                        let mut url = format!(
                            "https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword={}&hash={hash}",
                            urlencoding::encode(file_name)
                        );
                        if duration_ms > 0 {
                            url.push_str(&format!("&duration={duration_ms}"));
                        }
                        if let Ok(search) = self.client.get(&url).send().await {
                            if let Ok(json) = search.json::<Value>().await {
                                if let Some(arr) =
                                    json.get("candidates").and_then(|v| v.as_array())
                                {
                                    candidates = arr.clone();
                                }
                            }
                        }
                    }
                }
            }
        }

        let cand = candidates
            .first()
            .ok_or_else(|| ProviderError::Msg("酷狗无匹配歌词".into()))?;
        let id = cand
            .get("id")
            .map(|v| match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => String::new(),
            })
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ProviderError::Msg("酷狗歌词候选无效".into()))?;
        let accesskey = cand
            .get("accesskey")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ProviderError::Msg("酷狗歌词 accesskey 缺失".into()))?;

        // Prefer plain LRC (base64) over encrypted KRC.
        let dl_url = format!(
            "https://lyrics.kugou.com/download?ver=1&client=pc&id={id}&accesskey={accesskey}&fmt=lrc&charset=utf8"
        );
        let dl: Value = self.client.get(&dl_url).send().await?.json().await?;
        let content = dl
            .get("content")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ProviderError::Msg("酷狗歌词内容为空".into()))?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(content.trim())
            .map_err(|e| ProviderError::Parse(format!("酷狗歌词 base64: {e}")))?;
        let lrc = String::from_utf8_lossy(&bytes).trim().to_string();
        if lrc.is_empty() {
            return Err(ProviderError::Msg("酷狗歌词解码为空".into()));
        }
        Ok((Some(lrc), None))
    }
}

#[async_trait]
impl MusicProvider for KugouProvider {
    fn id(&self) -> &'static str {
        "kugou"
    }

    fn name(&self) -> &'static str {
        "酷狗音乐"
    }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let candidates = self.search_raw(query, limit, 1).await?;
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

    async fn chart_tracks(
        &self,
        chart_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        // Oversample — junk-title filter and sparse free rows shrink each page.
        let page_size = (limit.saturating_mul(2)).clamp(limit, 40);
        let page = (offset / limit.max(1)) + 1;
        let skip = (offset % limit.max(1)) as usize;
        let candidates = self.search_raw(chart_id, page_size, page).await?;
        Ok(candidates
            .into_iter()
            .skip(skip)
            .take(limit as usize)
            .collect())
    }

    async fn play_url(
        &self,
        track_id: &str,
        _quality: AudioQuality,
    ) -> Result<PlayUrl, ProviderError> {
        let (urls, size) = self.fetch_play_candidates(track_id).await?;
        let remote = self.first_reachable(&urls).await?;
        let cached = self.cache_dir.join(format!("kugou_{track_id}.mp3"));
        if cached.exists() {
            if let Ok(meta) = std::fs::metadata(&cached) {
                if meta.len() > 200_000 {
                    return Ok(PlayUrl {
                        url: remote,
                        local_path: Some(cached.to_string_lossy().into_owned()),
                        playability: Playability::Full,
                        quality: Some(format!("{size}")),
                        expires_hint: Some("cached".into()),
                    });
                }
            }
        }

        // Stream immediately; warm disk cache in the background (try all lines).
        let client = self.client.clone();
        let cache_dir = self.cache_dir.clone();
        let tid = track_id.to_string();
        let urls_bg = urls.clone();
        tauri::async_runtime::spawn(async move {
            let p = KugouProvider { client, cache_dir };
            let _ = p.download_to_cache(&tid, &urls_bg).await;
        });

        Ok(PlayUrl {
            url: remote,
            local_path: None,
            playability: Playability::Full,
            quality: Some(format!("{size}")),
            expires_hint: Some("stream".into()),
        })
    }

    async fn lyrics(
        &self,
        track_id: &str,
    ) -> Result<(Option<String>, Option<String>), ProviderError> {
        self.fetch_lyrics(track_id).await
    }
}
