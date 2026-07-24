import { useCallback, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { formatBytes } from "../api";
import { installAppUpdate, type UpdateProgress } from "../updater";

interface Props {
  update: Update;
  onDismiss: () => void;
}

export function UpdateBanner({ update, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onInstall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await installAppUpdate(update, setProgress);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
      setBusy(false);
    }
  }, [busy, update]);

  const pct =
    progress && progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-text">
        <strong>发现新版本 {update.version}</strong>
        <span>
          {busy
            ? pct != null
              ? `正在下载 ${pct}%（${formatBytes(progress!.downloaded)}）`
              : progress
                ? `正在下载 ${formatBytes(progress.downloaded)}…`
                : "准备下载…"
            : "点击更新后将自动下载并替换当前应用，完成后重启。"}
        </span>
        {error ? <span className="update-banner-error">{error}</span> : null}
      </div>
      <div className="update-banner-actions">
        {!busy ? (
          <button type="button" className="ghost-btn" onClick={onDismiss}>
            稍后
          </button>
        ) : null}
        <button
          type="button"
          className="play-all-btn"
          disabled={busy}
          onClick={() => void onInstall()}
        >
          {busy ? "更新中…" : "立即更新"}
        </button>
      </div>
      {busy && pct != null ? (
        <div className="update-banner-bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}
