use rusty_ytdl::search::{YouTube, SearchOptions, SearchType};

#[tokio::main]
async fn main() {
    let options = SearchOptions {
        limit: 40,
        search_type: SearchType::Video,
        safe_search: false,
    };
    let yt = YouTube::new().unwrap();
    let res = yt.search("华语流行金曲合集".to_string(), Some(&options)).await.unwrap();
    println!("Found: {}", res.len());
}
