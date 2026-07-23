import type { Track } from "../types";
import { providerLabel } from "../api";
import { Play, Pause, SkipBack, SkipForward, Loader2 } from "lucide-react";

interface Props {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  progress: number;
  duration: number;
  hasPrev: boolean;
  hasNext: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (ratio: number) => void;
}

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
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
  onToggle,
  onPrev,
  onNext,
  onSeek,
}: Props) {
  const ratio = duration > 0 ? progress / duration : 0;

  return (
    <footer className="player">
      <div className="player-track">
        {track?.coverUrl ? (
          <img className="player-cover" src={track.coverUrl} alt="" />
        ) : (
          <div className="player-cover placeholder" />
        )}
        <div className="player-meta">
          <div className="player-title">{track?.title ?? "尚未播放"}</div>
          <div className="player-artist">
            {track ? `${track.artist} · ${providerLabel(track.provider)}` : "选一首免费完整曲开始"}
          </div>
        </div>
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
            <SkipBack size={20} />
          </button>
          <button
            className="play-btn"
            type="button"
            disabled={!track || loading}
            onClick={onToggle}
          >
            {loading ? (
              <Loader2 className="animate-spin" size={24} />
            ) : playing ? (
              <Pause size={24} fill="currentColor" />
            ) : (
              <Play size={24} fill="currentColor" style={{ marginLeft: "4px" }} />
            )}
          </button>
          <button
            className="ctrl-btn"
            type="button"
            disabled={!hasNext || loading}
            onClick={onNext}
            title="下一首"
          >
            <SkipForward size={20} />
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
        {error ? <div className="player-error">{error}</div> : null}
      </div>

      <div className="player-source">
        <span className="live-dot" />
        应用内连播
      </div>
    </footer>
  );
}
