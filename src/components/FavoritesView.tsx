import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { api } from "../api";
import type { FavoriteItem, Track } from "../types";
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
  onToggleFavorite: (track: Track) => void;
  refreshToken: number;
}

export function FavoritesView({
  favoriteKeys,
  currentKey,
  playing,
  onPlay,
  onTogglePlay,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  refreshToken,
}: Props) {
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listFavorites()
      .then(setItems)
      .catch((e) => setError(String(e)));
  }, [refreshToken]);

  const tracks = items.map((i) => i.track);

  return (
    <section className="panel">
      <header className="panel-head row">
        <div>
          <p className="eyebrow">Library</p>
          <h1>收藏</h1>
          <p>本地保存 · {items.length} 首</p>
        </div>
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
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      <SongList
        tracks={tracks}
        currentKey={currentKey}
        playing={playing}
        favoriteKeys={favoriteKeys}
        onPlay={onPlay}
        onTogglePlay={onTogglePlay}
        onPlayNext={onPlayNext}
        onAddToQueue={onAddToQueue}
        onToggleFavorite={onToggleFavorite}
      />
    </section>
  );
}
