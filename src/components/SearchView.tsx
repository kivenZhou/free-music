import { useEffect, useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import { api } from "../api";
import type { SearchHistoryItem, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  favoriteKeys: Set<string>;
  currentKey?: string | null;
  playing?: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onPlayAll: (tracks: Track[]) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  initialQuery?: string;
}

export function SearchView({
  favoriteKeys,
  currentKey,
  playing,
  onPlay,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  initialQuery = "",
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const refreshHistory = () => {
    api.getSearchHistory().then(setHistory).catch(() => undefined);
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      void runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  async function runSearch(q: string) {
    const text = q.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const result = await api.searchTracks(text, 40, "all");
      setTracks(result);
      refreshHistory();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  return (
    <section className="panel">
      <header className="panel-head row">
        <div>
          <p className="eyebrow">Search</p>
          <h1>搜索</h1>
          <p>并行聚合 B站 / 网易云 / 酷狗 / 酷我 · 仅免费完整曲</p>
        </div>
        {!loading && tracks.length > 0 ? (
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

      <form className="search-form" onSubmit={onSubmit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="歌名、艺人、关键词"
        />
        <button type="submit" disabled={loading}>
          {loading ? "筛选中" : "搜索"}
        </button>
      </form>

      {history.length > 0 ? (
        <div className="history-chips">
          {history.slice(0, 8).map((h) => (
            <button
              key={h.id}
              type="button"
              className="chip"
              onClick={() => {
                setQuery(h.query);
                void runSearch(h.query);
              }}
            >
              {h.query}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {loading && tracks.length === 0 ? (
        <div className="empty">正在并行搜索各音源…</div>
      ) : null}
      {searched && !(loading && tracks.length === 0) ? (
        <div className={loading ? "list-dim" : undefined}>
          <SongList
            tracks={tracks}
            currentKey={currentKey}
            playing={playing}
            favoriteKeys={favoriteKeys}
            onPlay={onPlay}
            onPlayNext={onPlayNext}
            onAddToQueue={onAddToQueue}
            onToggleFavorite={onToggleFavorite}
          />
        </div>
      ) : null}
    </section>
  );
}
