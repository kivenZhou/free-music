import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { api, formatBytes, type CacheStats } from "../api";
import type { ProviderInfo } from "../types";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_LABELS,
  formatHotkeyAccel,
  fromHotkeyDisplay,
  normalizeHotkeyMap,
  toHotkeyDisplay,
  type HotkeyAction,
} from "../hotkeys";
import { checkForAppUpdate, installAppUpdate, type UpdateProgress } from "../updater";

type ToastTone = "ok" | "warn" | "err";

const HOTKEY_ACTIONS: HotkeyAction[] = ["toggle", "next", "prev", "favorite"];

interface Props {
  providers: ProviderInfo[];
  providerId: string;
  onProviderId: (id: string) => void;
  autoSkip: boolean;
  onAutoSkip: (v: boolean) => void;
  voiceEnabled: boolean;
  onVoiceEnabled: (v: boolean) => void;
  voiceStatusText?: string;
  hotkeysEnabled: boolean;
  onHotkeysEnabled: (v: boolean) => void;
  hotkeyMap: Record<HotkeyAction, string>;
  onHotkeyMap: (map: Record<HotkeyAction, string>) => void;
  hotkeyWarning?: string;
  active?: boolean;
  onUpdateAvailable?: (update: Update | null) => void;
}

export function SettingsView({
  providers,
  providerId,
  onProviderId,
  autoSkip,
  onAutoSkip,
  voiceEnabled,
  onVoiceEnabled,
  voiceStatusText,
  hotkeysEnabled,
  onHotkeysEnabled,
  hotkeyMap,
  onHotkeyMap,
  hotkeyWarning,
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
  const [hotkeyDraft, setHotkeyDraft] = useState(() => ({
    toggle: toHotkeyDisplay(hotkeyMap.toggle),
    next: toHotkeyDisplay(hotkeyMap.next),
    prev: toHotkeyDisplay(hotkeyMap.prev),
    favorite: toHotkeyDisplay(hotkeyMap.favorite),
  }));

  useEffect(() => {
    setHotkeyDraft({
      toggle: toHotkeyDisplay(hotkeyMap.toggle),
      next: toHotkeyDisplay(hotkeyMap.next),
      prev: toHotkeyDisplay(hotkeyMap.prev),
      favorite: toHotkeyDisplay(hotkeyMap.favorite),
    });
  }, [hotkeyMap]);

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

  const chartProviders = providers;
  const pct =
    progress && progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <section className="panel">
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

      <div className="panel-body">
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
          <h2>语音助手</h2>
          <p className="settings-desc">
            默认关闭。开启后可说「小栈小栈」唤醒。支持播控、搜歌、歌词、收藏、
            切换音源、粤语/年代等主题歌单、追加歌曲、播放收藏等。
            <br />
            短回复（如「在呢」「收到…」）用系统语音即时播报；较长内容可走在线神经语音。
            macOS 请使用打包后的 YinZhan.app。
          </p>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => onVoiceEnabled(e.target.checked)}
            />
            <span>{voiceEnabled ? "已开启，后台聆听中" : "关闭"}</span>
          </label>
          {voiceEnabled && voiceStatusText ? (
            <p className="settings-voice-status">{voiceStatusText}</p>
          ) : null}
        </div>

        <div className="settings-block">
          <h2>全局快捷键</h2>
          <p className="settings-desc">
            窗口在后台时也可控播放。默认 ⌘/Ctrl + ⌥ + P / ← / → / F。
            可改成其他组合（如 Command/Control+Alt+P）。
          </p>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={hotkeysEnabled}
              onChange={(e) => onHotkeysEnabled(e.target.checked)}
            />
            <span>{hotkeysEnabled ? "已开启" : "关闭"}</span>
          </label>
          {hotkeysEnabled ? (
            <div className="settings-hotkeys">
              {HOTKEY_ACTIONS.map((action) => (
                <label key={action} className="settings-hotkey-row">
                  <span>{HOTKEY_LABELS[action]}</span>
                  <input
                    type="text"
                    spellCheck={false}
                    value={hotkeyDraft[action]}
                    placeholder={toHotkeyDisplay(DEFAULT_HOTKEYS[action])}
                    onChange={(e) =>
                      setHotkeyDraft({ ...hotkeyDraft, [action]: e.target.value })
                    }
                    onBlur={(e) => {
                      const raw =
                        fromHotkeyDisplay(e.target.value) ||
                        DEFAULT_HOTKEYS[action];
                      const mergedDraft = {
                        ...hotkeyDraft,
                        [action]: toHotkeyDisplay(raw),
                      };
                      setHotkeyDraft(mergedDraft);
                      const normalized = normalizeHotkeyMap({
                        ...hotkeyMap,
                        [action]: raw,
                      });
                      if (normalized[action] !== hotkeyMap[action]) {
                        onHotkeyMap(normalized);
                      }
                    }}
                  />
                  <em>
                    {formatHotkeyAccel(
                      hotkeyDraft[action] || DEFAULT_HOTKEYS[action],
                    )}
                  </em>
                </label>
              ))}
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  const defaults = { ...DEFAULT_HOTKEYS };
                  setHotkeyDraft({
                    toggle: toHotkeyDisplay(defaults.toggle),
                    next: toHotkeyDisplay(defaults.next),
                    prev: toHotkeyDisplay(defaults.prev),
                    favorite: toHotkeyDisplay(defaults.favorite),
                  });
                  onHotkeyMap(defaults);
                }}
              >
                恢复默认
              </button>
              {hotkeyWarning ? (
                <p className="settings-voice-status">{hotkeyWarning}</p>
              ) : null}
            </div>
          ) : null}
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
            音栈 YinZhan · 学习与个人使用
            <br />
            仅请求各站已开放的免费完整流；不破解会员、不绕过版权保护，也不托管或分发音源文件。与各音源平台无隶属或授权关系，请遵守平台条款与当地法律。
            <br />
            关闭窗口会隐藏到菜单栏托盘；左键打开窗口，右键可播放/切歌/收藏或退出。
          </p>
        </div>
      </div>
    </section>
  );
}
