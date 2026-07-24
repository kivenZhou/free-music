import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { SearchHistoryItem, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  favoriteKeys: Set<string>;
  currentKey?: string | null;
  onPlay: (track: Track, queue: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
  initialQuery?: string;
}

export function SearchView({
  favoriteKeys,
  currentKey,
  onPlay,
  onToggleFavorite,
  initialQuery = "",
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const result = await api.searchTracks(text, 30, "all");
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
      <header className="panel-head">
        <p className="eyebrow">Search</p>
        <h1>搜索</h1>
        <p>聚合多音源 · 仅返回免费完整曲</p>
      </header>

      <form className="search-form" onSubmit={onSubmit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="歌名、艺人、关键词"
          autoFocus
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
      {loading ? <div className="empty">正在筛选可免费完整播放的歌曲…</div> : null}
      {!loading ? (
        <SongList
          tracks={tracks}
          currentKey={currentKey}
          favoriteKeys={favoriteKeys}
          onPlay={onPlay}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}
    </section>
  );
}
