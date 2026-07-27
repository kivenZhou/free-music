use super::{MusicProvider, ProviderError};
use crate::models::{AudioQuality, Chart, Playability, PlayUrl, Track};
use async_trait::async_trait;
use reqwest::cookie::Jar;
use reqwest::Client;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

pub struct BilibiliProvider {
    client: Client,
    /// Separate client for audio CDN — API timeout is too short for long downloads.
    download_client: Client,
    cookie_jar: Arc<Jar>,
    cache_dir: PathBuf,
    /// Serialize outbound API calls — rapid chart switching was tripping Bilibili risk control.
    api_lock: Mutex<()>,
    /// Whether we already bootstrapped buvid cookies for this process.
    session_ready: Mutex<bool>,
}

const CHARTS: &[(&str, &str, &str, &str)] = &[
    ("bili_hot", "热门金曲", "bilibili", "B站最热流行音乐视频"),
    ("bili_new", "最新音乐", "bilibili", "B站最新上传音乐"),
    ("bili_cantonese", "粤语歌", "hk", "粤语翻唱与金曲"),
    ("bili_80s", "80年代怀旧", "cn", "八十年代经典"),
    ("bili_90s", "90年代怀旧", "cn", "九十年代经典"),
    ("bili_kr", "韩语歌", "kr", "韩语翻唱与流行"),
    ("bili_jp", "日语歌", "jp", "日语翻唱与流行"),
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
        // Do NOT hardcode a fake buvid3 — Bilibili returns HTTP 412 HTML for that.

        let cookie_jar = Arc::new(Jar::default());
        let client = Client::builder()
            .default_headers(headers.clone())
            .cookie_provider(cookie_jar.clone())
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap();
        let download_client = Client::builder()
            .default_headers(headers)
            .cookie_provider(cookie_jar.clone())
            .connect_timeout(Duration::from_secs(20))
            // Long B站合集可达数百 MB，不能用 API 的 20s 超时。
            .timeout(Duration::from_secs(60 * 30))
            .build()
            .unwrap();

        Self {
            client,
            download_client,
            cookie_jar,
            cache_dir,
            api_lock: Mutex::new(()),
            session_ready: Mutex::new(false),
        }
    }

    async fn ensure_session(&self) -> Result<(), ProviderError> {
        let mut ready = self.session_ready.lock().await;
        if *ready {
            return Ok(());
        }

        // 1) Homepage sets b_nut / initial cookies.
        let _ = self
            .client
            .get("https://www.bilibili.com/")
            .send()
            .await
            .map_err(|e| ProviderError::Msg(format!("B站会话初始化失败: {e}")))?;

        // 2) Official finger API issues real buvid3 / buvid4 (avoids 412 on search).
        if let Ok(resp) = self
            .client
            .get("https://api.bilibili.com/x/frontend/finger/spi")
            .send()
            .await
        {
            if let Ok(json) = resp.json::<Value>().await {
                if json.get("code").and_then(|c| c.as_i64()) == Some(0) {
                    let b3 = json.pointer("/data/b_3").and_then(|v| v.as_str());
                    let b4 = json.pointer("/data/b_4").and_then(|v| v.as_str());
                    if let Ok(url) = "https://www.bilibili.com/".parse::<reqwest::Url>() {
                        if let Some(b3) = b3 {
                            self.cookie_jar.add_cookie_str(
                                &format!("buvid3={b3}; Domain=.bilibili.com; Path=/"),
                                &url,
                            );
                        }
                        if let Some(b4) = b4 {
                            self.cookie_jar.add_cookie_str(
                                &format!("buvid4={b4}; Domain=.bilibili.com; Path=/"),
                                &url,
                            );
                        }
                    }
                }
            }
        }

        *ready = true;
        Ok(())
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
        self.ensure_session().await?;
        let mut last_err = ProviderError::Msg("B站请求失败".into());

        for attempt in 0..3u32 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(350 * u64::from(attempt))).await;
                // One 412 HTML page often means the session was rejected — refresh cookies.
                if attempt == 1 {
                    let mut ready = self.session_ready.lock().await;
                    *ready = false;
                    drop(ready);
                    let _ = self.ensure_session().await;
                }
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
                    if status.as_u16() == 412 {
                        last_err = ProviderError::Msg(
                            "B站触发风控 (412)，正在刷新会话后重试".into(),
                        );
                        continue;
                    }
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
        offset: u32,
        expand: bool,
    ) -> Result<Vec<Track>, ProviderError> {
        let _guard = self.api_lock.lock().await;

        // B站搜索默认每页约 20 条。
        let page_size = 20u32;
        let mut page = (offset / page_size) + 1;
        let mut skip = offset % page_size;
        let mut tracks = Vec::new();

        while tracks.len() < limit as usize {
            let url = format!(
                "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={}&page={page}&page_size={page_size}&tids=3",
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
                    // Keep whatever we already have if a later page is blocked.
                    if !tracks.is_empty() {
                        break;
                    }
                    return Err(ProviderError::Msg(format!(
                        "B站搜索被限制 ({code})，请稍后再试"
                    )));
                }
                return Err(ProviderError::Msg(format!(
                    "B站搜索失败 ({code}): {msg}"
                )));
            }

            let Some(arr) = json.pointer("/data/result").and_then(|v| v.as_array()) else {
                break;
            };
            if arr.is_empty() {
                break;
            }

            let before = tracks.len();
            for item in arr {
                if skip > 0 {
                    skip -= 1;
                    continue;
                }
                if let Some(t) = Self::map_video_item(item) {
                    tracks.push(t);
                    if tracks.len() >= limit as usize {
                        break;
                    }
                }
            }
            // No progress or short page → stop paging.
            if tracks.len() == before || arr.len() < page_size as usize {
                break;
            }

            page += 1;
            tokio::time::sleep(Duration::from_millis(220)).await;
        }

        tracks.truncate(limit as usize);
        if expand {
            Ok(self.expand_collections(tracks, limit.max(8) as usize).await)
        } else {
            Ok(tracks)
        }
    }

    /// Split multi-part (分P) BVs into per-page tracks with real durations.
    /// Search/chart APIs often report the *sum* of all parts, while playurl uses one cid.
    async fn expand_collections(&self, tracks: Vec<Track>, max_expand: usize) -> Vec<Track> {
        let mut expanded = Vec::new();
        let mut expanded_count = 0usize;
        for t in tracks {
            // Skip already-expanded pages (id contains ?cid=).
            if t.id.contains("?cid=") {
                expanded.push(t);
                continue;
            }

            let looks_multipart = t.title.contains("分P")
                || t.title.contains("分p")
                || t.duration_ms.unwrap_or(0) > 20 * 60 * 1000;
            let should_try = looks_multipart && expanded_count < max_expand;

            if should_try {
                let cid_url = format!(
                    "https://api.bilibili.com/x/player/pagelist?bvid={}&jsonp=jsonp",
                    t.id
                );
                if let Ok(json) = self.fetch_json(&cid_url).await {
                    if let Some(arr) = json.pointer("/data").and_then(|v| v.as_array()) {
                        if arr.len() > 1 {
                            expanded_count += 1;
                            // Keep enough parts for long compilations (e.g. 150-song mixes).
                            for item in arr.iter().take(80) {
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
                                        format!("{} · P{}", t.title, page)
                                    } else if arr.len() > 8 {
                                        format!("P{page} {part}")
                                    } else {
                                        part.to_string()
                                    };

                                    expanded.push(Track {
                                        id: format!("{}?cid={}", t.id, cid),
                                        provider: t.provider.clone(),
                                        title,
                                        artist: t.artist.clone(),
                                        album: Some(t.title.clone()),
                                        cover_url: t.cover_url.clone(),
                                        duration_ms: Some(duration * 1000),
                                        playability: Playability::Full,
                                    });
                                }
                            }
                            continue;
                        }

                        // Single page: correct inflated search-API duration using pagelist.
                        if let Some(item) = arr.first() {
                            let duration = item.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);
                            if duration > 0 {
                                expanded.push(Track {
                                    duration_ms: Some(duration * 1000),
                                    ..t
                                });
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

    /// Minimum plausible size for a cached AAC/m4a (~24 kbps floor).
    fn min_bytes_for_duration(duration_secs: u64) -> u64 {
        duration_secs.saturating_mul(3_000) // 3 KB/s ≈ 24 kbps
    }

    fn cache_path(&self, track_id: &str) -> PathBuf {
        let safe_id = track_id.replace("?cid=", "_");
        self.cache_dir.join(format!("{safe_id}.m4a"))
    }

    fn dash_audio_urls(play_resp: &Value) -> Option<(Vec<String>, u64)> {
        let duration = play_resp
            .pointer("/data/dash/duration")
            .or_else(|| play_resp.pointer("/data/timelength"))
            .and_then(|v| v.as_u64())
            .map(|v| {
                // timelength is ms; dash.duration is seconds
                if v > 100_000 {
                    v / 1000
                } else {
                    v
                }
            })
            .unwrap_or(0);

        let audio = play_resp.pointer("/data/dash/audio")?.as_array()?;
        let mut ranked: Vec<(u64, Vec<String>)> = Vec::new();
        for item in audio {
            let bandwidth = item.get("bandwidth").and_then(|v| v.as_u64()).unwrap_or(0);
            let mut urls = Vec::new();
            if let Some(u) = item
                .get("baseUrl")
                .or_else(|| item.get("base_url"))
                .and_then(|v| v.as_str())
            {
                urls.push(u.to_string());
            }
            if let Some(arr) = item
                .get("backupUrl")
                .or_else(|| item.get("backup_url"))
                .and_then(|v| v.as_array())
            {
                for u in arr.iter().filter_map(|v| v.as_str()) {
                    if !urls.iter().any(|x| x == u) {
                        urls.push(u.to_string());
                    }
                }
            }
            if !urls.is_empty() {
                ranked.push((bandwidth, urls));
            }
        }
        if ranked.is_empty() {
            return None;
        }
        ranked.sort_by(|a, b| b.0.cmp(&a.0));
        let mut out = Vec::new();
        for (_, urls) in ranked {
            for u in urls {
                if !out.iter().any(|x| x == &u) {
                    out.push(u);
                }
            }
        }
        Some((out, duration))
    }

    async fn get_play_info(&self, track_id: &str) -> Result<(Vec<String>, u64), ProviderError> {
        let _guard = self.api_lock.lock().await;

        let mut bvid = track_id;
        let mut explicit_cid = None;
        if let Some((b, c)) = track_id.split_once("?cid=") {
            bvid = b;
            explicit_cid = c.parse::<u64>().ok();
        }

        let (cid, page_duration) = if let Some(c) = explicit_cid {
            (c, 0u64)
        } else {
            let cid_url =
                format!("https://api.bilibili.com/x/player/pagelist?bvid={bvid}&jsonp=jsonp");
            let cid_resp = self.fetch_json(&cid_url).await?;
            let cid = cid_resp
                .pointer("/data/0/cid")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| ProviderError::Msg("无法获取CID".into()))?;
            let dur = cid_resp
                .pointer("/data/0/duration")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            (cid, dur)
        };

        let play_url = format!(
            "https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16&fourk=1"
        );
        let play_resp = self.fetch_json(&play_url).await?;
        let api_code = play_resp.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        if api_code != 0 {
            let msg = play_resp
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            return Err(ProviderError::Msg(format!(
                "B站取流失败 ({api_code}): {msg}"
            )));
        }

        let (urls, mut duration) = Self::dash_audio_urls(&play_resp)
            .ok_or_else(|| ProviderError::Msg("无法获取B站音频流".into()))?;
        if duration == 0 {
            duration = page_duration;
        }
        Ok((urls, duration))
    }

    async fn download_to_cache(
        &self,
        track_id: &str,
        urls: &[String],
        duration_secs: u64,
    ) -> Result<(PathBuf, String), ProviderError> {
        use futures::StreamExt;
        use std::io::Write;

        let path = self.cache_path(track_id);
        let min_bytes = Self::min_bytes_for_duration(duration_secs.max(30));

        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() >= min_bytes {
                    return Ok((path, urls.first().cloned().unwrap_or_default()));
                }
            }
            let _ = std::fs::remove_file(&path);
        }

        let mut last_err = ProviderError::Msg("B站音频下载失败".into());
        for remote in urls {
            let tmp = path.with_extension("m4a.part");
            let _ = std::fs::remove_file(&tmp);

            let resp = match self
                .download_client
                .get(remote)
                .header("Referer", "https://www.bilibili.com")
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    last_err = ProviderError::Msg(format!("B站音频下载失败: {e}"));
                    continue;
                }
            };

            if !resp.status().is_success() {
                last_err = ProviderError::Msg(format!("B站音频 HTTP {}", resp.status()));
                continue;
            }

            let expected = resp.content_length();
            let mut file = match std::fs::File::create(&tmp) {
                Ok(f) => f,
                Err(e) => {
                    last_err = ProviderError::Msg(format!("无法创建缓存文件: {e}"));
                    continue;
                }
            };
            let mut written: u64 = 0;
            let mut stream = resp.bytes_stream();
            let mut stream_err = false;
            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        last_err = ProviderError::Msg(format!("B站音频下载中断: {e}"));
                        stream_err = true;
                        break;
                    }
                };
                if let Err(e) = file.write_all(&chunk) {
                    last_err = ProviderError::Msg(format!("写入缓存失败: {e}"));
                    stream_err = true;
                    break;
                }
                written += chunk.len() as u64;
            }
            if let Err(e) = file.sync_all() {
                last_err = ProviderError::Msg(format!("写入缓存失败: {e}"));
                let _ = std::fs::remove_file(&tmp);
                continue;
            }
            drop(file);
            if stream_err {
                let _ = std::fs::remove_file(&tmp);
                continue;
            }

            if let Some(exp) = expected {
                if written + 1024 < exp {
                    let _ = std::fs::remove_file(&tmp);
                    last_err = ProviderError::Msg(format!(
                        "B站音频下载不完整（{written}/{exp} 字节），换线路重试"
                    ));
                    continue;
                }
            } else if written < min_bytes {
                let _ = std::fs::remove_file(&tmp);
                last_err = ProviderError::Msg(format!(
                    "B站音频过短（{written} 字节），换线路重试"
                ));
                continue;
            }

            if let Err(e) = std::fs::rename(&tmp, &path) {
                let _ = std::fs::remove_file(&tmp);
                last_err = ProviderError::Msg(format!("保存缓存失败: {e}"));
                continue;
            }
            crate::cache::enforce_limit(&self.cache_dir);
            return Ok((path, remote.clone()));
        }

        Err(last_err)
    }
}

#[async_trait]
impl MusicProvider for BilibiliProvider {
    fn id(&self) -> &'static str {
        "bilibili"
    }
    fn name(&self) -> &'static str {
        "B站音乐"
    }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let candidates = self.search_raw(query, limit, 0, true).await?;
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
        let kw = match chart_id {
            "bili_new" => "最新上传 音乐",
            "bili_cover" => "翻唱",
            "bili_acg" => "二次元 音乐",
            "bili_elec" => "抖腿 电音",
            "bili_hot" => "热门 华语 音乐",
            "bili_cantonese" => "粤语歌",
            "bili_80s" => "80年代 经典老歌",
            "bili_90s" => "90年代 经典金曲",
            "bili_kr" => "韩语歌",
            "bili_jp" => "日语歌",
            _ => "华语流行 音乐",
        };
        // Expand 分P so list duration matches the cid we actually play.
        let candidates = self.search_raw(kw, limit, offset, true).await?;
        Ok(candidates.into_iter().take(limit as usize).collect())
    }

    async fn play_url(
        &self,
        track_id: &str,
        _quality: AudioQuality,
    ) -> Result<PlayUrl, ProviderError> {
        let (remotes, duration_secs) = self.get_play_info(track_id).await?;
        let path = self.cache_path(track_id);
        let min_bytes = Self::min_bytes_for_duration(duration_secs.max(30));

        // Drop truncated caches from the old 20s-timeout downloader.
        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() < min_bytes {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }

        // B站音频 CDN 需要 Referer；先完整落盘再播，失败时自动换备用线路。
        let (local, remote) = self
            .download_to_cache(track_id, &remotes, duration_secs)
            .await?;

        Ok(PlayUrl {
            url: remote,
            local_path: Some(local.to_string_lossy().into_owned()),
            playability: Playability::Full,
            quality: Some("HQ".into()),
            expires_hint: Some("cached".into()),
        })
    }
}
