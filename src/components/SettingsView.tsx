import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { api, formatBytes, type CacheStats } from "../api";
import type { ProviderInfo } from "../types";
import { checkForAppUpdate, installAppUpdate, type UpdateProgress } from "../updater";

type ToastTone = "ok" | "warn" | "err";

interface Props {
  providers: ProviderInfo[];
  providerId: string;
  onProviderId: (id: string) => void;
  autoSkip: boolean;
  onAutoSkip: (v: boolean) => void;
  active?: boolean;
  onUpdateAvailable?: (update: Update | null) => void;
}

export function SettingsView({
  providers,
  providerId,
  onProviderId,
  autoSkip,
  onAutoSkip,
  active = true,
  onUpdateAvailable,
}: Props) {
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: ToastTone } | null>(
    null,
  );
  const [version, setVersion] = useState<string>("…");
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [found, setFound] = useState<Update | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  const showToast = useCallback((text: string, tone: ToastTone = "ok") => {
    setToast({ text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshCache = useCallback(() => {
    api
      .getCacheStats()
      .then(setCache)
      .catch((e) => showToast(String(e), "err"));
  }, [showToast]);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  useEffect(() => {
    if (!active) return;
    refreshCache();
  }, [active, refreshCache]);

  async function onClearCache() {
    if (clearing) return;
    setClearing(true);
    try {
      const s = await api.clearAudioCache();
      setCache(s);
      showToast("音频缓存已清除", "ok");
    } catch (e) {
      showToast(String(e), "err");
    } finally {
      setClearing(false);
    }
  }

  async function onCheckUpdate() {
    if (checking || installing) return;
    setChecking(true);
    setFound(null);
    try {
      const result = await checkForAppUpdate();
      setFound(result.update);
      onUpdateAvailable?.(result.update);
      const tone: ToastTone =
        result.status === "unavailable"
          ? "err"
          : result.status === "available"
            ? "warn"
            : "ok";
      showToast(result.message, tone);
    } catch (e) {
      showToast(String(e).replace(/^Error:\s*/, ""), "err");
    } finally {
      setChecking(false);
    }
  }

  async function onInstallUpdate() {
    if (!found || installing) return;
    setInstalling(true);
    try {
      showToast("开始下载更新…", "ok");
      await installAppUpdate(found, setProgress);
    } catch (e) {
      showToast(String(e).replace(/^Error:\s*/, ""), "err");
      setInstalling(false);
    }
  }

  const chartProviders = providers.filter((p) => p.id !== "youtube");
  const pct =
    progress && progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <section className="panel settings-panel">
      {toast ? (
        <div className={`app-toast tone-${toast.tone}`} role="status">
          {toast.text}
        </div>
      ) : null}

      <header className="panel-head">
        <p className="eyebrow">Settings</p>
        <h1>设置</h1>
        <p>播放偏好、本地缓存与版本更新</p>
      </header>

      <div className="settings-block">
        <h2>默认音源</h2>
        <p className="settings-desc">榜单页默认使用的音源（可随时在侧栏切换）</p>
        <div className="settings-chips">
          {chartProviders.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${providerId === p.id ? "on" : ""}`}
              onClick={() => onProviderId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-block">
        <h2>播放失败时</h2>
        <p className="settings-desc">无法播放时是否自动跳到下一首（最多连续 3 首）</p>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={autoSkip}
            onChange={(e) => onAutoSkip(e.target.checked)}
          />
          <span>{autoSkip ? "自动跳过" : "停在当前曲并提示"}</span>
        </label>
      </div>

      <div className="settings-block">
        <h2>音频缓存</h2>
        <p className="settings-desc">
          流式开播后会在后台缓存；超过约 2GB 时自动淘汰旧文件
        </p>
        <div className="settings-cache-row">
          <div className="settings-cache-stat">
            {cache ? (
              <>
                <strong>{formatBytes(cache.sizeBytes)}</strong>
                <span>
                  {cache.fileCount} 个文件
                  {cache.path ? ` · ${cache.path}` : ""}
                </span>
              </>
            ) : (
              <span>读取中…</span>
            )}
          </div>
          <button
            type="button"
            className="ghost-btn"
            disabled={clearing}
            onClick={() => void onClearCache()}
          >
            {clearing ? "清理中…" : "清除缓存"}
          </button>
        </div>
      </div>

      <div className="settings-block">
        <h2>软件更新</h2>
        <p className="settings-desc">
          当前版本 <strong>v{version}</strong>
          。有新版本时可在应用内下载并自动替换，完成后重启。
        </p>
        <div className="settings-cache-row">
          <div className="settings-cache-stat">
            {installing ? (
              <span>
                {pct != null
                  ? `下载中 ${pct}%（${formatBytes(progress!.downloaded)}）`
                  : progress
                    ? `下载中 ${formatBytes(progress.downloaded)}…`
                    : "正在准备更新…"}
              </span>
            ) : found ? (
              <span>
                可用版本 <strong>v{found.version}</strong>
              </span>
            ) : (
              <span>发布频道：GitHub Releases</span>
            )}
          </div>
          <div className="settings-update-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={checking || installing}
              onClick={() => void onCheckUpdate()}
            >
              {checking ? "检查中…" : "检查更新"}
            </button>
            {found ? (
              <button
                type="button"
                className="play-all-btn"
                disabled={installing}
                onClick={() => void onInstallUpdate()}
              >
                {installing ? "更新中…" : "立即更新"}
              </button>
            ) : null}
          </div>
        </div>
        {installing && pct != null ? (
          <div className="update-banner-bar settings-update-bar" aria-hidden>
            <i style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>

      <div className="settings-block muted">
        <h2>关于</h2>
        <p className="settings-desc">
          音栈 YinZhan · 仅聚合免费可完整播放的音源
          <br />
          关闭窗口会隐藏到菜单栏托盘；托盘图标可重新打开，右键可退出。
        </p>
      </div>
    </section>
  );
}
