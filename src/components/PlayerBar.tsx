import { useState } from "react";
import type { RepeatMode, Track } from "../types";
import { providerLabel } from "../api";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Loader2,
  Music2,
  Heart,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  ListMusic,
  Mic2,
  PanelBottom,
  Maximize2,
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
  shuffle: boolean;
  repeatMode: RepeatMode;
  volume: number;
  muted: boolean;
  queueOpen: boolean;
  queueLength: number;
  lyricsOpen: boolean;
  mini: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (ratio: number) => void;
  onToggleFavorite: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleQueue: () => void;
  onToggleLyrics: () => void;
  onToggleMini: () => void;
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

function repeatTitle(mode: RepeatMode) {
  if (mode === "one") return "单曲循环";
  if (mode === "all") return "列表循环";
  return "顺序播放";
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
  shuffle,
  repeatMode,
  volume,
  muted,
  queueOpen,
  queueLength,
  lyricsOpen,
  mini,
  onToggle,
  onPrev,
  onNext,
  onSeek,
  onToggleFavorite,
  onToggleShuffle,
  onCycleRepeat,
  onVolume,
  onToggleMute,
  onToggleQueue,
  onToggleLyrics,
  onToggleMini,
}: Props) {
  const ratio = duration > 0 ? progress / duration : 0;
  const shownVolume = muted ? 0 : volume;

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
            className={`ctrl-btn ${shuffle ? "on" : ""}`}
            type="button"
            onClick={onToggleShuffle}
            title={shuffle ? "关闭随机" : "随机播放"}
          >
            <Shuffle size={15} />
          </button>
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
          <button
            className={`ctrl-btn ${repeatMode !== "off" ? "on" : ""}`}
            type="button"
            onClick={onCycleRepeat}
            title={repeatTitle(repeatMode)}
          >
            {repeatMode === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
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
            style={{ ["--seek-pct" as string]: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
            onChange={(e) => onSeek(Number(e.target.value) / 1000)}
          />
          <span>{fmt(duration)}</span>
        </div>
      </div>

      <div className="player-aside">
        {error ? <div className="player-error">{error}</div> : null}

        <div className="volume-wrap">
          <button
            className="ctrl-btn"
            type="button"
            onClick={onToggleMute}
            title={muted || volume === 0 ? "取消静音" : "静音"}
          >
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            className="volume-slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(shownVolume * 100)}
            style={{
              ["--vol-pct" as string]: `${Math.min(100, Math.max(0, shownVolume * 100))}%`,
            }}
            onChange={(e) => onVolume(Number(e.target.value) / 100)}
            title="音量"
          />
        </div>

        <button
          className={`ctrl-btn ${lyricsOpen ? "on" : ""}`}
          type="button"
          disabled={!track}
          onClick={onToggleLyrics}
          title="歌词"
        >
          <Mic2 size={16} />
        </button>

        <button
          className={`ctrl-btn queue-btn ${queueOpen ? "on" : ""}`}
          type="button"
          onClick={onToggleQueue}
          title="播放队列"
        >
          <ListMusic size={16} />
          {queueLength > 0 ? <span className="queue-badge">{queueLength}</span> : null}
        </button>

        <button
          className={`ctrl-btn mini-toggle ${mini ? "on" : ""}`}
          type="button"
          onClick={onToggleMini}
          title={mini ? "还原窗口" : "迷你置顶窗"}
        >
          {mini ? <Maximize2 size={15} /> : <PanelBottom size={15} />}
        </button>
      </div>
    </footer>
  );
}
