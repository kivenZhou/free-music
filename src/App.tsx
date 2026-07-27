import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, providerLabel } from "./api";
import {
  formatHotkeyAccel,
  readHotkeyMap,
  readHotkeysEnabled,
  registerHotkeys,
  unregisterAllHotkeys,
  writeHotkeyMap,
  writeHotkeysEnabled,
  type HotkeyAction,
} from "./hotkeys";
import { BrandMark } from "./components/BrandMark";
import { ChartsView } from "./components/ChartsView";
import { FavoritesView } from "./components/FavoritesView";
import { HistoryView } from "./components/HistoryView";
import { LyricsPanel, mergeLyrics, type LyricLine } from "./components/LyricsPanel";
import { PlayerBar } from "./components/PlayerBar";
import { PlaylistPicker } from "./components/PlaylistPicker";
import { PlaylistsView } from "./components/PlaylistsView";
import { QueuePanel } from "./components/QueuePanel";
import { SearchView } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { UpdateBanner } from "./components/UpdateBanner";
import {
  TrendingUp,
  Search,
  Heart,
  Settings,
  ListMusic,
  GripVertical,
  History,
} from "lucide-react";
import { useMediaSession } from "./useMediaSession";
import { usePlayer } from "./usePlayer";
import {
  readDisabledProviders,
  readProviderHealth,
  toggleProviderDisabled,
  type ProviderHealthEntry,
} from "./providerHealth";
import type { Update } from "@tauri-apps/plugin-updater";
import type { FavoriteItem, NavKey, ProviderInfo, ThemeMode, Track } from "./types";
import { checkForInstallableUpdate } from "./updater";
import {
  readVoiceEnabled,
  VoiceAssistant,
  VOICE_LISTEN_HINT,
  writeVoiceEnabled,
  type VoiceUiStatus,
} from "./voice";
import {
  QUEUE_STRONG_SCORE,
  favKey,
  findBestMatchingTrack,
  findFavoriteTrack,
  isSameSong,
  uniqueTracks,
} from "./trackMatch";
import {
  MINI_SIZE,
  NORMAL_MIN,
  PROVIDER_ORDER_KEY,
  formatStreamQuality,
  loadProviderOrder,
  sortProvidersByOrder,
} from "./playerUtils";
import {
  applyDocumentTheme,
  readStoredTheme,
  syncWindowTheme,
  writeStoredTheme,
} from "./theme";
import {
  listenDesktopLyricsClosed,
  listenDesktopLyricsDock,
  listenDesktopLyricsReady,
  openDesktopLyricsWindow,
  syncDesktopLyricsState,
} from "./desktopLyrics";

import "./App.css";

function App() {
  const [nav, setNav] = useState<NavKey>("charts");
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState(
    () => localStorage.getItem("yinzhan-provider") || "netease",
  );
  const [disabledProviders, setDisabledProviders] = useState(readDisabledProviders);
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealthEntry>>(
    readProviderHealth,
  );
  const [healthVersion, setHealthVersion] = useState(0);
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [favToken, setFavToken] = useState(0);
  const favoritesRef = useRef<FavoriteItem[]>([]);
  const [playlistToken, setPlaylistToken] = useState(0);
  const [historyToken, setHistoryToken] = useState(0);
  const [playlistPickTrack, setPlaylistPickTrack] = useState<Track | null>(null);

  const refreshProviderHealth = useCallback(() => {
    setProviderHealth(readProviderHealth());
    setHealthVersion((n) => n + 1);
  }, []);

  const player = usePlayer({
    onTrackStarted: () => setHistoryToken((n) => n + 1),
    onHealthChange: refreshProviderHealth,
  });
  const {
    queue,
    queueIndex,
    current,
    playing,
    loadingPlay,
    playError,
    setPlayError,
    progress,
    duration,
    setProgress,
    shuffle,
    repeatMode,
    volume,
    muted,
    autoSkip,
    audioQuality,
    streamQuality,
    currentKey,
    hasPrev,
    hasNext,
    audioRef,
    queueRef,
    queueIndexRef,
    playTrackAtRef,
    ignoreEndedUntilRef,
    playTrackAt,
    playFromList,
    playAll,
    enqueueNext,
    addToQueue,
    removeFromQueue,
    clearQueueKeepCurrent,
    playPrev,
    playPrevTrack,
    playNext,
    togglePlay,
    onSeek,
    seekToSeconds,
    toggleShuffle,
    cycleRepeat,
    setVolume: setVolumeSafe,
    setVolumeLevel,
    setMuted,
    toggleMute,
    setAutoSkip,
    setAudioQuality,
    setQueue,
    onVoiceMusicDuck,
    onVoiceMusicHold,
  } = player;

  const [voiceEnabled, setVoiceEnabled] = useState(readVoiceEnabled);
  const [hotkeysEnabled, setHotkeysEnabled] = useState(readHotkeysEnabled);
  const [hotkeyMap, setHotkeyMap] = useState(readHotkeyMap);
  const [hotkeyWarning, setHotkeyWarning] = useState<string | undefined>();
  const [voiceUi, setVoiceUi] = useState<{
    status: VoiceUiStatus;
    detail: string;
  }>({ status: "off", detail: "" });
  const voiceRef = useRef<VoiceAssistant | null>(null);
  /** Last voice catalog feed — used by「追加N首」. */
  const voiceFeedRef = useRef<{
    mode: "search" | "chart" | "none";
    query?: string;
    provider?: string | null;
    chartId?: string;
    offset: number;
  }>({ mode: "none", offset: 0 });
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [desktopLyricsOpen, setDesktopLyricsOpen] = useState(false);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [mini, setMini] = useState(
    () => localStorage.getItem("yinzhan-mini") === "1",
  );
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverSourceId, setDragOverSourceId] = useState<string | null>(null);
  const sourceListRef = useRef<HTMLDivElement | null>(null);
  const sourceDragRef = useRef<{
    id: string;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const normalSizeRef = useRef({ width: 1180, height: 760 });

  // Quietly check for a signed installable update a few seconds after launch.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkForInstallableUpdate().then((update) => {
        if (!cancelled && update) setPendingUpdate(update);
      });
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const refreshFavorites = useCallback(async () => {
    const list = await api.listFavorites();
    favoritesRef.current = list;
    setFavoriteKeys(new Set(list.map((i) => favKey(i.track))));
    setFavToken((n) => n + 1);
  }, []);

  useEffect(() => {
    applyDocumentTheme(theme);
    writeStoredTheme(theme);
    void syncWindowTheme(theme);
  }, [theme]);

  useEffect(() => {
    // Restore mini geometry, or keep normal-mode floor after allowing smaller mini window in conf.
    const win = getCurrentWindow();
    if (localStorage.getItem("yinzhan-mini") === "1") {
      void (async () => {
        try {
          await win.setMinSize(new LogicalSize(360, 88));
          await win.setSize(new LogicalSize(MINI_SIZE.width, MINI_SIZE.height));
          await win.setAlwaysOnTop(true);
        } catch {
          // ignore restore errors on first paint
        }
      })();
    } else {
      void win
        .setMinSize(new LogicalSize(NORMAL_MIN.width, NORMAL_MIN.height))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("yinzhan-mini", mini ? "1" : "0");
  }, [mini]);

  useEffect(() => {
    api.listProviders().then((ps) => {
      const ordered = sortProvidersByOrder(ps, loadProviderOrder());
      setProviders(ordered);
      const disabled = readDisabledProviders();
      const enabled = ordered.filter((p) => !disabled.has(p.id));
      const pool = enabled.length > 0 ? enabled : ordered;
      const saved = localStorage.getItem("yinzhan-provider");
      if (saved && pool.some((p) => p.id === saved)) {
        setProviderId(saved);
      } else if (pool[0]) {
        setProviderId(pool[0].id);
      }
    });
    refreshFavorites().catch(() => undefined);
  }, [refreshFavorites]);

  useEffect(() => {
    localStorage.setItem("yinzhan-provider", providerId);
  }, [providerId]);

  const pickableProviders = useMemo(() => {
    const enabled = providers.filter((p) => !disabledProviders.has(p.id));
    return enabled.length > 0 ? enabled : providers;
  }, [providers, disabledProviders, healthVersion]);

  useEffect(() => {
    if (providers.length === 0) return;
    if (!pickableProviders.some((p) => p.id === providerId) && pickableProviders[0]) {
      setProviderId(pickableProviders[0].id);
    }
  }, [providers, pickableProviders, providerId]);

  const onToggleProviderDisabled = useCallback(
    (id: string) => {
      setDisabledProviders(toggleProviderDisabled(id));
      refreshProviderHealth();
    },
    [refreshProviderHealth],
  );

  useEffect(() => {
    if (nav === "settings") refreshProviderHealth();
  }, [nav, refreshProviderHealth]);

  const reorderProviders = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setProviders((prev) => {
      const from = prev.findIndex((p) => p.id === fromId);
      const to = prev.findIndex((p) => p.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      localStorage.setItem(
        PROVIDER_ORDER_KEY,
        JSON.stringify(next.map((p) => p.id)),
      );
      return next;
    });
  }, []);

  const hitSourceAtY = useCallback((clientY: number): string | null => {
    const root = sourceListRef.current;
    if (!root) return null;
    const nodes = root.querySelectorAll<HTMLElement>("[data-source-id]");
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return el.dataset.sourceId || null;
      }
    }
    return null;
  }, []);

  const endSourceDrag = useCallback(() => {
    sourceDragRef.current = null;
    setDragSourceId(null);
    setDragOverSourceId(null);
  }, []);

  const lyricsNeeded = lyricsOpen || desktopLyricsOpen;

  useEffect(() => {
    if (!lyricsNeeded || !current) {
      if (!lyricsNeeded) {
        setLyricLines([]);
        setLyricsError(null);
        setLyricsLoading(false);
      }
      return;
    }
    let cancelled = false;
    const track = current;
    setLyricsLoading(true);
    setLyricsError(null);
    setLyricLines([]);
    api
      .fetchLyrics(track)
      .then((payload) => {
        if (cancelled) return;
        setLyricLines(mergeLyrics(payload.lrc, payload.translatedLrc));
      })
      .catch((e) => {
        if (cancelled) return;
        setLyricsError(String(e).replace(/^Error:\s*/, ""));
        setLyricLines([]);
      })
      .finally(() => {
        if (!cancelled) setLyricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lyricsNeeded, current]);

  const pushDesktopLyricsState = useCallback(() => {
    if (!desktopLyricsOpen) return;
    void syncDesktopLyricsState({
      title: current?.title ?? "",
      artist: current?.artist ?? "",
      lines: lyricLines,
      progress,
      loading: lyricsLoading,
      error: lyricsError,
      playing,
    });
  }, [
    desktopLyricsOpen,
    current,
    lyricLines,
    progress,
    lyricsLoading,
    lyricsError,
    playing,
  ]);

  useEffect(() => {
    pushDesktopLyricsState();
  }, [pushDesktopLyricsState]);

  useEffect(() => {
    let unReady: (() => void) | undefined;
    let unClosed: (() => void) | undefined;
    let unDock: (() => void) | undefined;
    void listenDesktopLyricsReady(() => {
      pushDesktopLyricsState();
    }).then((fn) => {
      unReady = fn;
    });
    void listenDesktopLyricsClosed(() => {
      setDesktopLyricsOpen(false);
    }).then((fn) => {
      unClosed = fn;
    });
    void listenDesktopLyricsDock(() => {
      setDesktopLyricsOpen(false);
      setQueueOpen(false);
      setLyricsOpen(true);
    }).then((fn) => {
      unDock = fn;
    });
    return () => {
      unReady?.();
      unClosed?.();
      unDock?.();
    };
  }, [pushDesktopLyricsState]);

  /** Pop out: close in-app panel, show floating lyrics. */
  const popOutDesktopLyrics = useCallback(async () => {
    if (desktopLyricsOpen) return;
    setLyricsOpen(false);
    setQueueOpen(false);
    try {
      await openDesktopLyricsWindow();
      setDesktopLyricsOpen(true);
    } catch (e) {
      console.warn("open desktop lyrics failed", e);
      setDesktopLyricsOpen(false);
      setLyricsOpen(true);
    }
  }, [desktopLyricsOpen]);

  const toggleMini = useCallback(async () => {
    const win = getCurrentWindow();
    const nextPaint = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

    try {
      if (!mini) {
        // Collapse: switch to mini layout first, then shrink.
        const size = await win.innerSize();
        const factor = await win.scaleFactor();
        normalSizeRef.current = {
          width: Math.round(size.width / factor),
          height: Math.round(size.height / factor),
        };
        setQueueOpen(false);
        setLyricsOpen(false);
        setMini(true);
        localStorage.setItem("yinzhan-mini", "1");
        await nextPaint();
        await win.setMinSize(new LogicalSize(360, 88));
        await win.setSize(new LogicalSize(MINI_SIZE.width, MINI_SIZE.height));
        await win.setAlwaysOnTop(true);
      } else {
        // Expand: restore size first (dark window bg), then show full chrome.
        await win.setAlwaysOnTop(false);
        await win.setMinSize(new LogicalSize(NORMAL_MIN.width, NORMAL_MIN.height));
        await win.setSize(
          new LogicalSize(normalSizeRef.current.width, normalSizeRef.current.height),
        );
        setMini(false);
        localStorage.setItem("yinzhan-mini", "0");
      }
    } catch (e) {
      setPlayError(String(e).replace(/^Error:\s*/, ""));
    }
  }, [mini, setPlayError]);

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

  const onVoiceEnabled = useCallback((on: boolean) => {
    setVoiceEnabled(on);
    writeVoiceEnabled(on);
  }, []);

  const onHotkeysEnabled = useCallback((on: boolean) => {
    setHotkeysEnabled(on);
    writeHotkeysEnabled(on);
  }, []);

  const onHotkeyMapChange = useCallback((map: Record<HotkeyAction, string>) => {
    setHotkeyMap(map);
    writeHotkeyMap(map);
  }, []);

  useEffect(() => {
    const assistant = new VoiceAssistant({
      onNext: () => undefined,
      onPrev: () => undefined,
      onPlay: () => undefined,
      onPause: () => undefined,
      onToggle: () => undefined,
      onMute: () => undefined,
      onVolumeUp: () => undefined,
      onVolumeDown: () => undefined,
      onShowLyrics: () => undefined,
      onHideLyrics: () => undefined,
      onFavorite: async () => undefined,
      onUnfavorite: async () => undefined,
      onSearchPlay: async () => undefined,
      onThemePlay: async () => undefined,
      onAppendTracks: async () => undefined,
      onProviderPlay: async () => undefined,
      onSwitchProvider: () => undefined,
      onShuffle: () => undefined,
      onRepeat: () => undefined,
      onClearQueue: () => undefined,
      onShowQueue: () => undefined,
      onWhatsPlaying: async () => undefined,
      onPlayFavorites: async () => undefined,
      onStatus: (status, detail) => setVoiceUi({ status, detail }),
    });
    voiceRef.current = assistant;
    return () => {
      void assistant.stop();
      voiceRef.current = null;
    };
  }, []);

  const appendTracksToQueue = useCallback((tracks: Track[]) => {
    if (!tracks.length) return;
    const q = queueRef.current;
    const i = queueIndexRef.current;
    const fresh = uniqueTracks(tracks).filter(
      (t) => !q.some((x) => isSameSong(x, t)),
    );
    if (!fresh.length) return;
    if (q.length === 0 || i < 0) {
      void playTrackAtRef.current(fresh, 0);
      return;
    }
    const next = [...q, ...fresh];
    setQueue(next);
  }, [setQueue]);

  /** Append one track to the queue and start playing it (keeps existing queue). */
  const playOrAppendOne = useCallback((track: Track) => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (q.length === 0 || i < 0) {
      void playTrackAtRef.current([track], 0);
      return;
    }
    const existing = q.findIndex((x) => isSameSong(x, track));
    if (existing >= 0) {
      void playTrackAtRef.current(q, existing);
      return;
    }
    const next = [...q, track];
    setQueue(next);
    void playTrackAtRef.current(next, next.length - 1);
  }, [setQueue]);

  const voiceSearchPlay = useCallback(
    async (query: string, provider?: string) => {
      const q = query.trim();
      if (!q) {
        void invoke("voice_speak", { text: "请告诉我歌名或歌手" });
        return;
      }
      try {
        const speakPlay = async (track: Track, prefix = "") => {
          const title = track.title?.trim() || q;
          const artist = track.artist?.trim();
          const head = prefix ? `${prefix}${title}` : title;
          const say = artist ? `为你播放${head}，${artist}` : `为你播放${head}`;
          await invoke("voice_speak", { text: say });
        };

        // Resolve against live favorites (ref + refresh) so title-only hits work.
        let favorites = favoritesRef.current;
        try {
          favorites = await api.listFavorites();
          favoritesRef.current = favorites;
        } catch {
          // keep cached ref
        }

        const queueHit = findBestMatchingTrack(queueRef.current, q, 1);
        const favHit = findFavoriteTrack(favorites, q);

        // 1) Queue only if near-exact, and not worse than a favorite hit
        if (
          queueHit &&
          queueHit.score >= QUEUE_STRONG_SCORE &&
          (!favHit || queueHit.score >= favHit.score)
        ) {
          void playTrackAtRef.current(queueRef.current, queueHit.index);
          await speakPlay(queueHit.track);
          return;
        }

        // 2) Favorites — title match is enough (no need to say artist)
        if (favHit) {
          voiceFeedRef.current = {
            mode: "search",
            query: q,
            provider: favHit.track.provider,
            offset: 1,
          };
          playOrAppendOne(favHit.track);
          await speakPlay(favHit.track, "收藏里的");
          return;
        }

        // 3) Weaker queue hit
        if (queueHit && queueHit.score >= 70) {
          void playTrackAtRef.current(queueRef.current, queueHit.index);
          await speakPlay(queueHit.track);
          return;
        }

        // 4) Search default / spoken provider — append best title match only
        const searchProvider = provider || providerId || "netease";
        if (provider) {
          setProviderId(provider);
          setNav("charts");
        }
        const tracks = await api.searchTracks(q, 12, searchProvider);
        const list = uniqueTracks(
          tracks.filter((t) => t.playability !== "unavailable"),
        );
        if (!list.length) {
          await invoke("voice_speak", { text: `没有找到${q}` });
          return;
        }
        const searchHit = findBestMatchingTrack(list, q, 1);
        const track = searchHit?.track ?? list[0];
        voiceFeedRef.current = {
          mode: "search",
          query: q,
          provider: searchProvider,
          offset: 1,
        };
        playOrAppendOne(track);
        await speakPlay(track);
      } catch (e) {
        console.error("voice search play failed", e);
        await invoke("voice_speak", { text: "搜索失败，请再说一次" });
      }
    },
    [playOrAppendOne, providerId],
  );

  const voiceThemePlay = useCallback(
    async (query: string, provider?: string, limit = 30) => {
      const q = query.trim();
      if (!q) {
        void invoke("voice_speak", { text: "请告诉我想听什么风格" });
        return;
      }
      try {
        if (provider) {
          setProviderId(provider);
          setNav("charts");
        }
        const tracks = await api.searchTracks(
          q,
          Math.min(50, Math.max(12, limit)),
          provider ?? "all",
        );
        const playable = uniqueTracks(
          tracks.filter((t) => t.playability !== "unavailable"),
        );
        if (!playable.length) {
          await invoke("voice_speak", { text: `没有找到${q}相关的歌` });
          return;
        }
        voiceFeedRef.current = {
          mode: "search",
          query: q,
          provider: provider ?? "all",
          offset: playable.length,
        };
        playAll(playable);
        await invoke("voice_speak", {
          text: `为你放入${playable.length}首${q}相关歌曲`,
        });
      } catch (e) {
        console.error("voice theme play failed", e);
        await invoke("voice_speak", { text: "搜索失败，请再说一次" });
      }
    },
    [playAll],
  );

  const voiceAppendTracks = useCallback(
    async (count: number) => {
      const n = Math.min(50, Math.max(1, count || 20));
      try {
        const feed = voiceFeedRef.current;
        const seenQueue = queueRef.current;
        let fresh: Track[] = [];

        if (feed.mode === "search" && feed.query) {
          const batch = await api.searchTracks(
            feed.query,
            Math.min(50, feed.offset + n + 20),
            feed.provider ?? "all",
          );
          fresh = uniqueTracks(
            batch.filter((t) => t.playability !== "unavailable"),
          )
            .filter((t) => !seenQueue.some((x) => isSameSong(x, t)))
            .slice(0, n);
          feed.offset = Math.max(feed.offset, batch.length);
        } else if (feed.mode === "chart" && feed.chartId && feed.provider) {
          const batch = await api.chartTracks(
            feed.chartId,
            Math.max(n * 2, n + 10),
            feed.provider,
            feed.offset,
          );
          fresh = uniqueTracks(
            batch.filter((t) => t.playability !== "unavailable"),
          )
            .filter((t) => !seenQueue.some((x) => isSameSong(x, t)))
            .slice(0, n);
          feed.offset += batch.length;
        } else {
          const provider = providerId;
          const charts = await api.listCharts(provider);
          if (!charts.length) {
            await invoke("voice_speak", { text: "暂时没有可追加的歌曲" });
            return;
          }
          const chart = charts[0];
          const offset = queueRef.current.length;
          const batch = await api.chartTracks(
            chart.id,
            Math.max(n * 2, n + 10),
            provider,
            offset,
          );
          fresh = uniqueTracks(
            batch.filter((t) => t.playability !== "unavailable"),
          )
            .filter((t) => !seenQueue.some((x) => isSameSong(x, t)))
            .slice(0, n);
          voiceFeedRef.current = {
            mode: "chart",
            provider,
            chartId: chart.id,
            offset: offset + batch.length,
          };
        }

        if (!fresh.length) {
          await invoke("voice_speak", { text: "没有更多不同的歌了" });
          return;
        }
        appendTracksToQueue(fresh);
        await invoke("voice_speak", {
          text: `已追加${fresh.length}首歌到播放列表`,
        });
      } catch (e) {
        console.error("voice append failed", e);
        await invoke("voice_speak", { text: "追加失败，请再说一次" });
      }
    },
    [appendTracksToQueue, providerId],
  );

  const voiceProviderPlay = useCallback(
    async (provider: string) => {
      try {
        setProviderId(provider);
        setNav("charts");
        const charts = await api.listCharts(provider);
        if (!charts.length) {
          await invoke("voice_speak", {
            text: `${providerLabel(provider)}暂时没有可播放的榜单`,
          });
          return;
        }
        const chart = charts[0];
        const tracks = await api.chartTracks(chart.id, 40, provider, 0);
        const playable = uniqueTracks(
          tracks.filter((t) => t.playability !== "unavailable"),
        );
        if (!playable.length) {
          await invoke("voice_speak", {
            text: `${providerLabel(provider)}暂时没有可播放的歌曲`,
          });
          return;
        }
        voiceFeedRef.current = {
          mode: "chart",
          provider,
          chartId: chart.id,
          offset: playable.length,
        };
        playAll(playable);
        await invoke("voice_speak", {
          text: `已切换到${providerLabel(provider)}，为你播放${chart.name || "热门歌曲"}`,
        });
      } catch (e) {
        console.error("voice provider play failed", e);
        await invoke("voice_speak", { text: "加载音源失败，请再说一次" });
      }
    },
    [playAll],
  );

  const voiceSwitchProvider = useCallback(
    (provider: string) => {
      if (disabledProviders.has(provider)) {
        void invoke("voice_speak", {
          text: `${providerLabel(provider)}已在设置里禁用，请先启用`,
        });
        return;
      }
      setProviderId(provider);
      setNav("charts");
    },
    [disabledProviders],
  );

  const voicePlayFavorites = useCallback(async () => {
    try {
      const items = await api.listFavorites();
      const tracks = uniqueTracks(
        items
          .map((i) => i.track)
          .filter((t) => t.playability !== "unavailable"),
      );
      if (!tracks.length) {
        setNav("favorites");
        await invoke("voice_speak", { text: "收藏夹还是空的" });
        return;
      }
      voiceFeedRef.current = { mode: "none", offset: 0 };
      setNav("favorites");
      // Replace the play queue with favorites — same as「播放全部」on the Favorites page.
      playAll(tracks);
      await invoke("voice_speak", {
        text: `好的，已把收藏里的${tracks.length}首歌加入播放列表`,
      });
    } catch (e) {
      console.error("voice play favorites failed", e);
      await invoke("voice_speak", { text: "打开收藏失败" });
    }
  }, [playAll]);

  const voiceWhatsPlaying = useCallback(async () => {
    const track = current;
    if (!track) {
      await invoke("voice_speak", { text: "当前没有在播放的歌曲" });
      return;
    }
    const title = track.title?.trim() || "未知歌曲";
    const artist = track.artist?.trim();
    await invoke("voice_speak", {
      text: artist ? `正在播放${title}，${artist}` : `正在播放${title}`,
    });
  }, [current]);

  useEffect(() => {
    voiceRef.current?.updateHandlers({
      onNext: () => playNext(),
      onPrev: () => playPrevTrack(),
      onPlay: () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
          if (
            !audio.getAttribute("src") &&
            queueRef.current.length > 0 &&
            queueIndexRef.current >= 0
          ) {
            void playTrackAtRef.current(queueRef.current, queueIndexRef.current);
            return;
          }
          void audio.play().catch(() => undefined);
        }
      },
      onPause: () => {
        audioRef.current?.pause();
      },
      onToggle: () => togglePlay(),
      onMute: () => toggleMute(),
      onVolumeUp: () => {
        setVolumeLevel((v) => {
          const next = Math.min(1, Math.round((v + 0.1) * 100) / 100);
          if (next > 0) setMuted(false);
          return next;
        });
      },
      onVolumeDown: () => {
        setVolumeLevel((v) => Math.max(0, Math.round((v - 0.1) * 100) / 100));
      },
      onShowLyrics: () => {
        setQueueOpen(false);
        setLyricsOpen(true);
      },
      onHideLyrics: () => {
        setLyricsOpen(false);
      },
      onFavorite: async () => {
        const track = current;
        if (!track) {
          await invoke("voice_speak", { text: "当前没有在播放的歌曲" });
          return;
        }
        const key = favKey(track);
        if (favoriteKeys.has(key)) {
          await invoke("voice_speak", { text: "这首歌已经在收藏里了" });
          return;
        }
        await api.addFavorite(track);
        await refreshFavorites();
      },
      onUnfavorite: async () => {
        const track = current;
        if (!track) {
          await invoke("voice_speak", { text: "当前没有在播放的歌曲" });
          return;
        }
        const key = favKey(track);
        if (!favoriteKeys.has(key)) {
          await invoke("voice_speak", { text: "这首歌还没有收藏" });
          return;
        }
        await api.removeFavorite(track.provider, track.id);
        await refreshFavorites();
      },
      onSearchPlay: (query, provider) => voiceSearchPlay(query, provider),
      onThemePlay: (query, provider, limit) =>
        voiceThemePlay(query, provider, limit),
      onAppendTracks: (count) => voiceAppendTracks(count),
      onProviderPlay: (provider) => voiceProviderPlay(provider),
      onSwitchProvider: (provider) => voiceSwitchProvider(provider),
      onShuffle: () => toggleShuffle(),
      onRepeat: () => cycleRepeat(),
      onClearQueue: () => clearQueueKeepCurrent(),
      onShowQueue: () => {
        setLyricsOpen(false);
        setQueueOpen(true);
      },
      onWhatsPlaying: () => voiceWhatsPlaying(),
      onPlayFavorites: () => voicePlayFavorites(),
      onStatus: (status, detail) => setVoiceUi({ status, detail }),
      onMusicHold: onVoiceMusicHold,
      onMusicDuck: onVoiceMusicDuck,
    });
  }, [
    playNext,
    playPrevTrack,
    togglePlay,
    toggleMute,
    setVolumeLevel,
    setMuted,
    onVoiceMusicHold,
    onVoiceMusicDuck,
    voiceSearchPlay,
    voiceThemePlay,
    voiceAppendTracks,
    voiceProviderPlay,
    voiceSwitchProvider,
    toggleShuffle,
    cycleRepeat,
    clearQueueKeepCurrent,
    voiceWhatsPlaying,
    voicePlayFavorites,
    current,
    favoriteKeys,
    refreshFavorites,
  ]);

  useEffect(() => {
    const assistant = voiceRef.current;
    if (!assistant) return;
    if (voiceEnabled) {
      void assistant.start().catch((e) => {
        console.error("voice assistant failed to start", e);
        setVoiceUi({ status: "error", detail: String(e) });
        setVoiceEnabled(false);
        writeVoiceEnabled(false);
      });
    } else {
      void assistant.stop();
      setVoiceUi({ status: "off", detail: "" });
    }
  }, [voiceEnabled]);

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
        const t = audioRef.current?.currentTime ?? 0;
        seekToSeconds(t - 10);
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        const t = audioRef.current?.currentTime ?? 0;
        seekToSeconds(t + 10);
        return;
      }
      if (e.code === "ArrowUp") {
        e.preventDefault();
        playPrev();
        return;
      }
      if (e.code === "ArrowDown") {
        e.preventDefault();
        playNext();
        return;
      }
      if (e.key === "m" || e.key === "M") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, playPrev, playNext, seekToSeconds, toggleMute]);

  const shellActionRef = useRef({
    toggle: () => undefined as void,
    next: () => undefined as void,
    prev: () => undefined as void,
    favorite: () => undefined as void,
  });
  shellActionRef.current = {
    toggle: () => togglePlay(),
    next: () => playNext(),
    prev: () => playPrevTrack(),
    favorite: () => {
      const track = current;
      if (track) void toggleFavorite(track);
    },
  };

  // Tray menu → frontend player actions
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("tray-action", (event) => {
      const action = event.payload;
      if (action === "toggle") shellActionRef.current.toggle();
      else if (action === "next") shellActionRef.current.next();
      else if (action === "prev") shellActionRef.current.prev();
      else if (action === "favorite") shellActionRef.current.favorite();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Global hotkeys (work while window is in background)
  useEffect(() => {
    let cancelled = false;
    if (!hotkeysEnabled) {
      void unregisterAllHotkeys(hotkeyMap);
      setHotkeyWarning(undefined);
      return () => {
        cancelled = true;
      };
    }

    void registerHotkeys(hotkeyMap, {
      onToggle: () => shellActionRef.current.toggle(),
      onNext: () => shellActionRef.current.next(),
      onPrev: () => shellActionRef.current.prev(),
      onFavorite: () => shellActionRef.current.favorite(),
    }).then((failed) => {
      if (cancelled) return;
      if (failed.length > 0) {
        setHotkeyWarning(
          `部分快捷键注册失败（可能被其他应用占用）：${failed
            .map(formatHotkeyAccel)
            .join("、")}`,
        );
      } else {
        setHotkeyWarning(undefined);
      }
    });

    return () => {
      cancelled = true;
      void unregisterAllHotkeys(hotkeyMap);
    };
  }, [hotkeysEnabled, hotkeyMap]);

  useMediaSession({
    current,
    playing,
    progress,
    duration,
    audioRef,
    ignoreEndedUntilRef,
    onPrev: playPrev,
    onNext: playNext,
    onProgress: setProgress,
  });

  const navItems = useMemo(
    () =>
      [
        { key: "charts" as const, label: "榜单", en: "Charts", icon: TrendingUp },
        { key: "search" as const, label: "搜索", en: "Search", icon: Search },
        { key: "favorites" as const, label: "收藏", en: "Saved", icon: Heart },
        { key: "history" as const, label: "最近", en: "Recent", icon: History },
        { key: "playlists" as const, label: "歌单", en: "Lists", icon: ListMusic },
        { key: "settings" as const, label: "设置", en: "Prefs", icon: Settings },
      ] as const,
    [],
  );

  return (
    <div className={`app ${mini ? "mini" : ""}`}>
      <aside className={`sidebar ${dragSourceId ? "is-sorting-sources" : ""}`}>
        <div className="brand">
          <BrandMark className="brand-mark" size={42} />
          <div className="brand-text">
            <div className="brand-name">音栈</div>
            <div className="brand-tag">Yinzhan · Free Stream</div>
          </div>
        </div>

        <div className="sidebar-scroll">
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
              <div className="source-label">
                <span className="source-label-zh">音源</span>
                <span className="source-label-en">Source</span>
              </div>
              <div
                className="source-list"
                role="list"
                ref={sourceListRef}
              >
                {pickableProviders.map((p) => (
                  <div
                    key={p.id}
                    role="listitem"
                    data-source-id={p.id}
                    className={[
                      "source-btn",
                      providerId === p.id ? "on" : "",
                      dragSourceId === p.id ? "dragging" : "",
                      dragOverSourceId === p.id && dragSourceId !== p.id
                        ? "drag-over"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      className="source-grip"
                      title="拖动排序"
                      aria-label={`拖动调整 ${providerLabel(p.id)} 顺序`}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        e.stopPropagation();
                        (e.currentTarget as HTMLElement).setPointerCapture(
                          e.pointerId,
                        );
                        sourceDragRef.current = {
                          id: p.id,
                          startY: e.clientY,
                          moved: false,
                          pointerId: e.pointerId,
                        };
                        setDragSourceId(p.id);
                        setDragOverSourceId(null);
                      }}
                      onPointerMove={(e) => {
                        const drag = sourceDragRef.current;
                        if (!drag || drag.pointerId !== e.pointerId) return;
                        if (Math.abs(e.clientY - drag.startY) > 4) {
                          drag.moved = true;
                        }
                        if (!drag.moved) return;
                        const over = hitSourceAtY(e.clientY);
                        setDragOverSourceId(
                          over && over !== drag.id ? over : null,
                        );
                      }}
                      onPointerUp={(e) => {
                        const drag = sourceDragRef.current;
                        if (!drag || drag.pointerId !== e.pointerId) return;
                        try {
                          (e.currentTarget as HTMLElement).releasePointerCapture(
                            e.pointerId,
                          );
                        } catch {
                          /* already released */
                        }
                        const over = drag.moved ? hitSourceAtY(e.clientY) : null;
                        if (over && over !== drag.id) {
                          reorderProviders(drag.id, over);
                        }
                        endSourceDrag();
                      }}
                      onPointerCancel={() => endSourceDrag()}
                    >
                      <GripVertical size={14} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="source-pick"
                      onClick={() => setProviderId(p.id)}
                    >
                      <span className="source-btn-dot" aria-hidden />
                      {providerLabel(p.id)}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="main">
        {!mini && pendingUpdate ? (
          <UpdateBanner
            update={pendingUpdate}
            onDismiss={() => setPendingUpdate(null)}
          />
        ) : null}
        <div className={`view-pane ${nav === "charts" ? "on" : ""}`}>
          <ChartsView
            providerId={providerId}
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            playing={playing}
            onPlay={playFromList}
            onTogglePlay={togglePlay}
            onPlayAll={playAll}
            onPlayNext={enqueueNext}
            onAddToQueue={addToQueue}
            onAddToPlaylist={setPlaylistPickTrack}
            onToggleFavorite={toggleFavorite}
          />
        </div>
        <div className={`view-pane ${nav === "search" ? "on" : ""}`}>
          <SearchView
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            playing={playing}
            providers={pickableProviders}
            onPlay={playFromList}
            onTogglePlay={togglePlay}
            onPlayAll={playAll}
            onPlayNext={enqueueNext}
            onAddToQueue={addToQueue}
            onAddToPlaylist={setPlaylistPickTrack}
            onToggleFavorite={toggleFavorite}
          />
        </div>
        <div className={`view-pane ${nav === "favorites" ? "on" : ""}`}>
          <FavoritesView
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            playing={playing}
            onPlay={playFromList}
            onTogglePlay={togglePlay}
            onPlayAll={playAll}
            onPlayNext={enqueueNext}
            onAddToQueue={addToQueue}
            onAddToPlaylist={setPlaylistPickTrack}
            onToggleFavorite={toggleFavorite}
            refreshToken={favToken}
          />
        </div>
        <div className={`view-pane ${nav === "history" ? "on" : ""}`}>
          <HistoryView
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            playing={playing}
            onPlay={playFromList}
            onTogglePlay={togglePlay}
            onPlayAll={playAll}
            onPlayNext={enqueueNext}
            onAddToQueue={addToQueue}
            onAddToPlaylist={setPlaylistPickTrack}
            onToggleFavorite={toggleFavorite}
            refreshToken={historyToken}
            active={nav === "history"}
          />
        </div>
        <div className={`view-pane ${nav === "playlists" ? "on" : ""}`}>
          <PlaylistsView
            favoriteKeys={favoriteKeys}
            currentKey={currentKey}
            playing={playing}
            onPlay={playFromList}
            onTogglePlay={togglePlay}
            onPlayAll={playAll}
            onPlayNext={enqueueNext}
            onAddToQueue={addToQueue}
            onAddToPlaylist={setPlaylistPickTrack}
            onToggleFavorite={toggleFavorite}
            refreshToken={playlistToken}
            active={nav === "playlists"}
          />
        </div>
        <div className={`view-pane ${nav === "settings" ? "on" : ""}`}>
          <SettingsView
            providers={providers}
            providerId={providerId}
            onProviderId={setProviderId}
            disabledProviders={disabledProviders}
            providerHealth={providerHealth}
            onToggleProviderDisabled={onToggleProviderDisabled}
            onRefreshHealth={refreshProviderHealth}
            autoSkip={autoSkip}
            onAutoSkip={setAutoSkip}
            theme={theme}
            onTheme={setTheme}
            audioQuality={audioQuality}
            onAudioQuality={setAudioQuality}
            voiceEnabled={voiceEnabled}
            onVoiceEnabled={onVoiceEnabled}
            voiceStatusText={
              voiceEnabled
                ? voiceUi.detail ||
                  (voiceUi.status === "listening"
                    ? VOICE_LISTEN_HINT
                    : voiceUi.status === "awake"
                      ? "请说指令…"
                      : voiceUi.status === "error"
                        ? "启动失败"
                        : "准备中…")
                : undefined
            }
            hotkeysEnabled={hotkeysEnabled}
            onHotkeysEnabled={onHotkeysEnabled}
            hotkeyMap={hotkeyMap}
            onHotkeyMap={onHotkeyMapChange}
            hotkeyWarning={hotkeyWarning}
            active={nav === "settings"}
            onUpdateAvailable={(u) => {
              if (u) setPendingUpdate(u);
            }}
          />
        </div>
      </main>

      {voiceEnabled && voiceUi.status !== "off" && voiceUi.status !== "stopped" ? (
        <div
          className={`voice-pill ${
            voiceUi.status === "awake" || voiceUi.status === "speaking" ? "awake" : ""
          } ${voiceUi.status === "error" ? "error" : ""}`}
          role="status"
        >
          <i aria-hidden />
          <span>
            {voiceUi.status === "speaking"
              ? voiceUi.detail || "…"
              : voiceUi.status === "awake"
                ? "请说指令…"
                : voiceUi.status === "error"
                  ? voiceUi.detail || "语音助手出错"
                  : voiceUi.detail || VOICE_LISTEN_HINT}
          </span>
        </div>
      ) : null}

      <PlaylistPicker
        open={Boolean(playlistPickTrack)}
        track={playlistPickTrack}
        onClose={() => setPlaylistPickTrack(null)}
        onAdded={() => setPlaylistToken((n) => n + 1)}
      />

      <QueuePanel
        open={!mini && queueOpen}
        tracks={queue}
        currentIndex={queueIndex}
        playing={playing}
        onClose={() => setQueueOpen(false)}
        onSelect={(index) => void playTrackAt(queue, index)}
        onRemove={removeFromQueue}
        onClear={clearQueueKeepCurrent}
      />

      <LyricsPanel
        open={!mini && lyricsOpen}
        track={current}
        progress={progress}
        lines={lyricLines}
        loading={lyricsLoading}
        error={lyricsError}
        desktopOpen={desktopLyricsOpen}
        onClose={() => setLyricsOpen(false)}
        onSeek={seekToSeconds}
        onPopOutDesktop={() => void popOutDesktopLyrics()}
      />

      <PlayerBar
        track={current}
        playing={playing}
        loading={loadingPlay}
        error={playError}
        progress={progress}
        duration={
          Number.isFinite(duration) && duration > 0
            ? duration
            : current?.durationMs
              ? current.durationMs / 1000
              : 0
        }
        streamQuality={formatStreamQuality(streamQuality)}
        hasPrev={hasPrev}
        hasNext={hasNext}
        favorited={currentKey ? favoriteKeys.has(currentKey) : false}
        shuffle={shuffle}
        repeatMode={repeatMode}
        volume={volume}
        muted={muted}
        queueOpen={queueOpen}
        queueLength={queue.length}
        lyricsOpen={lyricsOpen}
        mini={mini}
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
        onToggleQueue={() => {
          setLyricsOpen(false);
          setQueueOpen((o) => !o);
        }}
        onToggleLyrics={() => {
          setQueueOpen(false);
          setLyricsOpen((o) => !o);
        }}
        onToggleMini={() => void toggleMini()}
      />
    </div>
  );
}

export default App;
