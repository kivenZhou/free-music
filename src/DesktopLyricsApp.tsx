import { useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Lock, LockOpen, PanelBottom, X } from "lucide-react";
import {
  DESKTOP_LYRICS_CLOSED_EVENT,
  DESKTOP_LYRICS_READY_EVENT,
  DESKTOP_LYRICS_STATE_EVENT,
  requestDockDesktopLyrics,
  type DesktopLyricsState,
} from "./desktopLyrics";
import { activeLyricIndex, type LyricLine } from "./components/LyricsPanel";
import "./DesktopLyrics.css";

type DragProps = { "data-tauri-drag-region"?: boolean };

const EMPTY: DesktopLyricsState = {
  title: "",
  artist: "",
  lines: [],
  progress: 0,
  loading: false,
  error: null,
  playing: false,
};

function nearbyLines(lines: LyricLine[], active: number) {
  if (active < 0 || lines.length === 0) {
    return {
      prev: null as LyricLine | null,
      current: null as LyricLine | null,
      next: null as LyricLine | null,
    };
  }
  return {
    prev: active > 0 ? lines[active - 1] ?? null : null,
    current: lines[active] ?? null,
    next: active + 1 < lines.length ? lines[active + 1] ?? null : null,
  };
}

export default function DesktopLyricsApp() {
  const [state, setState] = useState<DesktopLyricsState>(EMPTY);
  const [locked, setLocked] = useState(false);
  const [hover, setHover] = useState(false);

  const active = useMemo(
    () => activeLyricIndex(state.lines, state.progress),
    [state.lines, state.progress],
  );
  const { prev, current, next } = useMemo(
    () => nearbyLines(state.lines, active),
    [state.lines, active],
  );

  useEffect(() => {
    document.documentElement.classList.add("desktop-lyrics-root", "desktop-lyrics-boot");
    document.body.classList.add("desktop-lyrics-root");
    return () => {
      document.documentElement.classList.remove(
        "desktop-lyrics-root",
        "desktop-lyrics-boot",
      );
      document.body.classList.remove("desktop-lyrics-root");
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<DesktopLyricsState>(DESKTOP_LYRICS_STATE_EVENT, (event) => {
      setState(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    void emit(DESKTOP_LYRICS_READY_EVENT);
    return () => {
      unlisten?.();
      void emit(DESKTOP_LYRICS_CLOSED_EVENT);
    };
  }, []);

  async function onClose() {
    await getCurrentWindow().close();
  }

  async function onDock() {
    try {
      await requestDockDesktopLyrics();
    } catch {
      // Main may already be gone.
    }
    await getCurrentWindow().close();
  }

  const meta = [state.title, state.artist].filter(Boolean).join(" · ");
  const drag: DragProps = locked ? {} : { "data-tauri-drag-region": true };
  const lineKey = `${active}:${current?.text ?? ""}`;

  return (
    <div
      className={`dl-shell ${hover || !current || locked ? "show-chrome" : ""} ${locked ? "locked" : ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...drag}
    >
      <div className="dl-chrome" {...drag}>
        <span className="dl-meta" {...drag}>
          {meta || "桌面歌词"}
        </span>
        <div className="dl-actions">
          <button
            type="button"
            className="dl-btn"
            title={locked ? "解锁（可拖动）" : "锁定位置"}
            onClick={() => setLocked((v) => !v)}
          >
            {locked ? <Lock size={14} /> : <LockOpen size={14} />}
          </button>
          <button
            type="button"
            className="dl-btn"
            title="收起回歌词面板"
            onClick={() => void onDock()}
          >
            <PanelBottom size={14} />
          </button>
          <button
            type="button"
            className="dl-btn"
            title="关闭桌面歌词"
            onClick={() => void onClose()}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="dl-stage" {...drag}>
        <div className="dl-body" {...drag}>
          {state.loading ? (
            <p className="dl-line current dim">正在加载歌词…</p>
          ) : state.error ? (
            <p className="dl-line current dim">{state.error}</p>
          ) : !state.title && state.lines.length === 0 ? (
            <p className="dl-line current dim">播放歌曲后显示歌词</p>
          ) : state.lines.length === 0 ? (
            <p className="dl-line current dim">暂无歌词</p>
          ) : (
            <>
              <p className="dl-line prev" {...drag}>
                {prev?.text || "\u00a0"}
              </p>
              <p
                key={lineKey}
                className={`dl-line current ${state.playing ? "playing" : ""}`}
                {...drag}
              >
                <span className="dl-current-text">{current?.text || "\u00a0"}</span>
                {current?.translation ? (
                  <span className="dl-trans">{current.translation}</span>
                ) : null}
              </p>
              <p className="dl-line next" {...drag}>
                {next?.text || "\u00a0"}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
