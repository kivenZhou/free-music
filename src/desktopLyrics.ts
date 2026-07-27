import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { LyricLine } from "./components/LyricsPanel";

export const DESKTOP_LYRICS_LABEL = "desktop-lyrics";
export const DESKTOP_LYRICS_STATE_EVENT = "desktop-lyrics-state";
export const DESKTOP_LYRICS_READY_EVENT = "desktop-lyrics-ready";
export const DESKTOP_LYRICS_CLOSED_EVENT = "desktop-lyrics-closed";
/** Floating window asks main UI to restore the in-app lyrics panel. */
export const DESKTOP_LYRICS_DOCK_EVENT = "desktop-lyrics-dock";

export interface DesktopLyricsState {
  title: string;
  artist: string;
  lines: LyricLine[];
  progress: number;
  loading: boolean;
  error: string | null;
  playing: boolean;
}

export async function openDesktopLyricsWindow(): Promise<WebviewWindow> {
  const existing = await WebviewWindow.getByLabel(DESKTOP_LYRICS_LABEL);
  if (existing) {
    await existing.show();
    await existing.setAlwaysOnTop(true);
    await existing.setFocus();
    return existing;
  }

  const url = import.meta.env.DEV
    ? "http://localhost:1420/?view=desktop-lyrics"
    : "index.html?view=desktop-lyrics";

  const win = new WebviewWindow(DESKTOP_LYRICS_LABEL, {
    url,
    title: "桌面歌词",
    width: 860,
    height: 200,
    minWidth: 480,
    minHeight: 120,
    decorations: false,
    transparent: true,
    // Fully clear — otherwise macOS paints an opaque panel behind the webview.
    backgroundColor: [0, 0, 0, 0],
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    focus: false,
    visible: true,
    shadow: false,
  });

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("桌面歌词窗口创建超时")), 8000);
    void win.once("tauri://created", () => {
      window.clearTimeout(t);
      resolve();
    });
    void win.once("tauri://error", (e) => {
      window.clearTimeout(t);
      reject(new Error(String(e.payload ?? "桌面歌词窗口创建失败")));
    });
  });

  try {
    await win.setBackgroundColor([0, 0, 0, 0]);
  } catch {
    // Older runtime may not expose setBackgroundColor.
  }

  return win;
}

export async function closeDesktopLyricsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(DESKTOP_LYRICS_LABEL);
  if (existing) {
    await existing.close();
  }
}

export async function syncDesktopLyricsState(
  state: DesktopLyricsState,
): Promise<void> {
  try {
    await emitTo(DESKTOP_LYRICS_LABEL, DESKTOP_LYRICS_STATE_EVENT, state);
  } catch {
    // Window may have just closed.
  }
}

export function listenDesktopLyricsReady(
  onReady: () => void,
): Promise<UnlistenFn> {
  return listen(DESKTOP_LYRICS_READY_EVENT, () => onReady());
}

export function listenDesktopLyricsClosed(
  onClosed: () => void,
): Promise<UnlistenFn> {
  return listen(DESKTOP_LYRICS_CLOSED_EVENT, () => onClosed());
}

export function listenDesktopLyricsDock(
  onDock: () => void,
): Promise<UnlistenFn> {
  return listen(DESKTOP_LYRICS_DOCK_EVENT, () => onDock());
}

export async function requestDockDesktopLyrics(): Promise<void> {
  await emit(DESKTOP_LYRICS_DOCK_EVENT);
}
