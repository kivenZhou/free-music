import { useState } from "react";
import type { Track } from "../types";
import { formatDuration, providerLabel } from "../api";
import { Play, Heart, Music2 } from "lucide-react";

interface Props {
  tracks: Track[];
  currentKey?: string | null;
  favoriteKeys: Set<string>;
  onPlay: (track: Track, queue: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
  /** Hide per-row provider badge (e.g. charts already scoped to one source). */
  hideProvider?: boolean;
}

function keyOf(t: Track) {
  return `${t.provider}:${t.id}`;
}

function Cover({ url }: { url?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <span className="cover-fallback" aria-hidden>
        <Music2 size={18} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export function SongList({
  tracks,
  currentKey,
  favoriteKeys,
  onPlay,
  onToggleFavorite,
  hideProvider = false,
}: Props) {
  if (tracks.length === 0) {
    return (
      <div className="empty">
        <strong>没有可免费完整播放的歌曲</strong>
        <span>换个关键词，或切换音源再试</span>
      </div>
    );
  }

  return (
    <ul className={`song-list ${hideProvider ? "no-src" : ""}`}>
      {tracks.map((t, i) => {
        const key = keyOf(t);
        const active = currentKey === key;
        const fav = favoriteKeys.has(key);
        return (
          <li
            key={key}
            className={`song-row ${active ? "active" : ""} ${hideProvider ? "no-src" : ""}`}
            onDoubleClick={() => onPlay(t, tracks)}
          >
            <span className="idx">{String(i + 1).padStart(2, "0")}</span>
            <button
              className="cover-btn"
              onClick={() => onPlay(t, tracks)}
              type="button"
              title={`播放 ${t.title}`}
            >
              <Cover url={t.coverUrl} />
              <span className="cover-play">
                <Play size={18} fill="currentColor" />
              </span>
            </button>
            <div className="meta">
              <div className="title">{t.title}</div>
              <div className="sub">
                {t.artist}
                {t.album ? ` · ${t.album}` : ""}
              </div>
            </div>
            {!hideProvider ? (
              <span className="src">{providerLabel(t.provider)}</span>
            ) : null}
            <span className="dur">{formatDuration(t.durationMs)}</span>
            <button
              className={`icon-btn ${fav ? "on" : ""}`}
              type="button"
              title={fav ? "取消收藏" : "收藏"}
              onClick={() => onToggleFavorite(t)}
            >
              <Heart size={16} fill={fav ? "currentColor" : "none"} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
