import { useEffect, useMemo, useRef } from "react";
import { Mic2, X } from "lucide-react";
import type { Track } from "../types";

export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

interface Props {
  open: boolean;
  track: Track | null;
  progress: number;
  lines: LyricLine[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSeek: (sec: number) => void;
}

/** Parse LRC text into timed lines. */
export function parseLrc(raw: string | null | undefined): LyricLine[] {
  if (!raw?.trim()) return [];
  const out: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const times = [...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d+)?)\]/g)];
    if (times.length === 0) continue;
    const text = line.replace(/\[\d{1,3}:\d{1,2}(?:\.\d+)?\]/g, "").trim();
    if (!text) continue;
    for (const m of times) {
      const sec = Number(m[1]) * 60 + Number(m[2]);
      if (Number.isFinite(sec)) out.push({ time: sec, text });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export function mergeLyrics(
  lrc: string | null | undefined,
  translated: string | null | undefined,
): LyricLine[] {
  const main = parseLrc(lrc);
  const trans = parseLrc(translated);
  if (trans.length === 0) return main;
  return main.map((line) => {
    let best: LyricLine | null = null;
    let bestDiff = Infinity;
    for (const t of trans) {
      const d = Math.abs(t.time - line.time);
      if (d < bestDiff) {
        bestDiff = d;
        best = t;
      }
    }
    return bestDiff <= 0.6 && best
      ? { ...line, translation: best.text }
      : line;
  });
}

function activeIndex(lines: LyricLine[], progress: number): number {
  if (lines.length === 0) return -1;
  let idx = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= progress + 0.05) idx = i;
    else break;
  }
  return idx;
}

export function LyricsPanel({
  open,
  track,
  progress,
  lines,
  loading,
  error,
  onClose,
  onSeek,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const active = useMemo(() => activeIndex(lines, progress), [lines, progress]);

  useEffect(() => {
    if (!open || active < 0) return;
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-lyric-idx="${active}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [active, open]);

  if (!open) return null;

  return (
    <div className="lyrics-panel" role="dialog" aria-label="歌词">
      <div className="lyrics-head">
        <div className="lyrics-title">
          <Mic2 size={16} />
          <span>歌词</span>
          {track ? <span className="lyrics-song">{track.title}</span> : null}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="lyrics-body" ref={listRef}>
        {!track ? (
          <div className="lyrics-empty">先播放一首歌</div>
        ) : loading ? (
          <div className="lyrics-empty">正在加载歌词…</div>
        ) : error ? (
          <div className="lyrics-empty error">{error}</div>
        ) : lines.length === 0 ? (
          <div className="lyrics-empty">暂无歌词</div>
        ) : (
          <ul className="lyrics-list">
            {lines.map((line, i) => (
              <li key={`${line.time}-${i}`}>
                <button
                  type="button"
                  data-lyric-idx={i}
                  className={`lyric-line ${i === active ? "on" : ""} ${i < active ? "past" : ""}`}
                  onClick={() => onSeek(line.time)}
                >
                  <span className="lyric-text">{line.text}</span>
                  {line.translation ? (
                    <span className="lyric-trans">{line.translation}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
