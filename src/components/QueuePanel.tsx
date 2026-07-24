import type { Track } from "../types";
import { formatDuration, providerLabel } from "../api";
import { ListMusic, X } from "lucide-react";

interface Props {
  open: boolean;
  tracks: Track[];
  currentIndex: number;
  onClose: () => void;
  onSelect: (index: number) => void;
  onClear?: () => void;
}

function keyOf(t: Track) {
  return `${t.provider}:${t.id}`;
}

export function QueuePanel({
  open,
  tracks,
  currentIndex,
  onClose,
  onSelect,
}: Props) {
  if (!open) return null;

  return (
    <div className="queue-panel" role="dialog" aria-label="播放队列">
      <div className="queue-head">
        <div className="queue-title">
          <ListMusic size={16} />
          <span>播放队列</span>
          <span className="queue-count">{tracks.length}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title="关闭">
          <X size={16} />
        </button>
      </div>

      {tracks.length === 0 ? (
        <div className="queue-empty">队列为空，播放歌曲后会出现在这里</div>
      ) : (
        <ul className="queue-list">
          {tracks.map((t, i) => {
            const active = i === currentIndex;
            return (
              <li key={`${keyOf(t)}-${i}`}>
                <button
                  type="button"
                  className={`queue-row ${active ? "active" : ""}`}
                  onClick={() => onSelect(i)}
                >
                  <span className="queue-idx">
                    {active ? "▶" : String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="queue-meta">
                    <span className="queue-song">{t.title}</span>
                    <span className="queue-artist">
                      {t.artist} · {providerLabel(t.provider)}
                    </span>
                  </span>
                  <span className="queue-dur">{formatDuration(t.durationMs)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
