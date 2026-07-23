export function PlaylistView() {
  return (
    <div className="playlist-view">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'center' }}>
        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>全部分类 {">"}</div>
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>推荐 <span style={{ margin: '0 8px' }}>|</span> 上新</div>
      </div>
      
      <div className="exclusive-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {[
          { title: "2026车载必备动感DJ | 动感热歌", img: "https://images.unsplash.com/photo-1548681528-6a5c45b66b42?auto=format&fit=crop&w=300&q=80", count: "4.7亿" },
          { title: "2026伤感情歌大全：爱情，他不讲道理", img: "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?auto=format&fit=crop&w=300&q=80", count: "1.3亿" },
          { title: "500首抖音DJ车载：全网最火热门", img: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=300&q=80", count: "4057万" },
          { title: "8090回忆杀 | 回不去的叫青春", img: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=300&q=80", count: "1.0亿" },
          { title: "放学路上耳机里的轻快电子", img: "https://images.unsplash.com/photo-1516280440502-6c2e8c68eb5b?auto=format&fit=crop&w=300&q=80", count: "853.3万" },
          { title: "90后经典 | 永不褪色的青春年华", img: "https://images.unsplash.com/photo-1493225457124-a1a2a5f5f922?auto=format&fit=crop&w=300&q=80", count: "7867万" },
          { title: "轻音私藏：让你回味长久的钢琴曲", img: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=300&q=80", count: "617.2万" },
          { title: "经典老歌故事汇，满满的回忆杀", img: "https://images.unsplash.com/photo-1485579149621-3123dd979885?auto=format&fit=crop&w=300&q=80", count: "4036万" },
        ].map((item, i) => (
          <div key={i} className="exclusive-card">
            <div className="exclusive-cover-wrapper" style={{ borderRadius: '12px' }}>
              <img src={item.img} alt={item.title} className="exclusive-cover" />
              <div className="play-count">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {item.count}
              </div>
            </div>
            <div className="exclusive-title">{item.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}