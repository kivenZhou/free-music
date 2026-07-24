import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, providerLabel } from "./api";
import { ChartsView } from "./components/ChartsView";
import { FavoritesView } from "./components/FavoritesView";
import { HistoryView } from "./components/HistoryView";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { SearchView } from "./components/SearchView";
import { TrendingUp, Search, Heart, History } from "lucide-react";
import type { NavKey, ProviderInfo, RepeatMode, Track } from "./types";
import "./App.css";

function favKey(t: Track) {
  return `${t.provider}:${t.id}`;
}

function readStoredVolume(): number {
  const raw = localStorage.getItem("yinzhan-volume");
  if (raw == null) return 0.85;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.85;
}

function readStoredRepeat(): RepeatMode {
  const raw = localStorage.getItem("yinzhan-repeat");
  if (raw === "all" || raw === "one" || raw === "off") return raw;
  return "off";
}

function shuffleTracks(list: Track[], preferIndex = 0): Track[] {
  if (list.length <= 1) return [...list];
  const preferred = list[preferIndex] ?? list[0];
  const rest = list.filter((_, i) => i !== preferIndex);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [preferred, ...rest];
}

function App() {
  const [nav, setNav] = useState<NavKey>("charts");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState(
    () => localStorage.getItem("yinzhan-provider") || "netease",
  );
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

  const [shuffle, setShuffle] = useState(
    () => localStorage.getItem("yinzhan-shuffle") === "1",
  );
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(readStoredRepeat);
  const [volume, setVolume] = useState(readStoredVolume);
  const [muted, setMuted] = useState(() => localStorage.getItem("yinzhan-muted") === "1");
  const [queueOpen, setQueueOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>([]);
  const queueIndexRef = useRef(-1);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>("off");
  const playTrackAtRef = useRef<(tracks: Track[], index: number) => void>(() => undefined);
  const advanceRef = useRef<(dir: 1 | -1, opts?: { fromEnded?: boolean }) => void>(
    () => undefined,
  );

  const currentKey = current ? favKey(current) : null;
  const hasPrev = queue.length > 0 && (queueIndex > 0 || repeatMode === "all" || shuffle);
  const hasNext =
    queue.length > 0 &&
    (queueIndex < queue.length - 1 || repeatMode === "all" || repeatMode === "one" || shuffle);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    queueIndexRef.current = queueIndex;
  }, [queueIndex]);

  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  useEffect(() => {
    repeatRef.current = repeatMode;
  }, [repeatMode]);

  const refreshFavorites = useCallback(async () => {
    const list = await api.listFavorites();
    setFavoriteKeys(new Set(list.map((i) => favKey(i.track))));
    setFavToken((n) => n + 1);
  }, []);

  useEffect(() => {
    api.listProviders().then((ps) => {
      setProviders(ps);
      const saved = localStorage.getItem("yinzhan-provider");
      if (saved && ps.some((p) => p.id === saved)) {
        setProviderId(saved);
      } else if (ps[0]) {
        setProviderId(ps[0].id);
      }
    });
    refreshFavorites().catch(() => undefined);
  }, [refreshFavorites]);

  useEffect(() => {
    localStorage.setItem("yinzhan-provider", providerId);
  }, [providerId]);

  useEffect(() => {
    localStorage.setItem("yinzhan-shuffle", shuffle ? "1" : "0");
  }, [shuffle]);

  useEffect(() => {
    localStorage.setItem("yinzhan-repeat", repeatMode);
  }, [repeatMode]);

  const applyVolume = useCallback((vol: number, isMuted: boolean) => {
    const audio = audioRef.current;
    if (audio) audio.volume = isMuted ? 0 : vol;
  }, []);

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
      if (index < tracks.length - 1 || repeatRef.current === "all") {
        window.setTimeout(() => {
          advanceRef.current(1);
        }, 600);
      }
    } finally {
      setLoadingPlay(false);
    }
  }, []);

  useEffect(() => {
    playTrackAtRef.current = playTrackAt;
  }, [playTrackAt]);

  const advance = useCallback(
    (dir: 1 | -1, opts?: { fromEnded?: boolean }) => {
      const q = queueRef.current;
      const i = queueIndexRef.current;
      const mode = repeatRef.current;
      if (q.length === 0 || i < 0) return;

      // Auto-replay current track only when song ends in single-repeat mode
      if (opts?.fromEnded && mode === "one") {
        void playTrackAt(q, i);
        return;
      }

      if (shuffleRef.current && q.length > 1) {
        let next = Math.floor(Math.random() * q.length);
        while (next === i) next = Math.floor(Math.random() * q.length);
        void playTrackAt(q, next);
        return;
      }

      let next = i + dir;
      if (next < 0 || next >= q.length) {
        if (mode === "all") {
          next = (next + q.length) % q.length;
        } else {
          return;
        }
      }
      void playTrackAt(q, next);
    },
    [playTrackAt],
  );

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = muted ? 0 : volume;
    audioRef.current = audio;

    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setPlaying(false);
      advanceRef.current(1, { fromEnded: true });
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onErr = () => {
      setPlaying(false);
      setPlayError("播放失败，尝试下一首…");
      window.setTimeout(() => {
        advanceRef.current(1);
      }, 500);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyVolume(volume, muted);
    localStorage.setItem("yinzhan-volume", String(volume));
    localStorage.setItem("yinzhan-muted", muted ? "1" : "0");
  }, [volume, muted, applyVolume]);

  const playFromList = useCallback(
    (track: Track, list: Track[]) => {
      const index = list.findIndex(
        (t) => t.id === track.id && t.provider === track.provider,
      );
      const start = index >= 0 ? index : 0;
      const ordered = shuffleRef.current ? shuffleTracks(list, start) : list;
      const playIndex = shuffleRef.current ? 0 : start;
      void playTrackAt(ordered, playIndex);
    },
    [playTrackAt],
  );

  const playAll = useCallback(
    (list: Track[]) => {
      if (list.length === 0) return;
      const ordered = shuffleRef.current ? shuffleTracks(list, 0) : list;
      void playTrackAt(ordered, 0);
    },
    [playTrackAt],
  );

  const enqueueNext = useCallback((track: Track) => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (q.length === 0 || i < 0) {
      void playTrackAtRef.current([track], 0);
      return;
    }
    const next = [...q.slice(0, i + 1), track, ...q.slice(i + 1)];
    setQueue(next);
    queueRef.current = next;
  }, []);

  const addToQueue = useCallback((track: Track) => {
    const q = queueRef.current;
    if (q.length === 0 || queueIndexRef.current < 0) {
      void playTrackAtRef.current([track], 0);
      return;
    }
    const next = [...q, track];
    setQueue(next);
    queueRef.current = next;
  }, []);

  const removeFromQueue = useCallback(
    (index: number) => {
      const q = queueRef.current;
      const i = queueIndexRef.current;
      if (index < 0 || index >= q.length) return;

      const next = q.filter((_, idx) => idx !== index);
      if (next.length === 0) {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        setQueue([]);
        setQueueIndex(-1);
        queueRef.current = [];
        queueIndexRef.current = -1;
        setCurrent(null);
        setPlaying(false);
        setProgress(0);
        setDuration(0);
        return;
      }

      if (index === i) {
        const newIndex = Math.min(index, next.length - 1);
        void playTrackAt(next, newIndex);
        return;
      }

      const newIndex = index < i ? i - 1 : i;
      setQueue(next);
      setQueueIndex(newIndex);
      queueRef.current = next;
      queueIndexRef.current = newIndex;
    },
    [playTrackAt],
  );

  const clearQueueKeepCurrent = useCallback(() => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (i < 0 || !q[i]) {
      setQueue([]);
      setQueueIndex(-1);
      queueRef.current = [];
      queueIndexRef.current = -1;
      return;
    }
    const only = [q[i]];
    setQueue(only);
    setQueueIndex(0);
    queueRef.current = only;
    queueIndexRef.current = 0;
  }, []);

  const playPrev = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    advance(-1);
  }, [advance]);

  const playNext = useCallback(() => {
    advance(1);
  }, [advance]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlayError("无法继续播放"));
    } else {
      audio.pause();
    }
  }, [current]);

  const onSeek = useCallback(
    (ratio: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const effectiveDur = current?.durationMs
        ? current.durationMs / 1000
        : audio.duration;
      if (!Number.isFinite(effectiveDur)) return;
      audio.currentTime = effectiveDur * ratio;
      setProgress(audio.currentTime);
    },
    [current],
  );

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

  const toggleShuffle = useCallback(() => {
    setShuffle((on) => {
      const next = !on;
      if (next && queueRef.current.length > 1 && queueIndexRef.current >= 0) {
        const reshuffled = shuffleTracks(queueRef.current, queueIndexRef.current);
        setQueue(reshuffled);
        setQueueIndex(0);
        queueRef.current = reshuffled;
        queueIndexRef.current = 0;
      }
      return next;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"));
  }, []);

  const setVolumeSafe = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolume(clamped);
    if (clamped > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  const goSearch = useCallback((q: string) => {
    setSearchSeed(q);
    setNav("search");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        playPrev();
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        playNext();
        return;
      }
      if (e.code === "ArrowUp") {
        e.preventDefault();
        setVolumeSafe(volume + 0.05);
        return;
      }
      if (e.code === "ArrowDown") {
        e.preventDefault();
        setVolumeSafe(volume - 0.05);
        return;
      }
      if (e.key === "m" || e.key === "M") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, playPrev, playNext, setVolumeSafe, volume, toggleMute]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }

    const artwork = current.coverUrl
      ? [{ src: current.coverUrl, sizes: "300x300", type: "image/jpeg" }]
      : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album ?? providerLabel(current.provider),
      artwork,
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [current, playing]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // unsupported action on this platform
      }
    };

    setHandler("play", () => {
      const audio = audioRef.current;
      if (audio) void audio.play().catch(() => undefined);
    });
    setHandler("pause", () => {
      audioRef.current?.pause();
    });
    setHandler("previoustrack", () => playPrev());
    setHandler("nexttrack", () => playNext());
    setHandler("seekto", (details) => {
      const audio = audioRef.current;
      if (!audio || details.seekTime == null) return;
      audio.currentTime = details.seekTime;
      setProgress(details.seekTime);
    });

    return () => {
      setHandler("play", null);
      setHandler("pause", null);
      setHandler("previoustrack", null);
      setHandler("nexttrack", null);
      setHandler("seekto", null);
    };
  }, [playPrev, playNext]);

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
          <div className="brand-tag">Yinzhan · Free Stream</div>
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
                <Icon size={18} strokeWidth={2} />
                <span className="nav-label">
                  <span className="nav-zh">{item.label}</span>
                  <span className="nav-en">{item.en}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {nav === "charts" ? (
          <div className="source-block">
            <div className="source-label">音源</div>
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
        ) : (
          <div className="source-block" aria-hidden />
        )}

        <div className="sidebar-foot">
          仅免费完整曲目
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
            playing={playing}
            onPlay={playFromList}
            onPlayAll={playAll}
            onPlayNext={enqueueNext}
            onAddToQueue={addToQueue}
            onToggleFavorite={toggleFavorite}
          />
        ) : null}
        {nav === "search" ? (
          <SearchView
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            playing={playing}
            onPlay={playFromList}
            onPlayAll={playAll}
            onPlayNext={enqueueNext}
            onAddToQueue={addToQueue}
            onToggleFavorite={toggleFavorite}
            initialQuery={searchSeed}
          />
        ) : null}
        {nav === "favorites" ? (
          <FavoritesView
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            playing={playing}
            onPlay={playFromList}
            onPlayAll={playAll}
            onPlayNext={enqueueNext}
            onAddToQueue={addToQueue}
            onToggleFavorite={toggleFavorite}
            refreshToken={favToken}
          />
        ) : null}
        {nav === "history" ? <HistoryView onSearch={goSearch} /> : null}
      </main>

      <QueuePanel
        open={queueOpen}
        tracks={queue}
        currentIndex={queueIndex}
        playing={playing}
        onClose={() => setQueueOpen(false)}
        onSelect={(index) => void playTrackAt(queue, index)}
        onRemove={removeFromQueue}
        onClear={clearQueueKeepCurrent}
      />

      <PlayerBar
        track={current}
        playing={playing}
        loading={loadingPlay}
        error={playError}
        progress={progress}
        duration={current?.durationMs ? current.durationMs / 1000 : duration}
        hasPrev={hasPrev}
        hasNext={hasNext}
        favorited={currentKey ? favoriteKeys.has(currentKey) : false}
        shuffle={shuffle}
        repeatMode={repeatMode}
        volume={volume}
        muted={muted}
        queueOpen={queueOpen}
        queueLength={queue.length}
        onToggle={togglePlay}
        onPrev={playPrev}
        onNext={playNext}
        onSeek={onSeek}
        onToggleFavorite={() => {
          if (current) void toggleFavorite(current);
        }}
        onToggleShuffle={toggleShuffle}
        onCycleRepeat={cycleRepeat}
        onVolume={setVolumeSafe}
        onToggleMute={toggleMute}
        onToggleQueue={() => setQueueOpen((o) => !o)}
      />
    </div>
  );
}

export default App;
