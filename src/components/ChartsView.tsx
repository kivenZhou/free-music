import { useEffect, useState } from "react";
import { api } from "../api";
import type { Chart, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  providerId: string;
  favoriteKeys: Set<string>;
  currentKey?: string | null;
  onPlay: (track: Track, queue: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
}

const REGION_LABEL: Record<string, string> = {
  cn: "国内",
  kr: "韩国",
  jp: "日本",
};

export function ChartsView({
  providerId,
  favoriteKeys,
  currentKey,
  onPlay,
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
    api
      .listCharts(providerId)
      .then((list) => {
        setCharts(list);
        if (list[0]) setActive(list[0].id);
      })
      .catch((e) => setError(String(e)));
  }, [providerId]);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setError(null);
    api
      .chartTracks(active, 40, providerId)
      .then(setTracks)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [active, providerId]);

  const current = charts.find((c) => c.id === active);

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Charts</p>
          <h1>榜单</h1>
          <p>酷我热榜多为客户端专享，已改为免费可播精选</p>
        </div>
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

      {current ? <p className="panel-desc">{current.description}</p> : null}
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
