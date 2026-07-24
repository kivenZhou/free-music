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
  onToggleFavorite: (track: Track) => void;
}

const REGION_LABEL: Record<string, string> = {
  cn: "国内",
  kr: "韩国",
  jp: "日本",
  us: "欧美",
  bilibili: "B站",
  youtube: "YT",
};

function reqKey(provider: string, chartId: string) {
  return `${provider}::${chartId}`;
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
  onToggleFavorite,
}: Props) {
  const [charts, setCharts] = useState<Chart[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Only the latest in-flight request may commit UI state. */
  const inflightKey = useRef<string | null>(null);
  const providerEpoch = useRef(0);

  const fetchTracksFor = useCallback(async (provider: string, chartId: string) => {
    const key = reqKey(provider, chartId);
    inflightKey.current = key;
    setLoading(true);
    setError(null);
    try {
      const res = await api.chartTracks(chartId, 40, provider);
      if (inflightKey.current !== key) return;
      setTracks(res);
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

  // Remount-safe provider bootstrap
  useEffect(() => {
    const epoch = ++providerEpoch.current;
    const forProvider = providerId;

    setCharts([]);
    setActive(null);
    setTracks([]);
    setError(null);
    setLoading(true);
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
      if (chartId === active && loading) return;
      setActive(chartId);
      setError(null);
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
      // Debounce rapid tab clicks so we don't queue up Bilibili API calls
      debounceRef.current = window.setTimeout(() => {
        void fetchTracksFor(providerId, chartId);
      }, 280);
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
            <span className="panel-head-meta">{tracks.length} 首可播</span>
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

      <div className="chart-tabs">
        {charts.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chart-tab ${active === c.id ? "on" : ""}`}
            onClick={() => selectChart(c.id)}
          >
            {c.name}
            <span>{REGION_LABEL[c.region] ?? c.region}</span>
          </button>
        ))}
      </div>

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
            onToggleFavorite={onToggleFavorite}
            hideProvider
          />
        </div>
      ) : null}
    </section>
  );
}
