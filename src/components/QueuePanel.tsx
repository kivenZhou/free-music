import type { Track } from "../types";
import { formatDuration, providerLabel } from "../api";
import { ListMusic, Trash2, X } from "lucide-react";

interface Props {
  open: boolean;
  tracks: Track[];
  currentIndex: number;
  playing?: boolean;
  onClose: () => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}

function keyOf(t: Track) {
  return `${t.provider}:${t.id}`;
}

export function QueuePanel({
  open,
  tracks,
  currentIndex,
  playing = false,
  onClose,
  onSelect,
  onRemove,
  onClear,
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
        <div className="queue-head-actions">
          {tracks.length > 0 ? (
            <button
              type="button"
              className="ghost-btn queue-clear"
              onClick={onClear}
              title="清空队列（保留当前）"
            >
              <Trash2 size={13} />
              清空
            </button>
          ) : null}
          <button type="button" className="icon-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="queue-empty">队列为空，播放歌曲后会出现在这里</div>
      ) : (
        <ul className="queue-list">
          {tracks.map((t, i) => {
            const active = i === currentIndex;
            return (
              <li key={`${keyOf(t)}-${i}`}>
                <div className={`queue-row ${active ? "active" : ""}`}>
                  <button
                    type="button"
                    className="queue-main"
                    onClick={() => onSelect(i)}
                  >
                    <span className="queue-idx">
                      {active && playing ? (
                        <span className="eq compact" aria-label="正在播放">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : active ? (
                        "▶"
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <span className="queue-meta">
                      <span className="queue-song">{t.title}</span>
                      <span className="queue-artist">
                        {t.artist} · {providerLabel(t.provider)}
                      </span>
                    </span>
                    <span className="queue-dur">{formatDuration(t.durationMs)}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn queue-remove"
                    title="从队列移除"
                    onClick={() => onRemove(i)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
