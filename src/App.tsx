import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "./api";
import { ChartsView } from "./components/ChartsView";
import { FavoritesView } from "./components/FavoritesView";
import { HistoryView } from "./components/HistoryView";
import { PlayerBar } from "./components/PlayerBar";
import { SearchView } from "./components/SearchView";
import { TrendingUp, Search, Heart, History } from "lucide-react";
import type { NavKey, ProviderInfo, Track } from "./types";
import "./App.css";

function favKey(t: Track) {
  return `${t.provider}:${t.id}`;
}

function App() {
  const [nav, setNav] = useState<NavKey>("charts");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState("netease");
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [favToken, setFavToken] = useState(0);
  const [searchSeed, setSearchSeed] = useState("");

  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>([]);
  const queueIndexRef = useRef(-1);
  const playTrackAtRef = useRef<(tracks: Track[], index: number) => void>(() => undefined);

  const currentKey = current ? favKey(current) : null;
  const hasPrev = queueIndex > 0;
  const hasNext = queueIndex >= 0 && queueIndex < queue.length - 1;

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    queueIndexRef.current = queueIndex;
  }, [queueIndex]);

  const refreshFavorites = useCallback(async () => {
    const list = await api.listFavorites();
    setFavoriteKeys(new Set(list.map((i) => favKey(i.track))));
    setFavToken((n) => n + 1);
  }, []);

  useEffect(() => {
    api.listProviders().then((ps) => {
      setProviders(ps);
      if (ps[0]) setProviderId(ps[0].id);
    });
    refreshFavorites().catch(() => undefined);
  }, [refreshFavorites]);

  const playTrackAt = useCallback(async (tracks: Track[], index: number) => {
    const track = tracks[index];
    const audio = audioRef.current;
    if (!track || !audio) return;

    setQueue(tracks);
    setQueueIndex(index);
    queueRef.current = tracks;
    queueIndexRef.current = index;
    setCurrent(track);
    setLoadingPlay(true);
    setPlayError(null);
    setProgress(0);
    setDuration(0);

    try {
      const resolved = await api.resolvePlayUrl(track);
      if (!resolved.localPath && (track.provider === "kuwo" || track.provider === "kugou")) {
        // Prefer cached for providers with flaky CDN certs; still allow direct if present
      }
      const src = resolved.localPath
        ? convertFileSrc(resolved.localPath)
        : resolved.url;
      if (!src) {
        throw new Error("未获取到可播地址");
      }
      audio.src = src;
      await audio.play();
    } catch (e) {
      setPlaying(false);
      setPlayError(String(e).replace(/^Error:\s*/, ""));
      // Auto-skip to next on failure
      if (index < tracks.length - 1) {
        window.setTimeout(() => {
          void playTrackAtRef.current(tracks, index + 1);
        }, 600);
      }
    } finally {
      setLoadingPlay(false);
    }
  }, []);

  useEffect(() => {
    playTrackAtRef.current = playTrackAt;
  }, [playTrackAt]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setPlaying(false);
      const q = queueRef.current;
      const i = queueIndexRef.current;
      if (i >= 0 && i < q.length - 1) {
        void playTrackAtRef.current(q, i + 1);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onErr = () => {
      setPlaying(false);
      setPlayError("播放失败，尝试下一首…");
      const q = queueRef.current;
      const i = queueIndexRef.current;
      if (i >= 0 && i < q.length - 1) {
        window.setTimeout(() => {
          void playTrackAtRef.current(q, i + 1);
        }, 500);
      }
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onErr);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onErr);
      audioRef.current = null;
    };
  }, []);

  const playFromList = useCallback(
    (track: Track, list: Track[]) => {
      const index = list.findIndex(
        (t) => t.id === track.id && t.provider === track.provider,
      );
      void playTrackAt(list, index >= 0 ? index : 0);
    },
    [playTrackAt],
  );

  const playPrev = useCallback(() => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (i > 0) void playTrackAt(q, i - 1);
  }, [playTrackAt]);

  const playNext = useCallback(() => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (i >= 0 && i < q.length - 1) void playTrackAt(q, i + 1);
  }, [playTrackAt]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlayError("无法继续播放"));
    } else {
      audio.pause();
    }
  }, [current]);

  const onSeek = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = audio.duration * ratio;
    setProgress(audio.currentTime);
  }, []);

  const toggleFavorite = useCallback(
    async (track: Track) => {
      const key = favKey(track);
      if (favoriteKeys.has(key)) {
        await api.removeFavorite(track.provider, track.id);
      } else {
        await api.addFavorite(track);
      }
      await refreshFavorites();
    },
    [favoriteKeys, refreshFavorites],
  );

  const goSearch = useCallback((q: string) => {
    setSearchSeed(q);
    setNav("search");
  }, []);

  const navItems = useMemo(
    () =>
      [
        { key: "charts" as const, label: "榜单", en: "Charts", icon: TrendingUp },
        { key: "search" as const, label: "搜索", en: "Search", icon: Search },
        { key: "favorites" as const, label: "收藏", en: "Saved", icon: Heart },
        { key: "history" as const, label: "历史", en: "History", icon: History },
      ] as const,
    [],
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">音栈</div>
          <div className="brand-tag">YINZHAN / FREE STREAM</div>
        </div>

        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={`nav-item ${nav === item.key ? "on" : ""}`}
                onClick={() => setNav(item.key)}
              >
                <Icon size={20} style={{ opacity: 0.8 }} />
                <span className="nav-en">{item.en}</span>
                <span className="nav-zh">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="source-block">
          <div className="source-label">榜单音源</div>
          <div className="source-list">
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`source-btn ${providerId === p.id ? "on" : ""}`}
                onClick={() => setProviderId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-foot">
          仅免费完整曲目 · 播完自动下一首
          {queue.length > 0 ? (
            <>
              <br />
              队列 {Math.max(queueIndex + 1, 0)} / {queue.length}
            </>
          ) : null}
        </div>
      </aside>

      <main className="main">
        {nav === "charts" ? (
          <ChartsView
            providerId={providerId}
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            onPlay={playFromList}
            onToggleFavorite={toggleFavorite}
          />
        ) : null}
        {nav === "search" ? (
          <SearchView
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            onPlay={playFromList}
            onToggleFavorite={toggleFavorite}
            initialQuery={searchSeed}
          />
        ) : null}
        {nav === "favorites" ? (
          <FavoritesView
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            onPlay={playFromList}
            onToggleFavorite={toggleFavorite}
            refreshToken={favToken}
          />
        ) : null}
        {nav === "history" ? <HistoryView onSearch={goSearch} /> : null}
      </main>

      <PlayerBar
        track={current}
        playing={playing}
        loading={loadingPlay}
        error={playError}
        progress={progress}
        duration={duration}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onToggle={togglePlay}
        onPrev={playPrev}
        onNext={playNext}
        onSeek={onSeek}
      />
    </div>
  );
}

export default App;
