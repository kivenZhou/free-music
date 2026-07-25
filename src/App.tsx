import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, providerLabel } from "./api";
import { BrandMark } from "./components/BrandMark";
import { ChartsView } from "./components/ChartsView";
import { FavoritesView } from "./components/FavoritesView";
import { LyricsPanel, mergeLyrics, type LyricLine } from "./components/LyricsPanel";
import { PlayerBar } from "./components/PlayerBar";
import { PlaylistPicker } from "./components/PlaylistPicker";
import { PlaylistsView } from "./components/PlaylistsView";
import { QueuePanel } from "./components/QueuePanel";
import { SearchView } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { UpdateBanner } from "./components/UpdateBanner";
import { TrendingUp, Search, Heart, Settings, ListMusic, GripVertical } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import type { FavoriteItem, NavKey, ProviderInfo, RepeatMode, Track } from "./types";
import { checkForInstallableUpdate } from "./updater";
import {
  readVoiceEnabled,
  VoiceAssistant,
  writeVoiceEnabled,
  type VoiceUiStatus,
} from "./voice";
import "./App.css";

const QUEUE_STORAGE_KEY = "yinzhan-queue-v1";
const PROVIDER_ORDER_KEY = "yinzhan-provider-order";
const NORMAL_MIN = { width: 900, height: 600 };
const MINI_SIZE = { width: 480, height: 96 };

function favKey(t: Track) {
  return `${t.provider}:${t.id}`;
}

/** Strip track-number prefixes / artist suffixes so cross-source dupes match. */
function normalizeSongTitle(title: string): string {
  let s = (title || "").toLowerCase().trim();
  s = s.replace(/^(?:p\d+\s*)?\d{1,3}[\.．、．\s]+/i, "");
  s = s.replace(/^[\[【\(（][^\]】\)）]{0,24}[\]】\)）]\s*/g, "");
  s = s.replace(
    /\s*[-—–_～~｜|／/]\s*[\u4e00-\u9fffA-Za-z0-9·\s]{1,20}$/u,
    "",
  );
  s = s.replace(
    /(?:官方(?:歌词)?版|直播版|现场版|完整版|高音质|无损|音频|伴奏|纯音乐|翻唱)$/g,
    "",
  );
  s = s.replace(/[\s\-—–_～~｜|·.,，。!！?？、；;：:（）()【】\[\]"'“”‘’]/g, "");
  return s;
}

function normalizeArtistName(artist: string): string {
  return (artist || "")
    .toLowerCase()
    .replace(/合集|精选|音乐|无损|音频|合辑|playlist|collection/g, "")
    .replace(/[\s\-—–_～~｜|·.,，。!！?？、；;：:（）()【】\[\]"'“”‘’]/g, "")
    .trim();
}

function isSameSong(a: Track, b: Track): boolean {
  if (favKey(a) === favKey(b)) return true;
  const ta = normalizeSongTitle(a.title || "");
  const tb = normalizeSongTitle(b.title || "");
  if (ta.length < 2 || tb.length < 2) return false;

  const titleHit =
    ta === tb ||
    (ta.length >= 4 && tb.length >= 4 && (ta.includes(tb) || tb.includes(ta)));
  if (!titleHit) return false;

  const aa = normalizeArtistName(a.artist || "");
  const ab = normalizeArtistName(b.artist || "");
  // B站合集等「歌手」常是 UP 主名，标题足够长时只靠标题判重
  if (!aa || !ab) return true;
  if (aa.includes(ab) || ab.includes(aa)) return true;
  if (Math.min(ta.length, tb.length) >= 6) return true;
  return false;
}

function uniqueTracks(list: Track[]): Track[] {
  const out: Track[] = [];
  for (const t of list) {
    if (out.some((x) => isSameSong(x, t))) continue;
    out.push(t);
  }
  return out;
}

/** Higher = closer title match. Exact favorites must beat “香草吧噗动态鼓谱”. */
function lcsLen(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  // Rolling DP to keep it light for short Chinese titles
  let prev = new Array<number>(n + 1).fill(0);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      cur[j] =
        a[i - 1] === b[j - 1] ? (prev[j - 1] as number) + 1 : Math.max(prev[j] as number, cur[j - 1] as number);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[n] as number;
}

/** Soften common ASR confusions inside short titles. */
function softenTitle(s: string): string {
  return s
    .replace(/[巴八扒]/g, "吧")
    .replace(/[扑蒲埔]/g, "噗")
    .replace(/[的得地]/g, "");
}

function parseArtistTitleQuery(query: string): { artist: string; title: string } {
  const q = query.trim();
  const m = q.match(/^(.+?)的(.+)$/);
  if (m?.[1] && m?.[2] && m[1].length >= 2 && m[2].length >= 1) {
    return { artist: m[1].trim(), title: m[2].trim() };
  }
  return { artist: "", title: q };
}

function scoreTrackMatch(track: Track, query: string): number {
  const parsed = parseArtistTitleQuery(query);
  const qTitle = softenTitle(normalizeSongTitle(parsed.title || query));
  const qArtist = normalizeArtistName(parsed.artist || "");
  const qFull = softenTitle(normalizeSongTitle(query));
  const title = softenTitle(normalizeSongTitle(track.title || ""));
  const artist = normalizeArtistName(track.artist || "");
  if (!qTitle && !qFull) return 0;
  if (!title && !artist) return 0;

  let score = 0;
  const candidates = [qTitle, qFull].filter((x, i, arr) => x && arr.indexOf(x) === i);

  for (const q of candidates) {
    if (title === q) {
      score = Math.max(score, 100);
      continue;
    }
    if (title.startsWith(q)) {
      const extra = title.length - q.length;
      score = Math.max(score, extra <= 2 ? 92 : Math.max(48, Math.round(88 * (q.length / title.length))));
      continue;
    }
    if (q.startsWith(title) && title.length >= 2) {
      const extra = q.length - title.length;
      score = Math.max(score, extra <= 2 ? 88 : 52);
      continue;
    }
    if (title.includes(q) && q.length >= 2) {
      score = Math.max(score, Math.round(42 + 50 * (q.length / title.length)));
      continue;
    }
    if (q.includes(title) && title.length >= 2) {
      score = Math.max(score, Math.round(42 + 50 * (title.length / q.length)));
      continue;
    }
    // Fuzzy: tolerate 1–2 ASR mistakes (香草八噗 ≈ 香草吧噗)
    if (q.length >= 3 && title.length >= 3) {
      const lcs = lcsLen(title, q);
      const ratio = lcs / Math.max(q.length, title.length);
      const cover = lcs / q.length;
      if (cover >= 0.75 && ratio >= 0.6) {
        score = Math.max(score, Math.round(55 + 40 * cover));
      } else if (cover >= 0.6 && lcs >= 3) {
        score = Math.max(score, Math.round(40 + 30 * cover));
      }
    }
  }

  if (qArtist && artist) {
    if (artist === qArtist || artist.includes(qArtist) || qArtist.includes(artist)) {
      score = Math.min(100, score + (score >= 40 ? 15 : 25));
    }
  } else if (!qArtist && artist && qFull.includes(artist) && title) {
    // 「南拳妈妈香草吧噗」without 的
    if (qFull.includes(title)) score = Math.max(score, 80);
  }

  return score;
}

function findBestMatchingTrack(
  tracks: Track[],
  query: string,
  minScore = 1,
): { track: Track; index: number; score: number } | null {
  let best: Track | null = null;
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!track || track.playability === "unavailable") continue;
    const score = scoreTrackMatch(track, query);
    if (score > bestScore) {
      bestScore = score;
      best = track;
      bestIndex = i;
    }
  }
  return best && bestIndex >= 0 && bestScore >= minScore
    ? { track: best, index: bestIndex, score: bestScore }
    : null;
}

function findFavoriteTrack(
  favorites: FavoriteItem[],
  query: string,
): { track: Track; score: number } | null {
  const hit = findBestMatchingTrack(
    favorites.map((item) => item.track).filter(Boolean),
    query,
    55,
  );
  return hit ? { track: hit.track, score: hit.score } : null;
}

/** Queue jump only for near-exact title; favorites win over long-suffix hits. */
const QUEUE_STRONG_SCORE = 92;

function loadProviderOrder(): string[] {
  try {
    const raw = localStorage.getItem(PROVIDER_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function sortProvidersByOrder(
  list: ProviderInfo[],
  order: string[],
): ProviderInfo[] {
  if (order.length === 0) return list;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const ai = rank.has(a.id) ? (rank.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const bi = rank.has(b.id) ? (rank.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

function loadStoredQueue(): { tracks: Track[]; index: number } | null {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { tracks?: Track[]; index?: number };
    if (!Array.isArray(data.tracks) || data.tracks.length === 0) return null;
    const index = Math.min(
      Math.max(0, Number(data.index) || 0),
      data.tracks.length - 1,
    );
    return { tracks: data.tracks, index };
  } catch {
    return null;
  }
}

function readStoredVolume(): number {
  const raw = localStorage.getItem("yinzhan-volume");
  if (raw == null) return 0.85;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.85;
}

function readStoredRepeat(): RepeatMode {
  // v2: default list-loop (was "off", which auto-persisted on first launch).
  const raw = localStorage.getItem("yinzhan-repeat-v2");
  if (raw === "all" || raw === "one" || raw === "off") return raw;
  return "all";
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

/** Prefer the media element's real duration; metadata can be wrong (esp. Bilibili). */
function playbackDuration(
  audio: HTMLAudioElement | null | undefined,
  fallbackMs?: number | null,
): number {
  if (audio) {
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) return d;
    if (audio.seekable.length > 0) {
      const end = audio.seekable.end(audio.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  }
  if (fallbackMs != null && Number.isFinite(fallbackMs) && fallbackMs > 0) {
    return fallbackMs / 1000;
  }
  return 0;
}

function clampSeekTime(audio: HTMLAudioElement, sec: number): number {
  const dur = playbackDuration(audio);
  let target = Math.max(0, sec);
  if (dur > 0) {
    // Stay slightly before the end so we don't fire `ended` and auto-advance.
    target = Math.min(target, Math.max(0, dur - 0.35));
  }
  if (audio.seekable.length > 0) {
    const end = audio.seekable.end(audio.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) {
      target = Math.min(target, Math.max(0, end - 0.35));
    }
  }
  return target;
}

function App() {
  const storedQueue = useMemo(() => loadStoredQueue(), []);
  const [nav, setNav] = useState<NavKey>("charts");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState(
    () => localStorage.getItem("yinzhan-provider") || "netease",
  );
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [favToken, setFavToken] = useState(0);
  const favoritesRef = useRef<FavoriteItem[]>([]);
  const [playlistToken, setPlaylistToken] = useState(0);
  const [playlistPickTrack, setPlaylistPickTrack] = useState<Track | null>(null);

  const [queue, setQueue] = useState<Track[]>(() => storedQueue?.tracks ?? []);
  const [queueIndex, setQueueIndex] = useState(() => storedQueue?.index ?? -1);
  const [current, setCurrent] = useState<Track | null>(
    () =>
      storedQueue && storedQueue.index >= 0
        ? storedQueue.tracks[storedQueue.index] ?? null
        : null,
  );
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
  const [voiceEnabled, setVoiceEnabled] = useState(readVoiceEnabled);
  const [voiceUi, setVoiceUi] = useState<{
    status: VoiceUiStatus;
    detail: string;
  }>({ status: "off", detail: "" });
  const voiceRef = useRef<VoiceAssistant | null>(null);
  const voiceHoldPlayingRef = useRef(false);
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
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [mini, setMini] = useState(
    () => localStorage.getItem("yinzhan-mini") === "1",
  );
  const [autoSkip, setAutoSkip] = useState(
    () => localStorage.getItem("yinzhan-auto-skip") !== "0",
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

  const queueReadyRef = useRef(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>(storedQueue?.tracks ?? []);
  const queueIndexRef = useRef(storedQueue?.index ?? -1);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>(readStoredRepeat());
  const playGenRef = useRef(0);
  const failSkipRef = useRef(0);
  const autoSkipRef = useRef(true);
  const ignoreEndedUntilRef = useRef(0);
  const suppressTimeRef = useRef(false);
  const normalSizeRef = useRef({ width: 1180, height: 760 });
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

  useEffect(() => {
    autoSkipRef.current = autoSkip;
    localStorage.setItem("yinzhan-auto-skip", autoSkip ? "1" : "0");
  }, [autoSkip]);

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
    // Match app chrome so resize / mini expand never flashes system white.
    void getCurrentWindow()
      .setBackgroundColor("#141210")
      .catch(() => undefined);
  }, []);

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
      const saved = localStorage.getItem("yinzhan-provider");
      if (saved && ordered.some((p) => p.id === saved)) {
        setProviderId(saved);
      } else if (ordered[0]) {
        setProviderId(ordered[0].id);
      }
    });
    refreshFavorites().catch(() => undefined);
  }, [refreshFavorites]);

  useEffect(() => {
    localStorage.setItem("yinzhan-provider", providerId);
  }, [providerId]);

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

  useEffect(() => {
    localStorage.setItem("yinzhan-shuffle", shuffle ? "1" : "0");
  }, [shuffle]);

  useEffect(() => {
    localStorage.setItem("yinzhan-repeat-v2", repeatMode);
  }, [repeatMode]);

  useEffect(() => {
    // Skip the first paint so we don't wipe a just-restored empty write.
    if (!queueReadyRef.current) {
      queueReadyRef.current = true;
      return;
    }
    if (queue.length === 0) {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify({ tracks: queue, index: queueIndex }),
    );
  }, [queue, queueIndex]);

  useEffect(() => {
    if (!lyricsOpen || !current) {
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
  }, [lyricsOpen, current]);

  const applyVolume = useCallback((vol: number, isMuted: boolean) => {
    const audio = audioRef.current;
    if (audio) audio.volume = isMuted ? 0 : vol;
  }, []);

  const playTrackAt = useCallback(async (tracks: Track[], index: number) => {
    const track = tracks[index];
    const audio = audioRef.current;
    if (!track || !audio) return;

    const gen = ++playGenRef.current;
    // New play attempt clears consecutive-fail lockout so manual clicks recover.
    failSkipRef.current = 0;
    setQueue(tracks);
    setQueueIndex(index);
    queueRef.current = tracks;
    queueIndexRef.current = index;
    setCurrent(track);
    setLoadingPlay(true);
    setPlaying(false);
    setPlayError(null);
    // Freeze timeupdate + hard-stop previous audio before any long resolve/download.
    suppressTimeRef.current = true;
    setProgress(0);
    setDuration(track.durationMs ? track.durationMs / 1000 : 0);
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      // ignore
    }

    try {
      const resolved = await api.resolvePlayUrl(track);
      if (gen !== playGenRef.current) return;
      // Prefer disk cache when warm; otherwise stream remote URL immediately.
      const src = resolved.localPath
        ? convertFileSrc(resolved.localPath)
        : resolved.url;
      if (!src) {
        throw new Error("未获取到可播地址");
      }
      audio.src = src;
      try {
        await audio.play();
      } catch {
        // After TTS / device churn, first play() can fail — one hard retry.
        if (gen !== playGenRef.current) return;
        audio.load();
        await audio.play();
      }
      if (gen !== playGenRef.current) return;
      failSkipRef.current = 0;
      suppressTimeRef.current = false;
      setProgress(audio.currentTime || 0);
    } catch (e) {
      if (gen !== playGenRef.current) return;
      suppressTimeRef.current = false;
      setPlaying(false);
      setPlayError(String(e).replace(/^Error:\s*/, ""));
      const canAdvance = index < tracks.length - 1 || repeatRef.current === "all";
      if (autoSkipRef.current && canAdvance && failSkipRef.current < 3) {
        failSkipRef.current += 1;
        window.setTimeout(() => {
          if (gen === playGenRef.current) {
            advanceRef.current(1);
          }
        }, 600);
      } else if (autoSkipRef.current && failSkipRef.current >= 3) {
        setPlayError("连续多首无法播放，已暂停");
        failSkipRef.current = 0;
      }
    } finally {
      if (gen === playGenRef.current) {
        setLoadingPlay(false);
      }
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

    const onTime = () => {
      if (suppressTimeRef.current) return;
      setProgress(audio.currentTime);
    };
    const onMeta = () => {
      const d = playbackDuration(audio);
      if (d > 0) setDuration(d);
    };
    const onDuration = () => {
      const d = playbackDuration(audio);
      if (d > 0) setDuration(d);
    };
    const onEnded = () => {
      // Seeking past a wrong metadata end used to fire `ended` and skip tracks.
      if (Date.now() < ignoreEndedUntilRef.current) return;
      const dur = playbackDuration(audio);
      if (dur > 0 && audio.currentTime < dur - 1.5) return;
      setPlaying(false);
      advanceRef.current(1, { fromEnded: true });
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onErr = () => {
      const gen = playGenRef.current;
      setPlaying(false);
      if (!autoSkipRef.current) {
        setPlayError("播放失败");
        return;
      }
      setPlayError("播放失败，尝试下一首…");
      if (failSkipRef.current >= 3) {
        setPlayError("连续多首无法播放，已暂停");
        failSkipRef.current = 0;
        return;
      }
      failSkipRef.current += 1;
      window.setTimeout(() => {
        if (gen === playGenRef.current) {
          advanceRef.current(1);
        }
      }, 500);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onErr);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onDuration);
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

  const onVoiceMusicHold = useCallback((hold: boolean, resume = true) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (hold) {
      voiceHoldPlayingRef.current = !audio.paused;
      if (!audio.paused) audio.pause();
      return;
    }
    if (resume && voiceHoldPlayingRef.current) {
      void audio.play().catch(() => undefined);
    }
    voiceHoldPlayingRef.current = false;
  }, []);

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
      // After restart the queue is restored but audio.src is empty.
      if (!audio.getAttribute("src") && queueRef.current.length > 0 && queueIndexRef.current >= 0) {
        void playTrackAtRef.current(queueRef.current, queueIndexRef.current);
        return;
      }
      void audio.play().catch(() => setPlayError("无法继续播放"));
    } else {
      audio.pause();
    }
  }, [current]);

  const onSeek = useCallback(
    (ratio: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const dur = playbackDuration(audio, current?.durationMs);
      if (dur <= 0) return;
      const target = clampSeekTime(audio, dur * Math.min(1, Math.max(0, ratio)));
      ignoreEndedUntilRef.current = Date.now() + 800;
      try {
        audio.currentTime = target;
        setProgress(target);
      } catch {
        // Some streams reject seeks; don't advance the queue.
      }
    },
    [current],
  );

  const seekToSeconds = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = clampSeekTime(audio, sec);
    ignoreEndedUntilRef.current = Date.now() + 800;
    try {
      audio.currentTime = target;
      setProgress(target);
    } catch {
      // ignore
    }
  }, []);

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
  }, [mini]);

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

  const onVoiceEnabled = useCallback((on: boolean) => {
    setVoiceEnabled(on);
    writeVoiceEnabled(on);
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
    queueRef.current = next;
  }, []);

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
    queueRef.current = next;
    void playTrackAtRef.current(next, next.length - 1);
  }, []);

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

  const voiceSwitchProvider = useCallback((provider: string) => {
    setProviderId(provider);
    setNav("charts");
  }, []);

  const voicePlayFavorites = useCallback(async () => {
    try {
      const items = await api.listFavorites();
      const tracks = uniqueTracks(
        items
          .map((i) => i.track)
          .filter((t) => t.playability !== "unavailable"),
      );
      if (!tracks.length) {
        await invoke("voice_speak", { text: "收藏夹还是空的" });
        return;
      }
      voiceFeedRef.current = { mode: "none", offset: 0 };
      playAll(tracks);
      await invoke("voice_speak", { text: `为你播放收藏里的${tracks.length}首歌` });
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
      onPrev: () => playPrev(),
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
        setVolume((v) => {
          const next = Math.min(1, Math.round((v + 0.1) * 100) / 100);
          if (next > 0) setMuted(false);
          return next;
        });
      },
      onVolumeDown: () => {
        setVolume((v) => Math.max(0, Math.round((v - 0.1) * 100) / 100));
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
    });
  }, [
    playNext,
    playPrev,
    togglePlay,
    toggleMute,
    onVoiceMusicHold,
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
      const target = clampSeekTime(audio, details.seekTime);
      ignoreEndedUntilRef.current = Date.now() + 800;
      audio.currentTime = target;
      setProgress(target);
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
                {providers.map((p) => (
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
            providers={providers}
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
            autoSkip={autoSkip}
            onAutoSkip={setAutoSkip}
            voiceEnabled={voiceEnabled}
            onVoiceEnabled={onVoiceEnabled}
            voiceStatusText={
              voiceEnabled
                ? voiceUi.detail ||
                  (voiceUi.status === "listening"
                    ? "正在聆听「小栈小栈」"
                    : voiceUi.status === "awake"
                      ? "在呢"
                      : voiceUi.status === "error"
                        ? "启动失败"
                        : "准备中…")
                : undefined
            }
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
                  : voiceUi.detail || "小栈聆听中"}
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
        onClose={() => setLyricsOpen(false)}
        onSeek={seekToSeconds}
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
