import { useState } from "react";
import type { Track } from "../types";
import { providerLabel } from "../api";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Loader2,
  Music2,
  Heart,
} from "lucide-react";

interface Props {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  progress: number;
  duration: number;
  hasPrev: boolean;
  hasNext: boolean;
  favorited: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (ratio: number) => void;
  onToggleFavorite: () => void;
}

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function PlayerCover({ url }: { url?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="player-cover placeholder">
        <Music2 size={18} strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <img
      className="player-cover"
      src={url}
      alt=""
      onError={() => setBroken(true)}
    />
  );
}

export function PlayerBar({
  track,
  playing,
  loading,
  error,
  progress,
  duration,
  hasPrev,
  hasNext,
  favorited,
  onToggle,
  onPrev,
  onNext,
  onSeek,
  onToggleFavorite,
}: Props) {
  const ratio = duration > 0 ? progress / duration : 0;

  return (
    <footer className="player">
      <div className="player-track">
        <PlayerCover url={track?.coverUrl} />
        <div className="player-meta">
          <div className="player-title">{track?.title ?? "尚未播放"}</div>
          <div className="player-artist">
            {track
              ? `${track.artist} · ${providerLabel(track.provider)}`
              : "选一首免费完整曲开始"}
          </div>
        </div>
        <button
          className={`icon-btn player-fav ${favorited ? "on" : ""}`}
          type="button"
          disabled={!track}
          title={favorited ? "取消收藏" : "收藏"}
          onClick={onToggleFavorite}
        >
          <Heart size={16} fill={favorited ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="player-controls">
        <div className="transport">
          <button
            className="ctrl-btn"
            type="button"
            disabled={!hasPrev || loading}
            onClick={onPrev}
            title="上一首"
          >
            <SkipBack size={18} />
          </button>
          <button
            className="play-btn"
            type="button"
            disabled={!track || loading}
            onClick={onToggle}
            title={playing ? "暂停" : "播放"}
          >
            {loading ? (
              <Loader2 className="animate-spin" size={18} />
            ) : playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" style={{ marginLeft: "2px" }} />
            )}
          </button>
          <button
            className="ctrl-btn"
            type="button"
            disabled={!hasNext || loading}
            onClick={onNext}
            title="下一首"
          >
            <SkipForward size={18} />
          </button>
        </div>

        <div className="seek">
          <span>{fmt(progress)}</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(ratio * 1000)}
            disabled={!track}
            onChange={(e) => onSeek(Number(e.target.value) / 1000)}
          />
          <span>{fmt(duration)}</span>
        </div>
      </div>

      <div className="player-aside">
        {error ? <div className="player-error">{error}</div> : null}
        <div className="player-source">
          <span className="live-dot" />
          连播
        </div>
      </div>
    </footer>
  );
}
