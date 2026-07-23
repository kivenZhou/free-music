use std::path::PathBuf;
use async_trait::async_trait;
use rusty_ytdl::{Video, VideoOptions, VideoQuality, VideoSearchOptions};
use crate::models::{Chart, Playability, PlayUrl, Track};
use super::{MusicProvider, ProviderError};

pub struct YoutubeProvider {
    cache_dir: PathBuf,
}

impl YoutubeProvider {
    pub fn new(cache_dir: PathBuf) -> Self {
        if !cache_dir.exists() {
            let _ = std::fs::create_dir_all(&cache_dir);
        }
        Self { cache_dir }
    }
}

#[async_trait]
impl MusicProvider for YoutubeProvider {
    fn id(&self) -> &'static str { "youtube" }
    fn name(&self) -> &'static str { "YouTube 音乐" }

    async fn search(&self, query: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
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

    async fn chart_tracks(&self, _chart_id: &str, limit: u32) -> Result<Vec<Track>, ProviderError> {
        self.search("华语流行金曲合集", limit).await
    }

    async fn play_url(&self, track_id: &str) -> Result<PlayUrl, ProviderError> {
        let video_options = VideoOptions {
            quality: VideoQuality::HighestAudio,
            filter: VideoSearchOptions::Audio,
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
            quality: Some("HighestAudio".into()),
            expires_hint: None,
        })
    }
}