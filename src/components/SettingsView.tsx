import { useCallback, useEffect, useState } from "react";
import { api, formatBytes, type CacheStats } from "../api";
import type { ProviderInfo } from "../types";

interface Props {
  providers: ProviderInfo[];
  providerId: string;
  onProviderId: (id: string) => void;
  autoSkip: boolean;
  onAutoSkip: (v: boolean) => void;
  active?: boolean;
}

export function SettingsView({
  providers,
  providerId,
  onProviderId,
  autoSkip,
  onAutoSkip,
  active = true,
}: Props) {
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshCache = useCallback(() => {
    api
      .getCacheStats()
      .then(setCache)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!active) return;
    setError(null);
    refreshCache();
  }, [active, refreshCache]);

  async function onClearCache() {
    if (clearing) return;
    setClearing(true);
    setMessage(null);
    setError(null);
    try {
      const s = await api.clearAudioCache();
      setCache(s);
      setMessage("音频缓存已清除");
    } catch (e) {
      setError(String(e));
    } finally {
      setClearing(false);
    }
  }

  const chartProviders = providers.filter((p) => p.id !== "youtube");

  return (
    <section className="panel settings-panel">
      <header className="panel-head">
        <p className="eyebrow">Settings</p>
        <h1>设置</h1>
        <p>播放偏好与本地缓存</p>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {message ? <div className="settings-toast">{message}</div> : null}

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
