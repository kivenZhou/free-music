import { useEffect, useState } from "react";
import { api } from "../api";
import type { FavoriteItem, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  favoriteKeys: Set<string>;
  currentKey?: string | null;
  onPlay: (track: Track, queue: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
  refreshToken: number;
}

export function FavoritesView({
  favoriteKeys,
  currentKey,
  onPlay,
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

  return (
    <section className="panel">
      <header className="panel-head">
        <p className="eyebrow">Library</p>
        <h1>收藏</h1>
        <p>本地保存 · {items.length} 首</p>
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      <SongList
        tracks={items.map((i) => i.track)}
        currentKey={currentKey}
        favoriteKeys={favoriteKeys}
        onPlay={onPlay}
        onToggleFavorite={onToggleFavorite}
      />
    </section>
  );
}
