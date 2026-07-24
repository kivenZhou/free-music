use std::path::PathBuf;
use async_trait::async_trait;
use rusty_ytdl::{Video, VideoOptions, VideoQuality, VideoSearchOptions};
use crate::models::{Chart, Playability, PlayUrl, Track};
use super::{MusicProvider, ProviderError};

pub struct YoutubeProvider;

impl YoutubeProvider {
    pub fn new(cache_dir: PathBuf) -> Self {
        // Reserved for future local cache; streams are remote for now.
        let _ = std::fs::create_dir_all(&cache_dir);
        Self
    }
}

#[async_trait]
impl MusicProvider for YoutubeProvider {
    fn id(&self) -> &'static str { "youtube" }
    fn name(&self) -> &'static str { "YouTube 音乐" }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        // Handle direct URLs
        if query.contains("youtube.com") || query.contains("youtu.be") {
            if let Ok(video) = rusty_ytdl::Video::new(query) {
                if let Ok(info) = video.get_info().await {
                    let d = info.video_details;
                    let duration_ms: u64 = d.length_seconds.parse::<u64>().unwrap_or(0) * 1000;
                    return Ok(vec![Track {
                        id: d.video_id,
                        provider: self.id().to_string(),
                        title: d.title,
                        artist: d.author.map(|a| a.name).unwrap_or_default(),
                        album: None,
                        cover_url: d.thumbnails.first().map(|t| t.url.clone()),
                        duration_ms: Some(duration_ms),
                        playability: Playability::Full,
                    }]);
                }
            }
        }

        let options = rusty_ytdl::search::SearchOptions {
            limit: limit as u64,
            search_type: rusty_ytdl::search::SearchType::Video,
            safe_search: false,
        };
        
        let youtube = rusty_ytdl::search::YouTube::new().map_err(|e| ProviderError::Msg(e.to_string()))?;
        let search_result = youtube.search(query.to_string(), Some(&options)).await.map_err(|e| ProviderError::Msg(e.to_string()))?;
        
        let mut tracks = Vec::new();
        for item in search_result {
            if let rusty_ytdl::search::SearchResult::Video(v) = item {
                let duration_ms = v.duration;
                tracks.push(Track {
                    id: v.id,
                    provider: self.id().to_string(),
                    title: v.title,
                    artist: v.channel.name,
                    album: None,
                    cover_url: v.thumbnails.first().map(|t| t.url.clone()),
                    duration_ms: Some(duration_ms as u64),
                    playability: Playability::Full,
                });
            }
        }
        
        Ok(tracks)
    }

    async fn charts(&self) -> Result<Vec<Chart>, ProviderError> {
        Ok(vec![
            Chart {
                id: "yt_trending".into(),
                name: "YouTube 热门榜".into(),
                region: "Global".into(),
                description: "YouTube Music 热门合集推荐".into(),
            }
        ])
    }

    async fn chart_tracks(
        &self,
        _chart_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Track>, ProviderError> {
        let need = offset.saturating_add(limit);
        let batch = self.search("华语流行金曲合集", need).await?;
        Ok(batch
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .collect())
    }

    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        // Use VideoAudio to get a progressive MP4 (itag=18).
        // DASH audio-only streams (like itag=140) break native HTML5 seeking in the <audio> tag.
        // Progressive streams allow the browser to natively fetch the moov atom and handle Range requests perfectly.
        let video_options = VideoOptions {
            quality: VideoQuality::Lowest, // Lowest video quality is fine since we only play audio
            filter: VideoSearchOptions::VideoAudio,
            ..Default::default()
        };
        
        let video = Video::new_with_options(track_id, video_options.clone()).map_err(|e| ProviderError::Msg(e.to_string()))?;
        let info = video.get_info().await.map_err(|e| ProviderError::Msg(e.to_string()))?;
        
        let format = rusty_ytdl::choose_format(&info.formats, &video_options)
            .map_err(|e| ProviderError::Msg(e.to_string()))?;
            
        Ok(PlayUrl {
            url: format.url.clone(),
            local_path: None,
            playability: Playability::Full,
            quality: Some("Progressive".into()),
            expires_hint: None,
        })
    }
}