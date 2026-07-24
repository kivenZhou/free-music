import { useEffect, useState } from "react";
import type { Track } from "../types";
import { formatDuration, providerLabel } from "../api";
import {
  Play,
  Pause,
  Heart,
  Music2,
  ListPlus,
  ListEnd,
  FolderPlus,
  Trash2,
} from "lucide-react";

interface Props {
  tracks: Track[];
  currentKey?: string | null;
  playing?: boolean;
  favoriteKeys: Set<string>;
  onPlay: (track: Track, queue: Track[]) => void;
  /** Pause / resume when clicking the currently playing row cover. */
  onTogglePlay?: () => void;
  onToggleFavorite: (track: Track) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onRemoveTrack?: (track: Track) => void;
  /** Hide per-row provider badge (e.g. charts already scoped to one source). */
  hideProvider?: boolean;
}

function keyOf(t: Track) {
  return `${t.provider}:${t.id}`;
}

function Cover({ url }: { url?: string | null }) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [url]);

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
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

function PlayingBars() {
  return (
    <span className="eq" aria-label="正在播放">
      <span />
      <span />
      <span />
    </span>
  );
}

export function SongList({
  tracks,
  currentKey,
  playing = false,
  favoriteKeys,
  onPlay,
  onTogglePlay,
  onToggleFavorite,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onRemoveTrack,
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
        const coverTitle = active
          ? playing
            ? `暂停 ${t.title}`
            : `继续播放 ${t.title}`
          : `播放 ${t.title}`;

        const onCoverClick = () => {
          if (active && onTogglePlay) {
            onTogglePlay();
            return;
          }
          onPlay(t, tracks);
        };

        return (
          <li
            key={key}
            className={`song-row ${active ? "active" : ""} ${active && playing ? "playing" : ""} ${hideProvider ? "no-src" : ""}`}
            onClick={(e) => {
              const el = e.target as HTMLElement;
              if (el.closest(".row-actions, .cover-btn")) return;
              onCoverClick();
            }}
          >
            <span className="idx">
              {active && playing ? (
                <PlayingBars />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <button
              className="cover-btn"
              onClick={onCoverClick}
              type="button"
              title={coverTitle}
            >
              <Cover url={t.coverUrl} />
              <span className="cover-play">
                {active && playing ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
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
            <div
              className="row-actions"
              onClick={(e) => e.stopPropagation()}
            >
              {onPlayNext ? (
                <button
                  className="icon-btn"
                  type="button"
                  title="下一首播放"
                  onClick={() => onPlayNext(t)}
                >
                  <ListEnd size={15} />
                </button>
              ) : null}
              {onAddToQueue ? (
                <button
                  className="icon-btn"
                  type="button"
                  title="加到队列"
                  onClick={() => onAddToQueue(t)}
                >
                  <ListPlus size={15} />
                </button>
              ) : null}
              {onAddToPlaylist ? (
                <button
                  className="icon-btn"
                  type="button"
                  title="加入歌单"
                  onClick={() => onAddToPlaylist(t)}
                >
                  <FolderPlus size={15} />
                </button>
              ) : null}
              {onRemoveTrack ? (
                <button
                  className="icon-btn"
                  type="button"
                  title="从歌单移除"
                  onClick={() => onRemoveTrack(t)}
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
              <button
                className={`icon-btn ${fav ? "on" : ""}`}
                type="button"
                title={fav ? "取消收藏" : "收藏"}
                onClick={() => onToggleFavorite(t)}
              >
                <Heart size={16} fill={fav ? "currentColor" : "none"} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
