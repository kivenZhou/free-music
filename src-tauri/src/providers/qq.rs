use super::{MusicProvider, ProviderError};
use crate::models::{Chart, PlayUrl, Playability, Track};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
use serde_json::{json, Value};
use std::path::PathBuf;

const UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const GUID: &str = "10000";

/// Official 巅峰榜 topids + keyword charts for 粤语 / 怀旧等.
/// Listing filters to likely free-full tracks; play_url re-checks vkey.
const CHARTS: &[(&str, &str, &str, &str)] = &[
    ("27", "新歌榜", "cn", "QQ 巅峰榜·新歌（免费可播）"),
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

    fn looks_full(item: &Value) -> bool {
        let interval = item.get("interval").and_then(|v| v.as_u64()).unwrap_or(0);
        let size128 = item.get("size128").and_then(|v| v.as_u64()).unwrap_or(0);
        // Skip obvious stubs / previews.
        if interval > 0 && interval < 45 {
            return false;
        }
        if size128 > 0 && size128 < 350_000 {
            return false;
        }
        // Prefer explicitly free-to-play; still allow unknown pay flags if size looks full.
        let payplay = item
            .pointer("/pay/payplay")
            .and_then(|v| v.as_u64())
            .or_else(|| item.pointer("/pay/payplay").and_then(|v| v.as_i64()).map(|n| n as u64));
        match payplay {
            Some(0) => true,
            Some(_) => size128 >= 2_000_000 || (interval >= 180 && size128 >= 1_000_000),
            None => size128 >= 500_000 || interval >= 60,
        }
    }

    fn map_song(item: &Value) -> Option<Track> {
        let mid = item.get("songmid")?.as_str()?.to_string();
        if mid.is_empty() || !Self::looks_full(item) {
            return None;
        }
        let title = item
            .get("songname")
            .and_then(|v| v.as_str())
            .unwrap_or("未知歌曲")
            .to_string();
        let artist = item
            .get("singer")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.get("name").and_then(|n| n.as_str()))
                    .collect::<Vec<_>>()
                    .join(" / ")
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "未知艺人".into());
        let album = item
            .get("albumname")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let albummid = item.get("albummid").and_then(|v| v.as_str()).unwrap_or("");
        let duration_ms = item
            .get("interval")
            .and_then(|v| v.as_u64())
            .map(|s| s.saturating_mul(1000));
        Some(Track {
            id: mid,
            provider: "qq".into(),
            title,
            artist,
            album,
            cover_url: Self::cover_url(albummid),
            duration_ms,
            playability: Playability::Full,
        })
    }

    async fn search_raw(
        &self,
        query: &str,
        page: u32,
        pagesize: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        let url = format!(
            "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={}&format=json&p={}&n={}&cr=1&new_json=1",
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

    async fn resolve_play_url(&self, songmid: &str) -> Result<(String, u64), ProviderError> {
        let payload = json!({
            "req_0": {
                "module": "vkey.GetVkeyServer",
                "method": "CgiGetVkey",
                "param": {
                    "guid": GUID,
                    "songmid": [songmid],
                    "songtype": [0],
                    "uin": "0",
                    "loginflag": 1,
                    "platform": "20"
                }
            }
        });
        let url = format!(
            "https://u.y.qq.com/cgi-bin/musicu.fcg?data={}",
            urlencoding::encode(&payload.to_string())
        );
        let resp = self.client.get(&url).send().await?;
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
            .unwrap_or("");
        if purl.is_empty() {
            return Err(ProviderError::Msg("该曲需 QQ 会员，无免费完整播放".into()));
        }
        let sip = data
            .pointer("/sip/0")
            .and_then(|v| v.as_str())
            .unwrap_or("http://ws.stream.qqmusic.qq.com/");
        let remote = format!("{sip}{purl}");
        Ok((remote, 0))
    }

    async fn download_to_cache(&self, songmid: &str, remote: &str) -> Result<PathBuf, ProviderError> {
        let path = self.cache_dir.join(format!("qq_{songmid}.m4a"));
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
        let tmp = path.with_extension("m4a.part");
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
        // Over-fetch then filter to free-full candidates.
        let fetch_n = (limit * 3).max(24).min(40);
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
            // Official toplist — pull a wider window then filter free-full.
            let want = (limit + offset).max(limit).min(100);
            self.toplist_raw(chart_id, 0, want.max(30))
                .await?
                .into_iter()
                .skip(offset as usize)
                .collect::<Vec<Track>>()
        } else {
            let page_size = limit.max(1);
            let page = (offset / page_size) + 1;
            let skip = (offset % page_size) as usize;
            self.search_raw(chart_id, page, (page_size * 2).min(40))
                .await?
                .into_iter()
                .skip(skip)
                .collect::<Vec<Track>>()
        };
        tracks.truncate(limit as usize);
        Ok(tracks)
    }

    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        let cached = self.cache_dir.join(format!("qq_{track_id}.m4a"));
        if cached.exists() {
            if let Ok(meta) = std::fs::metadata(&cached) {
                if meta.len() > 200_000 {
                    return Ok(PlayUrl {
                        url: String::new(),
                        local_path: Some(cached.to_string_lossy().into_owned()),
                        playability: Playability::Full,
                        quality: Some("m4a".into()),
                        expires_hint: Some("cached".into()),
                    });
                }
            }
        }

        let (remote, _) = self.resolve_play_url(track_id).await?;

        let client = self.client.clone();
        let cache_dir = self.cache_dir.clone();
        let tid = track_id.to_string();
        let remote_bg = remote.clone();
        tauri::async_runtime::spawn(async move {
            let p = QqProvider { client, cache_dir };
            let _ = p.download_to_cache(&tid, &remote_bg).await;
        });

        Ok(PlayUrl {
            url: remote,
            local_path: None,
            playability: Playability::Full,
            quality: Some("m4a".into()),
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
