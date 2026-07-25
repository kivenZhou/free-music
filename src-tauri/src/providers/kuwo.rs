use super::{MusicProvider, ProviderError};
use crate::models::{Chart, PlayUrl, Playability, Track};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
use serde_json::Value;
use std::path::PathBuf;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/// Kuwo bang charts are almost all "client-only" stubs now.
/// Use keyword searches that still return free full streams.
const CHARTS: &[(&str, &str, &str, &str)] = &[
    ("流行", "热歌精选", "cn", "免费可播热门（搜索精选）"),
    ("新歌", "新歌精选", "cn", "免费可播新歌"),
    ("粤语经典", "粤语金曲", "hk", "免费可播粤语"),
    ("粤语歌", "粤语流行", "hk", "粤语流行向"),
    ("80年代经典", "80年代", "cn", "八十年代怀旧"),
    ("90年代经典", "90年代", "cn", "九十年代怀旧"),
    ("怀旧金曲", "怀旧金曲", "cn", "经典怀旧精选"),
    ("韩语", "韩国流行", "kr", "免费可播韩流"),
    ("日语", "日本流行", "jp", "免费可播日流"),
    ("轻音乐", "轻音乐", "cn", "免费可播轻音乐"),
    ("抖音", "抖音热歌", "cn", "免费可播抖音向"),
];

/// Known stub clip sizes for "仅在酷我客户端播放".
const STUB_SIZES: &[u64] = &[181521, 185336, 181_000, 186_000];

fn prefer_http(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://") {
        format!("http://{rest}")
    } else {
        url.to_string()
    }
}

fn decode_html(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("\\u0026", "&")
}

fn is_stub_meta(duration: u64, bitrate: u64) -> bool {
    duration > 0 && duration <= 30 && bitrate <= 1
        || duration > 0 && duration <= 15
        || bitrate == 1
}

fn is_stub_bytes(bytes: &[u8]) -> bool {
    let n = bytes.len() as u64;
    if STUB_SIZES.iter().any(|&s| n.abs_diff(s) < 2048) {
        return true;
    }
    // Extremely short "songs" are almost always the notice clip
    n > 0 && n < 220_000
}

pub struct KuwoProvider {
    client: reqwest::Client,
    cache_dir: PathBuf,
}

impl KuwoProvider {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(UA));
        headers.insert(REFERER, HeaderValue::from_static("https://www.kuwo.cn/"));
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(25))
            .build()
            .expect("http client");
        Self { client, cache_dir }
    }

    fn map_search_item(item: &Value) -> Option<Track> {
        let pay = item
            .get("PAY")
            .or_else(|| item.get("pay"))
            .and_then(|v| v.as_str())
            .unwrap_or("0");
        if pay != "0" {
            return None;
        }
        let rid = item
            .get("DC_TARGETID")
            .or_else(|| item.get("MUSICRID"))
            .and_then(|v| v.as_str())
            .map(|s| s.replace("MUSIC_", ""))?;
        if rid.is_empty() {
            return None;
        }
        let title = decode_html(
            item.get("SONGNAME")
                .or_else(|| item.get("NAME"))
                .and_then(|v| v.as_str())
                .unwrap_or("未知歌曲"),
        );
        // Skip obvious clip / preview titles
        if title.contains("片段") || title.contains("试听") {
            return None;
        }
        let artist = decode_html(
            item.get("ARTIST")
                .and_then(|v| v.as_str())
                .unwrap_or("未知艺人"),
        );
        let album = item
            .get("ALBUM")
            .and_then(|v| v.as_str())
            .map(decode_html);
        let cover_url = item
            .get("web_albumpic_short")
            .or_else(|| item.get("web_artistpic_short"))
            .and_then(|v| v.as_str())
            .map(|p| {
                if p.starts_with("http") {
                    prefer_http(p)
                } else {
                    format!("http://img1.kuwo.cn/star/albumcover/{p}")
                }
            });
        let duration_ms = item
            .get("DURATION")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|s| s * 1000);
        Some(Track {
            id: rid,
            provider: "kuwo".into(),
            title,
            artist,
            album,
            cover_url,
            duration_ms,
            playability: Playability::Full,
        })
    }

    /// mobi API — returns JSON with duration/bitrate/url. Stub clips have dur≈11, br=1.
    async fn resolve_remote(
        &self,
        track_id: &str,
    ) -> Result<(String, u64, u64), ProviderError> {
        let sources = [
            "jiakong",
            "kwplayer_ar_1.1.9_oppo_118980_320.apk",
        ];
        for source in sources {
            let url = format!(
                "http://mobi.kuwo.cn/mobi.s?f=web&source={source}&type=convert_url_with_sign&rid={track_id}&br=128kmp3"
            );
            let Ok(resp) = self.client.get(&url).send().await else {
                continue;
            };
            let Ok(json) = resp.json::<Value>().await else {
                continue;
            };
            let data = json.get("data").cloned().unwrap_or(Value::Null);
            let remote = data
                .get("url")
                .and_then(|v| v.as_str())
                .filter(|u| u.starts_with("http"))
                .map(prefer_http);
            let duration = data
                .get("duration")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let bitrate = data
                .get("bitrate")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            if let Some(remote) = remote {
                if is_stub_meta(duration, bitrate) {
                    return Err(ProviderError::Msg(
                        "该曲仅限酷我客户端，已跳过".into(),
                    ));
                }
                if duration > 0 && duration < 45 {
                    // likely clip
                    return Err(ProviderError::Msg("该曲为短片段，已跳过".into()));
                }
                return Ok((remote, duration, bitrate));
            }
        }
        Err(ProviderError::Msg("酷我未返回可播地址".into()))
    }

    async fn download_to_cache(&self, track_id: &str, remote: &str) -> Result<PathBuf, ProviderError> {
        let path = self.cache_dir.join(format!("kuwo_{track_id}.mp3"));
        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                let len = meta.len();
                if len > 300_000 && !STUB_SIZES.iter().any(|&s| len.abs_diff(s) < 2048) {
                    return Ok(path);
                }
                let _ = std::fs::remove_file(&path);
            }
        }
        let resp = self.client.get(remote).send().await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Msg(format!(
                "下载失败 HTTP {}",
                resp.status()
            )));
        }
        let bytes = resp.bytes().await?;
        if is_stub_bytes(&bytes) {
            return Err(ProviderError::Msg(
                "该曲仅限酷我客户端播放（已拦截提示音）".into(),
            ));
        }
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(64)]).to_ascii_lowercase();
        if head.contains("<html") || head.contains("<!doctype") {
            return Err(ProviderError::Msg("音源无效".into()));
        }
        let tmp = path.with_extension("mp3.part");
        std::fs::write(&tmp, &bytes).map_err(|e| ProviderError::Msg(e.to_string()))?;
        std::fs::rename(&tmp, &path).map_err(|e| ProviderError::Msg(e.to_string()))?;
        crate::cache::enforce_limit(&self.cache_dir);
        Ok(path)
    }

    /// Fast stub / HTML check via ranged GET — avoids waiting for a full download.
    async fn probe_streamable(&self, remote: &str) -> Result<(), ProviderError> {
        let resp = self
            .client
            .get(remote)
            .header("Range", "bytes=0-4095")
            .send()
            .await?;
        let status = resp.status().as_u16();
        if status != 200 && status != 206 {
            return Err(ProviderError::Msg(format!("探测失败 HTTP {status}")));
        }
        let total = resp
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit('/').next())
            .and_then(|n| n.parse::<u64>().ok())
            .or_else(|| {
                resp.headers()
                    .get(reqwest::header::CONTENT_LENGTH)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|n| n.parse::<u64>().ok())
            });
        if let Some(t) = total {
            if STUB_SIZES.iter().any(|&s| t.abs_diff(s) < 2048) || t < 220_000 {
                return Err(ProviderError::Msg(
                    "该曲仅限酷我客户端播放（已拦截提示音）".into(),
                ));
            }
        }
        let bytes = resp.bytes().await?;
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(64)]).to_ascii_lowercase();
        if head.contains("<html") || head.contains("<!doctype") {
            return Err(ProviderError::Msg("音源无效".into()));
        }
        Ok(())
    }

    async fn search_raw(
        &self,
        query: &str,
        fetch_n: u32,
        page: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        let url = format!(
            "http://search.kuwo.cn/r.s?all={}&ft=music&itemset=web_2013&client=kt&pn={}&rn={}&rformat=json&encoding=utf8",
            urlencoding::encode(query),
            page,
            fetch_n
        );
        let resp = self.client.get(&url).send().await?;
        let text = resp.text().await?.replace('\'', "\"");
        let json: Value = serde_json::from_str(&text)
            .map_err(|e| ProviderError::Parse(format!("kuwo search json: {e}")))?;
        let list = json
            .get("abslist")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list.iter().filter_map(Self::map_search_item).collect())
    }

    async fn fetch_lyrics(
        &self,
        track_id: &str,
    ) -> Result<(Option<String>, Option<String>), ProviderError> {
        let url = format!(
            "http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId={track_id}"
        );
        let resp = self.client.get(&url).send().await?;
        let json: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Parse(format!("kuwo lyric json: {e}")))?;
        let list = json
            .pointer("/data/lrclist")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if list.is_empty() {
            return Err(ProviderError::Msg("酷我无歌词".into()));
        }
        let mut lines = Vec::with_capacity(list.len());
        for row in list {
            let time_s = row
                .get("time")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<f64>().ok())
                .or_else(|| row.get("time").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);
            let text = row
                .get("lineLyric")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if text.is_empty() || text == "//" {
                continue;
            }
            let total_ms = (time_s * 1000.0).round() as u64;
            let mins = total_ms / 60_000;
            let secs = (total_ms % 60_000) / 1000;
            let ms = total_ms % 1000;
            lines.push(format!("[{mins:02}:{secs:02}.{ms:03}]{text}"));
        }
        if lines.is_empty() {
            return Err(ProviderError::Msg("酷我歌词为空".into()));
        }
        Ok((Some(lines.join("\n")), None))
    }
}

#[async_trait]
impl MusicProvider for KuwoProvider {
    fn id(&self) -> &'static str {
        "kuwo"
    }

    fn name(&self) -> &'static str {
        "酷我音乐"
    }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        let candidates = self.search_raw(query, limit, 0).await?;
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
        // chart_id is a keyword for free searchable music
        // kuwo `pn` is 0-based page index with `rn` page size.
        let page_size = limit.max(1);
        let page = offset / page_size;
        let skip = (offset % page_size) as usize;
        let candidates = self.search_raw(chart_id, page_size, page).await?;
        Ok(candidates
            .into_iter()
            .skip(skip)
            .take(limit as usize)
            .collect())
    }

    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        let (remote, _dur, br) = self.resolve_remote(track_id).await?;
        let path = self.cache_dir.join(format!("kuwo_{track_id}.mp3"));
        if path.exists() {
            if let Ok(meta) = std::fs::metadata(&path) {
                let len = meta.len();
                if len > 300_000 && !STUB_SIZES.iter().any(|&s| len.abs_diff(s) < 2048) {
                    return Ok(PlayUrl {
                        url: remote.clone(),
                        local_path: Some(path.to_string_lossy().into_owned()),
                        playability: Playability::Full,
                        quality: Some(format!("{br}")),
                        expires_hint: Some("cached".into()),
                    });
                }
            }
        }

        self.probe_streamable(&remote).await?;

        let client = self.client.clone();
        let cache_dir = self.cache_dir.clone();
        let tid = track_id.to_string();
        let remote_bg = remote.clone();
        tauri::async_runtime::spawn(async move {
            let p = KuwoProvider { client, cache_dir };
            let _ = p.download_to_cache(&tid, &remote_bg).await;
        });

        Ok(PlayUrl {
            url: remote,
            local_path: None,
            playability: Playability::Full,
            quality: Some(format!("{br}")),
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
