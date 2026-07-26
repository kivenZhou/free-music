import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

/** Padding + cover + border + list gap — keep in sync with `.song-row` / `.song-list`. */
const ROW_STRIDE = 70;
const VIRTUAL_THRESHOLD = 48;
const OVERSCAN = 8;

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

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.classList.contains("panel-body")) return node;
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function SongRow({
  track,
  index,
  active,
  playing,
  fav,
  hideProvider,
  onPlay,
  onTogglePlay,
  onToggleFavorite,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onRemoveTrack,
  queue,
}: {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  fav: boolean;
  hideProvider: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onTogglePlay?: () => void;
  onToggleFavorite: (track: Track) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onRemoveTrack?: (track: Track) => void;
  queue: Track[];
}) {
  const coverTitle = active
    ? playing
      ? `暂停 ${track.title}`
      : `继续播放 ${track.title}`
    : `播放 ${track.title}`;

  const playThis = () => {
    if (active && onTogglePlay) {
      onTogglePlay();
      return;
    }
    onPlay(track, queue);
  };

  return (
    <li
      className={`song-row ${active ? "active" : ""} ${active && playing ? "playing" : ""} ${hideProvider ? "no-src" : ""}`}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest(".row-actions, .cover-btn")) return;
        playThis();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          playThis();
        }
      }}
    >
      <span className="idx">
        {active && playing ? (
          <PlayingBars />
        ) : (
          String(index + 1).padStart(2, "0")
        )}
      </span>
      <button
        className="cover-btn"
        onClick={(e) => {
          e.stopPropagation();
          playThis();
        }}
        type="button"
        title={coverTitle}
      >
        <Cover url={track.coverUrl} />
        <span className="cover-play">
          {active && playing ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" />
          )}
        </span>
      </button>
      <div className="meta">
        <div className="title">{track.title}</div>
        <div className="sub">
          {track.artist}
          {track.album ? ` · ${track.album}` : ""}
        </div>
      </div>
      {!hideProvider ? (
        <span className="src">{providerLabel(track.provider)}</span>
      ) : null}
      <span className="dur">{formatDuration(track.durationMs)}</span>
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        {onPlayNext ? (
          <button
            className="icon-btn"
            type="button"
            title="下一首播放"
            onClick={() => onPlayNext(track)}
          >
            <ListEnd size={15} />
          </button>
        ) : null}
        {onAddToQueue ? (
          <button
            className="icon-btn"
            type="button"
            title="加到队列"
            onClick={() => onAddToQueue(track)}
          >
            <ListPlus size={15} />
          </button>
        ) : null}
        {onAddToPlaylist ? (
          <button
            className="icon-btn"
            type="button"
            title="加入歌单"
            onClick={() => onAddToPlaylist(track)}
          >
            <FolderPlus size={15} />
          </button>
        ) : null}
        {onRemoveTrack ? (
          <button
            className="icon-btn"
            type="button"
            title="从歌单移除"
            onClick={() => onRemoveTrack(track)}
          >
            <Trash2 size={15} />
          </button>
        ) : null}
        <button
          className={`icon-btn ${fav ? "on" : ""}`}
          type="button"
          title={fav ? "取消收藏" : "收藏"}
          onClick={() => onToggleFavorite(track)}
        >
          <Heart size={16} fill={fav ? "currentColor" : "none"} />
        </button>
      </div>
    </li>
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
  const rootRef = useRef<HTMLUListElement | null>(null);
  const [windowRange, setWindowRange] = useState({ start: 0, end: 40 });
  const virtual = tracks.length >= VIRTUAL_THRESHOLD;

  useLayoutEffect(() => {
    if (!virtual) {
      setWindowRange({ start: 0, end: tracks.length });
      return;
    }

    const listEl = rootRef.current;
    if (!listEl) return;
    const scrollParent = findScrollParent(listEl.parentElement);
    if (!scrollParent) {
      setWindowRange({ start: 0, end: Math.min(tracks.length, 40) });
      return;
    }

    const update = () => {
      const listTop =
        listEl.getBoundingClientRect().top -
        scrollParent.getBoundingClientRect().top +
        scrollParent.scrollTop;
      const viewTop = scrollParent.scrollTop;
      const viewBottom = viewTop + scrollParent.clientHeight;
      const start = Math.max(
        0,
        Math.floor((viewTop - listTop) / ROW_STRIDE) - OVERSCAN,
      );
      const end = Math.min(
        tracks.length,
        Math.ceil((viewBottom - listTop) / ROW_STRIDE) + OVERSCAN,
      );
      setWindowRange((prev) =>
        prev.start === start && prev.end === end ? prev : { start, end },
      );
    };

    update();
    scrollParent.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scrollParent);
    return () => {
      scrollParent.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [virtual, tracks.length]);

  if (tracks.length === 0) {
    return (
      <div className="empty">
        <strong>没有可免费完整播放的歌曲</strong>
        <span>换个关键词，或切换音源再试</span>
      </div>
    );
  }

  const start = virtual ? windowRange.start : 0;
  const end = virtual ? windowRange.end : tracks.length;
  const topPad = virtual ? start * ROW_STRIDE : 0;
  const bottomPad = virtual ? Math.max(0, (tracks.length - end) * ROW_STRIDE) : 0;

  return (
    <ul
      ref={rootRef}
      className={`song-list ${hideProvider ? "no-src" : ""} ${virtual ? "virtual" : ""}`}
      style={
        virtual
          ? { paddingTop: topPad, paddingBottom: bottomPad }
          : undefined
      }
    >
      {tracks.slice(start, end).map((t, offset) => {
        const i = start + offset;
        const key = keyOf(t);
        return (
          <SongRow
            key={`${key}-${i}`}
            track={t}
            index={i}
            active={currentKey === key}
            playing={playing}
            fav={favoriteKeys.has(key)}
            hideProvider={hideProvider}
            onPlay={onPlay}
            onTogglePlay={onTogglePlay}
            onToggleFavorite={onToggleFavorite}
            onPlayNext={onPlayNext}
            onAddToQueue={onAddToQueue}
            onAddToPlaylist={onAddToPlaylist}
            onRemoveTrack={onRemoveTrack}
            queue={tracks}
          />
        );
      })}
    </ul>
  );
}
