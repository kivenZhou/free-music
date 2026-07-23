export function ChannelView() {
  return (
    <div className="channel-view" style={{ display: 'flex', gap: '30px' }}>
      <div className="channel-sidebar" style={{ width: '120px', borderRight: '1px solid var(--border-color)', paddingRight: '20px' }}>
        {['最近', '热门', '下午', 'DJ', '语言', '主题', '场景', '心情', '风格', '人群'].map((c, i) => (
          <div key={c} style={{ 
            padding: '12px 0', 
            fontSize: '15px', 
            color: i === 1 ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontWeight: i === 1 ? 'bold' : 'normal',
            cursor: 'pointer'
          }}>
            {c}
          </div>
        ))}
      </div>
      
      <div className="channel-content" style={{ flex: 1 }}>
        <div className="exclusive-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {[
            { title: "猜你喜欢", desc: "总能猜到你喜欢的", color: "#ff8c72", icon: "♥" },
            { title: "短视频热门歌", desc: "王力宏 - 我们的歌", color: "#8b5cf6", icon: "🎤" },
            { title: "中文经典", desc: "曲婉婷 - 我的歌声里", color: "#ec4899", icon: "🎵" },
            { title: "中文 DJ", desc: "无情画 (DJ版)", color: "#14b8a6", icon: "🎧" },
            { title: "怀旧粤语", desc: "爱的传说", color: "#f59e0b", icon: "📻" },
            { title: "KTV 必点曲", desc: "宝石Gem - 枪火", color: "#ef4444", icon: "🎙" },
            { title: "90后", desc: "该死的温柔", color: "#3b82f6", icon: "📼" },
            { title: "短视频最火 DJ", desc: "等不来花开", color: "#6366f1", icon: "🎛" },
            { title: "老情歌", desc: "吴奇隆 - 烟火", color: "#10b981", icon: "🌹" },
            { title: "网络红歌", desc: "HOYO-MiX", color: "#f43f5e", icon: "🔥" },
          ].map((item, i) => (
            <div key={i} className="exclusive-card">
              <div className="exclusive-cover-wrapper" style={{ background: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '64px', color: 'rgba(255,255,255,0.8)' }}>
                {item.icon}
                <div className="play-count" style={{ background: 'rgba(0,0,0,0.3)' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  {Math.floor(Math.random() * 5000 + 100)}
                </div>
              </div>
              <div className="exclusive-title" style={{ fontSize: '15px' }}>{item.title}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}