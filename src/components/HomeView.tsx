import { useState, useEffect } from "react";
import { api } from "../api";
import { Track } from "../types";

export function HomeView({ onPlayTrack }: { onPlayTrack: (tracks: Track[], index: number) => void }) {
  const [recommendTracks, setRecommendTracks] = useState<Track[]>([]);

  useEffect(() => {
    // Fetch from bilibili chart as a placeholder for recommendations
    api.chartTracks("bili_hot", 40, "bilibili").then(tracks => {
      setRecommendTracks(tracks);
    }).catch(console.error);
  }, []);

  const handlePlayCollection = (index: number) => {
    onPlayTrack(recommendTracks, index);
  };

  return (
    <div className="home-view">
      <div className="recommend-grids">
        <div className="grid-card red">
          <div className="grid-title">猜你喜欢</div>
          <div className="grid-subtitle">根据你的听歌口味推荐</div>
          <img className="grid-image" src="https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=300&q=80" alt="vinyl" />
        </div>
        <div className="grid-card green">
          <div className="grid-title">每日推荐</div>
          <div className="grid-subtitle">精选 30 首</div>
          <img className="grid-image" src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=300&q=80" alt="music" />
        </div>
        <div className="grid-card dark">
          <div className="grid-title">排行榜</div>
          <div className="grid-subtitle">热门之选，潮流必备</div>
          <img className="grid-image" src="https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=300&q=80" alt="chart" />
        </div>
        <div className="grid-card pink">
          <div className="grid-title">百万收藏</div>
          <div className="grid-subtitle">时下最受喜爱歌曲</div>
          <img className="grid-image" src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=300&q=80" alt="headphones" />
        </div>
        <div className="grid-card blue">
          <div className="grid-title">分类</div>
          <div className="grid-subtitle">精选风格随心听</div>
          <img className="grid-image" src="https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=300&q=80" alt="dj" />
        </div>
      </div>

      <div className="section-title">
        专属推荐
        <span className="section-more">更多 {">"}</span>
      </div>

      <div className="exclusive-grid">
        {recommendTracks.slice(0, 10).map((track, i) => (
          <div key={track.id} className="exclusive-card" onClick={() => handlePlayCollection(i)}>
            <div className="exclusive-cover-wrapper">
              <img src={track.coverUrl!} alt={track.title} className="exclusive-cover" />
              <div className="play-count">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {Math.floor(Math.random() * 1000 + 100)}万
              </div>
            </div>
            <div className="exclusive-title">{track.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}