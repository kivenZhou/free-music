import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { api, providerLabel } from "../api";
import type { Chart, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  providerId: string;
  favoriteKeys: Set<string>;
  currentKey?: string | null;
  onPlay: (track: Track, queue: Track[]) => void;
  onPlayAll: (tracks: Track[]) => void;
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

export function ChartsView({
  providerId,
  favoriteKeys,
  currentKey,
  onPlay,
  onPlayAll,
  onToggleFavorite,
}: Props) {
  const [charts, setCharts] = useState<Chart[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCharts([]);
    setTracks([]);
    setActive(null);
    setError(null);
    let ignore = false;
    api
      .listCharts(providerId)
      .then((list) => {
        if (ignore) return;
        setCharts(list);
        if (list[0]) setActive(list[0].id);
      })
      .catch((e) => {
        if (!ignore) setError(String(e));
      });
    return () => {
      ignore = true;
    };
  }, [providerId]);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setError(null);
    let ignore = false;
    api
      .chartTracks(active, 40, providerId)
      .then((res) => {
        if (!ignore) setTracks(res);
      })
      .catch((e) => {
        if (!ignore) setError(String(e));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [active, providerId]);

  const current = charts.find((c) => c.id === active);

  return (
    <section className="panel">
      <header className="panel-head row">
        <div>
          <p className="eyebrow">Charts · {providerLabel(providerId)}</p>
          <h1>榜单</h1>
          {current ? <p className="panel-desc">{current.description}</p> : null}
        </div>
        {!loading && tracks.length > 0 ? (
          <div className="panel-actions">
            <span className="panel-head-meta">{tracks.length} 首可播</span>
            <button
              type="button"
              className="play-all-btn"
              onClick={() => onPlayAll(tracks)}
            >
              <Play size={14} fill="currentColor" />
              全部播放
            </button>
          </div>
        ) : null}
      </header>

      <div className="chart-tabs">
        {charts.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chart-tab ${active === c.id ? "on" : ""}`}
            onClick={() => setActive(c.id)}
          >
            {c.name}
            <span>{REGION_LABEL[c.region] ?? c.region}</span>
          </button>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty">正在加载可免费完整播放的歌曲…</div> : null}
      {!loading ? (
        <SongList
          tracks={tracks}
          currentKey={currentKey}
          favoriteKeys={favoriteKeys}
          onPlay={onPlay}
          onToggleFavorite={onToggleFavorite}
          hideProvider
        />
      ) : null}
    </section>
  );
}
