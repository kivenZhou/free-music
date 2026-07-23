import type { Track } from "../types";
import { formatDuration, providerLabel } from "../api";
import { Play, Heart } from "lucide-react";

interface Props {
  tracks: Track[];
  currentKey?: string | null;
  favoriteKeys: Set<string>;
  onPlay: (track: Track, queue: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
}

function keyOf(t: Track) {
  return `${t.provider}:${t.id}`;
}

export function SongList({
  tracks,
  currentKey,
  favoriteKeys,
  onPlay,
  onToggleFavorite,
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
    <ul className="song-list">
      {tracks.map((t, i) => {
        const key = keyOf(t);
        const active = currentKey === key;
        const fav = favoriteKeys.has(key);
        return (
          <li
            key={key}
            className={`song-row ${active ? "active" : ""}`}
            onDoubleClick={() => onPlay(t, tracks)}
          >
            <span className="idx">{String(i + 1).padStart(2, "0")}</span>
            <button
              className="cover-btn"
              onClick={() => onPlay(t, tracks)}
              type="button"
            >
              {t.coverUrl ? (
                <img src={t.coverUrl} alt="" loading="lazy" />
              ) : (
                <span className="cover-fallback" />
              )}
              <span className="cover-play">
                <Play size={20} fill="currentColor" />
              </span>
            </button>
            <div className="meta">
              <div className="title">{t.title}</div>
              <div className="sub">
                <span>{t.artist}</span>
                {t.album ? <span className="dot">·</span> : null}
                {t.album ? <span>{t.album}</span> : null}
              </div>
            </div>
            <span className="src">{providerLabel(t.provider)}</span>
            <span className="dur">{formatDuration(t.durationMs)}</span>
            <button
              className={`icon-btn ${fav ? "on" : ""}`}
              type="button"
              title={fav ? "取消收藏" : "收藏"}
              onClick={() => onToggleFavorite(t)}
            >
              <Heart size={18} fill={fav ? "currentColor" : "none"} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
