import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { api, providerLabel } from "../api";
import type { Chart, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  providerId: string;
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
}

const PAGE_SIZE = 20;

const REGION_LABEL: Record<string, string> = {
  cn: "国内",
  kr: "韩国",
  jp: "日本",
  us: "欧美",
};

function regionBadge(region: string): string | null {
  return REGION_LABEL[region] ?? null;
}

function reqKey(provider: string, chartId: string) {
  return `${provider}::${chartId}`;
}

function trackKey(t: Track) {
  return `${t.provider}:${t.id}`;
}

export function ChartsView({
  providerId,
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
}: Props) {
  const [charts, setCharts] = useState<Chart[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Only the latest in-flight request may commit UI state. */
  const inflightKey = useRef<string | null>(null);
  const providerEpoch = useRef(0);

  const fetchTracksFor = useCallback(async (provider: string, chartId: string) => {
    const key = reqKey(provider, chartId);
    inflightKey.current = key;
    setLoading(true);
    setLoadingMore(false);
    setHasMore(false);
    setError(null);
    try {
      const res = await api.chartTracks(chartId, PAGE_SIZE, provider, 0);
      if (inflightKey.current !== key) return;
      setTracks(res);
      setHasMore(res.length >= PAGE_SIZE);
    } catch (e) {
      if (inflightKey.current !== key) return;
      // Keep previous list on transient Bilibili failures (rate-limit / decode errors)
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      if (inflightKey.current === key) {
        setLoading(false);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!active || loading || loadingMore || !hasMore) return;
    const provider = providerId;
    const chartId = active;
    const key = reqKey(provider, chartId);
    const offset = tracks.length;
    inflightKey.current = key;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api.chartTracks(chartId, PAGE_SIZE, provider, offset);
      if (inflightKey.current !== key) return;
      if (res.length === 0) {
        setHasMore(false);
        return;
      }
      const seen = new Set(tracks.map(trackKey));
      const fresh = res.filter((t) => !seen.has(trackKey(t)));
      if (fresh.length === 0) {
        setHasMore(false);
        return;
      }
      setTracks((prev) => {
        const keys = new Set(prev.map(trackKey));
        return [...prev, ...fresh.filter((t) => !keys.has(trackKey(t)))];
      });
      setHasMore(res.length >= PAGE_SIZE);
    } catch (e) {
      if (inflightKey.current !== key) return;
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      if (inflightKey.current === key) {
        setLoadingMore(false);
      }
    }
  }, [active, loading, loadingMore, hasMore, providerId, tracks]);

  // Remount-safe provider bootstrap
  useEffect(() => {
    const epoch = ++providerEpoch.current;
    const forProvider = providerId;

    setCharts([]);
    setActive(null);
    setTracks([]);
    setHasMore(false);
    setError(null);
    setLoading(true);
    setLoadingMore(false);
    inflightKey.current = null;

    (async () => {
      try {
        const list = await api.listCharts(forProvider);
        if (epoch !== providerEpoch.current) return;

        setCharts(list);
        const firstId = list[0]?.id ?? null;
        setActive(firstId);

        if (!firstId) {
          setTracks([]);
          setLoading(false);
          return;
        }

        await fetchTracksFor(forProvider, firstId);
      } catch (e) {
        if (epoch !== providerEpoch.current) return;
        setCharts([]);
        setTracks([]);
        setActive(null);
        setHasMore(false);
        setError(String(e).replace(/^Error:\s*/, ""));
        setLoading(false);
      }
    })();

    return () => {
      providerEpoch.current += 1;
      inflightKey.current = null;
    };
  }, [providerId, fetchTracksFor]);

  const debounceRef = useRef<number | null>(null);

  const selectChart = useCallback(
    (chartId: string) => {
      if (chartId === active && !loading) return;
      setActive(chartId);
      setHasMore(false);
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void fetchTracksFor(providerId, chartId);
      }, 180);
    },
    [active, loading, fetchTracksFor, providerId],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const current = charts.find((c) => c.id === active);
  const showList = !loading || tracks.length > 0;

  return (
    <section className="panel">
      <header className="panel-head row">
        <div>
          <p className="eyebrow">Charts · {providerLabel(providerId)}</p>
          <h1>榜单</h1>
          {current ? <p className="panel-desc">{current.description}</p> : null}
        </div>
        <div className="panel-actions">
          {loading ? (
            <span className="panel-head-meta">加载中…</span>
          ) : tracks.length > 0 ? (
            <span className="panel-head-meta">{tracks.length} 首</span>
          ) : null}
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
          {!loading && tracks.length === 0 && active ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void fetchTracksFor(providerId, active)}
            >
              重新加载
            </button>
          ) : null}
        </div>
      </header>

      {charts.length > 0 ? (
        <div className="chart-tabs" role="tablist" aria-label="分类">
          {charts.map((c) => {
            const badge = regionBadge(c.region);
            return (
              <button
                key={c.id}
                type="button"
                className={`chart-tab ${active === c.id ? "on" : ""}`}
                onClick={() => selectChart(c.id)}
              >
                {c.name}
                {badge ? <span>{badge}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {loading && tracks.length === 0 ? (
        <div className="empty">正在加载可免费完整播放的歌曲…</div>
      ) : null}
      {showList && !(loading && tracks.length === 0) ? (
        <div className={loading ? "list-dim" : undefined}>
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
            hideProvider
          />
          {hasMore ? (
            <div className="load-more-wrap">
              <button
                type="button"
                className="ghost-btn load-more-btn"
                disabled={loadingMore || loading}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </button>
            </div>
          ) : tracks.length > 0 && !loading ? (
            <p className="load-more-end">已加载全部</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
