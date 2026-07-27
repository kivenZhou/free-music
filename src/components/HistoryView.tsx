import { useEffect, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { api } from "../api";
import type { PlayHistoryItem, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  favoriteKeys: Set<string>;
  currentKey?: string | null;
  playing?: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onTogglePlay?: () => void;
  onPlayAll: (tracks: Track[]) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  refreshToken: number;
  active: boolean;
}

export function HistoryView({
  favoriteKeys,
  currentKey,
  playing,
  onPlay,
  onTogglePlay,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onToggleFavorite,
  refreshToken,
  active,
}: Props) {
  const [items, setItems] = useState<PlayHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    api
      .listPlayHistory(100)
      .then((list) => {
        if (!cancelled) {
          setItems(list);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, active]);

  const tracks = items.map((i) => i.track);

  const clearAll = async () => {
    try {
      await api.clearPlayHistory();
      setItems([]);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="panel">
      <header className="panel-head row">
        <div>
          <p className="eyebrow">Recent</p>
          <h1>最近播放</h1>
          <p>在线听歌记录 · {items.length} 首</p>
        </div>
        <div className="panel-actions">
          {tracks.length > 0 ? (
            <button
              type="button"
              className="play-all-btn"
              onClick={() => onPlayAll(tracks)}
            >
              <Play size={14} fill="currentColor" />
              全部播放
            </button>
          ) : null}
          {tracks.length > 0 ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void clearAll()}
              title="清空最近播放"
            >
              <Trash2 size={14} />
              清空
            </button>
          ) : null}
        </div>
      </header>
      <div className="panel-body">
        {error ? <div className="error-banner">{error}</div> : null}
        {loading && tracks.length === 0 ? (
          <div className="empty">正在加载最近播放…</div>
        ) : tracks.length === 0 ? (
          <div className="empty">
            <strong>还没有听过歌</strong>
            <span>从榜单或搜索点播后会出现在这里</span>
          </div>
        ) : (
          <SongList
            tracks={tracks}
            currentKey={currentKey}
            playing={playing}
            favoriteKeys={favoriteKeys}
            onPlay={onPlay}
            onTogglePlay={onTogglePlay}
            onPlayNext={onPlayNext}
            onAddToQueue={onAddToQueue}
            onAddToPlaylist={onAddToPlaylist}
            onToggleFavorite={onToggleFavorite}
          />
        )}
      </div>
    </section>
  );
}
