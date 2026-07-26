use super::{MusicProvider, ProviderError};
use crate::models::{Chart, PlayUrl, Playability, Track};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, REFERER, USER_AGENT};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const UA: &str =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/// Official 巅峰榜 topids + keyword charts for 粤语 / 怀旧等.
/// Listing only keeps `payplay == 0` (anonymous free-full); play_url still re-checks vkey.
const CHARTS: &[(&str, &str, &str, &str)] = &[
    ("27", "新歌榜", "cn", "QQ 巅峰榜·新歌（免费可播较多）"),
    ("5", "内地榜", "cn", "QQ 巅峰榜·内地"),
    ("6", "港台榜", "hk", "QQ 巅峰榜·港台（含粤语）"),
    ("16", "韩国榜", "kr", "QQ 巅峰榜·韩国"),
    ("17", "日本榜", "jp", "QQ 巅峰榜·日本"),
    ("3", "欧美榜", "us", "QQ 巅峰榜·欧美"),
    ("26", "热歌榜", "cn", "QQ 巅峰榜·热歌（免费可播较少）"),
    ("粤语经典", "粤语金曲", "hk", "粤语搜索精选"),
    ("80年代经典", "80年代", "cn", "八十年代怀旧"),
    ("90年代经典", "90年代", "cn", "九十年代怀旧"),
    ("怀旧金曲", "怀旧金曲", "cn", "经典怀旧精选"),
];

/// Quality ladder for anonymous play. Prefer widely free formats first.
const QUALITIES: &[(&str, &str)] = &[
    ("M500", "mp3"), // 128kbps — most free tracks
    ("C400", "m4a"),
    ("C200", "m4a"),
    ("M800", "mp3"), // 320 — sometimes free, often VIP
];

pub struct QqProvider {
    client: reqwest::Client,
    cache_dir: PathBuf,
}

impl QqProvider {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(UA));
        headers.insert(REFERER, HeaderValue::from_static("https://y.qq.com/"));
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(25))
            .build()
            .expect("http client");
        Self { client, cache_dir }
    }

    fn cover_url(albummid: &str) -> Option<String> {
        if albummid.is_empty() {
            None
        } else {
            Some(format!(
                "https://y.gtimg.cn/music/photo_new/T002R300x300M000{albummid}.jpg"
            ))
        }
    }

    fn pay_play(item: &Value) -> Option<u64> {
        item.pointer("/pay/payplay")
            .or_else(|| item.pointer("/pay/pay_play"))
            .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|n| n as u64)))
    }

    fn size128(item: &Value) -> u64 {
        item.get("size128")
            .and_then(|v| v.as_u64())
            .or_else(|| item.pointer("/file/size_128").and_then(|v| v.as_u64()))
            .or_else(|| item.pointer("/file/size_128mp3").and_then(|v| v.as_u64()))
            .unwrap_or(0)
    }

    fn interval_secs(item: &Value) -> u64 {
        item.get("interval").and_then(|v| v.as_u64()).unwrap_or(0)
    }

    fn song_mid(item: &Value) -> Option<&str> {
        item.get("songmid")
            .or_else(|| item.get("mid"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
    }

    fn media_mid(item: &Value) -> Option<&str> {
        item.get("strMediaMid")
            .or_else(|| item.get("media_mid"))
            .or_else(|| item.pointer("/file/media_mid"))
            .or_else(|| item.pointer("/file/strMediaMid"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
    }

    /// Anonymous clients can only fully stream tracks with payplay == 0.
    /// Listing VIP-looking “full size” tracks made ~80–90% of charts unplayable.
    fn looks_free_full(item: &Value) -> bool {
        let interval = Self::interval_secs(item);
        let size128 = Self::size128(item);
        if interval > 0 && interval < 45 {
            return false;
        }
        if size128 > 0 && size128 < 350_000 {
            return false;
        }
        match Self::pay_play(item) {
            Some(0) => true,
            // Missing pay flag: keep only when size looks like a full 128k file.
            None => size128 >= 1_500_000 || interval >= 120,
            Some(_) => false,
        }
    }

    fn map_song(item: &Value) -> Option<Track> {
        let mid = Self::song_mid(item)?.to_string();
        if !Self::looks_free_full(item) {
            return None;
        }
        let title = item
            .get("songname")
            .or_else(|| item.get("name"))
            .or_else(|| item.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("未知歌曲")
            .to_string();
        let artist = item
            .get("singer")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| {
                        s.get("name")
                            .or_else(|| s.get("title"))
                            .and_then(|n| n.as_str())
                    })
                    .collect::<Vec<_>>()
                    .join(" / ")
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "未知艺人".into());
        let album = item
            .get("albumname")
            .map(|v| v.as_str())
            .or_else(|| item.pointer("/album/name").map(|v| v.as_str()))
            .flatten()
            .map(|s| s.to_string());
        let albummid = item
            .get("albummid")
            .or_else(|| item.pointer("/album/mid"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let duration_ms = Self::interval_secs(item)
            .checked_mul(1000)
            .filter(|&ms| ms > 0);
        // Encode media_mid when it differs so play_url can build the right filename.
        let id = match Self::media_mid(item) {
            Some(media) if media != mid.as_str() => format!("{mid}:{media}"),
            _ => mid,
        };
        Some(Track {
            id,
            provider: "qq".into(),
            title,
            artist,
            album,
            cover_url: Self::cover_url(albummid),
            duration_ms,
            playability: Playability::Full,
        })
    }

    fn split_ids(track_id: &str) -> (&str, &str) {
        if let Some((song, media)) = track_id.split_once(':') {
            if !song.is_empty() && !media.is_empty() {
                return (song, media);
            }
        }
        (track_id, track_id)
    }

    fn make_guid() -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("{}", 1_000_000_000 + (nanos % 8_000_000_000))
    }

    async fn search_raw(
        &self,
        query: &str,
        page: u32,
        pagesize: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        // Prefer classic JSON (`new_json=0`) — stable songmid / payplay / size128 fields.
        let url = format!(
            "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={}&format=json&p={}&n={}&cr=1",
            urlencoding::encode(query),
            page.max(1),
            pagesize.clamp(1, 40)
        );
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Parse(format!("qq search json: {e}")))?;
        let list = json
            .pointer("/data/song/list")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list.iter().filter_map(Self::map_song).collect())
    }

    async fn toplist_raw(
        &self,
        topid: &str,
        begin: u32,
        num: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        let url = format!(
            "https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?tpl=3&page=detail&topid={topid}&type=top&song_begin={begin}&song_num={}&format=json",
            num.clamp(1, 100)
        );
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Parse(format!("qq toplist json: {e}")))?;
        let list = json
            .get("songlist")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list
            .iter()
            .filter_map(|row| row.get("data").and_then(Self::map_song))
            .collect())
    }

    async fn request_vkey(
        &self,
        songmid: &str,
        filename: Option<&str>,
    ) -> Result<(String, String), ProviderError> {
        let guid = Self::make_guid();
        let mut param = json!({
            "guid": guid,
            "songmid": [songmid],
            "songtype": [0],
            "uin": "0",
            "loginflag": 1,
            "platform": "20"
        });
        if let Some(fnm) = filename {
            param["filename"] = json!([fnm]);
        }
        let payload = json!({
            "comm": { "uin": 0, "format": "json", "ct": 24, "cv": 0, "platform": "yqq.json" },
            "req_0": {
                "module": "vkey.GetVkeyServer",
                "method": "CgiGetVkey",
                "param": param
            }
        });
        let resp = self
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header(CONTENT_TYPE, "application/json")
            .body(payload.to_string())
            .send()
            .await?;
        let json: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Parse(format!("qq vkey json: {e}")))?;
        let data = json
            .pointer("/req_0/data")
            .ok_or_else(|| ProviderError::Msg("QQ 未返回播放密钥".into()))?;
        let purl = data
            .pointer("/midurlinfo/0/purl")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let sip = data
            .pointer("/sip/0")
            .and_then(|v| v.as_str())
            .unwrap_or("https://aqqmusic.tc.qq.com/")
            .to_string();
        Ok((purl, sip))
    }

    async fn resolve_play_url(&self, track_id: &str) -> Result<(String, String), ProviderError> {
        let (songmid, media_mid) = Self::split_ids(track_id);
        let mut tried = Vec::new();

        for (prefix, ext) in QUALITIES {
            for mid_part in [media_mid, songmid] {
                let filename = format!("{prefix}{mid_part}{mid_part}.{ext}");
                if tried.iter().any(|t| t == &filename) {
                    continue;
                }
                tried.push(filename.clone());
                let (purl, sip) = self.request_vkey(songmid, Some(&filename)).await?;
                if !purl.is_empty() {
                    let host = if sip.starts_with("https://") {
                        sip
                    } else if let Some(rest) = sip.strip_prefix("http://") {
                        format!("https://{rest}")
                    } else {
                        format!("https://{sip}")
                    };
                    let quality = format!("{prefix}.{ext}");
                    return Ok((format!("{host}{purl}"), quality));
                }
            }
        }

        // Last resort: server-chosen default (often empty for anonymous).
        let (purl, sip) = self.request_vkey(songmid, None).await?;
        if purl.is_empty() {
            return Err(ProviderError::Msg(
                "该曲需 QQ 会员或暂无免费完整播放".into(),
            ));
        }
        let host = if sip.starts_with("https://") {
            sip
        } else if let Some(rest) = sip.strip_prefix("http://") {
            format!("https://{rest}")
        } else {
            format!("https://{sip}")
        };
        Ok((format!("{host}{purl}"), "default".into()))
    }

    async fn download_to_cache(
        &self,
        songmid: &str,
        remote: &str,
        ext: &str,
    ) -> Result<PathBuf, ProviderError> {
        let path = self.cache_dir.join(format!("qq_{songmid}.{ext}"));
        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 200_000 {
                    return Ok(path);
                }
            }
        }
        let resp = self.client.get(remote).send().await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Msg(format!(
                "QQ 下载失败 HTTP {}",
                resp.status()
            )));
        }
        let bytes = resp.bytes().await?;
        if bytes.len() < 100_000 {
            return Err(ProviderError::Msg("QQ 音源过小，已跳过".into()));
        }
        let tmp = path.with_extension(format!("{ext}.part"));
        std::fs::write(&tmp, &bytes).map_err(|e| ProviderError::Msg(e.to_string()))?;
        std::fs::rename(&tmp, &path).map_err(|e| ProviderError::Msg(e.to_string()))?;
        crate::cache::enforce_limit(&self.cache_dir);
        Ok(path)
    }

    async fn fetch_lyrics(
        &self,
        songmid: &str,
    ) -> Result<(Option<String>, Option<String>), ProviderError> {
        let url = format!(
            "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={songmid}&format=json&nobase64=1&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0"
        );
        let resp = self
            .client
            .get(&url)
            .header(REFERER, "https://y.qq.com/portal/player.html")
            .send()
            .await?;
        let json: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Parse(format!("qq lyric json: {e}")))?;
        let code = json.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
        if code != 0 {
            return Err(ProviderError::Msg(format!("QQ 歌词失败 code={code}")));
        }
        let lrc = json
            .get("lyric")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let tlyric = json
            .get("trans")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        if lrc.is_none() && tlyric.is_none() {
            return Err(ProviderError::Msg("QQ 无歌词".into()));
        }
        Ok((lrc, tlyric))
    }
}

#[async_trait]
impl MusicProvider for QqProvider {
    fn id(&self) -> &'static str {
        "qq"
    }

    fn name(&self) -> &'static str {
        "QQ音乐"
    }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        // Over-fetch then keep free-full only (VIP rows are dropped).
        let fetch_n = (limit * 4).max(30).min(40);
        let tracks = self.search_raw(query, 1, fetch_n).await?;
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
        let mut tracks = if chart_id.chars().all(|c| c.is_ascii_digit()) {
            // Pull a wider window — free rows are sparse on some charts (e.g. 热歌榜).
            let want = ((limit + offset) * 4).max(40).min(100);
            self.toplist_raw(chart_id, 0, want)
                .await?
                .into_iter()
                .skip(offset as usize)
                .collect::<Vec<Track>>()
        } else {
            let page_size = limit.max(1);
            let page = (offset / page_size) + 1;
            let skip = (offset % page_size) as usize;
            self.search_raw(chart_id, page, (page_size * 3).min(40))
                .await?
                .into_iter()
                .skip(skip)
                .collect::<Vec<Track>>()
        };
        tracks.truncate(limit as usize);
        Ok(tracks)
    }

    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        let (songmid, _) = Self::split_ids(track_id);
        for ext in ["mp3", "m4a"] {
            let cached = self.cache_dir.join(format!("qq_{songmid}.{ext}"));
            if cached.exists() {
                if let Ok(meta) = std::fs::metadata(&cached) {
                    if meta.len() > 200_000 {
                        return Ok(PlayUrl {
                            url: String::new(),
                            local_path: Some(cached.to_string_lossy().into_owned()),
                            playability: Playability::Full,
                            quality: Some(ext.into()),
                            expires_hint: Some("cached".into()),
                        });
                    }
                }
            }
        }

        let (remote, quality) = self.resolve_play_url(track_id).await?;
        let ext = if quality.contains("mp3") { "mp3" } else { "m4a" };

        let client = self.client.clone();
        let cache_dir = self.cache_dir.clone();
        let tid = songmid.to_string();
        let remote_bg = remote.clone();
        let ext_bg = ext.to_string();
        tauri::async_runtime::spawn(async move {
            let p = QqProvider { client, cache_dir };
            let _ = p.download_to_cache(&tid, &remote_bg, &ext_bg).await;
        });

        Ok(PlayUrl {
            url: remote,
            local_path: None,
            playability: Playability::Full,
            quality: Some(quality),
            expires_hint: Some("stream".into()),
        })
    }

    async fn lyrics(
        &self,
        track_id: &str,
    ) -> Result<(Option<String>, Option<String>), ProviderError> {
        let (songmid, _) = Self::split_ids(track_id);
        self.fetch_lyrics(songmid).await
    }
}
