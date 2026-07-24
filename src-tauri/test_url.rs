use rusty_ytdl::{Video, VideoOptions, VideoQuality, VideoSearchOptions};

#[tokio::main]
async fn main() {
    let video_options = VideoOptions {
        quality: VideoQuality::HighestAudio,
        filter: VideoSearchOptions::Audio,
        ..Default::default()
    };
    
    let video = Video::new_with_options("KMb819mqPSk", video_options.clone()).unwrap();
    let info = video.get_info().await.unwrap();
    let format = rusty_ytdl::choose_format(&info.formats, &video_options).unwrap();
    println!("URL: {}", format.url);
}
