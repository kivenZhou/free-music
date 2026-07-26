import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Play } from "lucide-react";
import { api, providerLabel } from "../api";
import {
  getChartPage,
  getProviderCharts,
  setChartPage,
  setProviderActive,
  setProviderCharts,
  tracksForProvider,
  rememberScroll,
  resolveScroll,
} from "../chartCache";
import type { Chart, Track } from "../types";
import { SongList } from "./SongList";

interface Props {
  providerId: string;
  favoriteKeys: Set<string>;
  currentKey?: string | null;
  playing?: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onTogglePlay?: () => void;
  onPlayAll: (tracks: Track[]) => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
}

const PAGE_SIZE = 20;

const REGION_LABEL: Record<string, string> = {
  cn: "国内",
  hk: "港台",
  kr: "韩国",
  jp: "日本",
  us: "欧美",
  global: "全球",
  bilibili: "B站",
};

function regionBadge(region: string): string | null {
  return REGION_LABEL[region] ?? null;
}

function reqKey(provider: string, chartId: string) {
  return `${provider}::${chartId}`;
}

function trackKey(t: Track) {
  return `${t.provider}:${t.id}`;
}

export function ChartsView({
  providerId,
  favoriteKeys,
  currentKey,
  playing,
  onPlay,
  onTogglePlay,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onToggleFavorite,
}: Props) {
  const [charts, setCharts] = useState<Chart[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Only the latest in-flight request may commit UI state. */
  const inflightKey = useRef<string | null>(null);
  const providerEpoch = useRef(0);
  const tracksRef = useRef<Track[]>([]);
  const hasMoreRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  const chartsRef = useRef<Chart[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const providerIdRef = useRef(providerId);
  const debounceRef = useRef<number | null>(null);
  /** Provider id that currently owns the visible tracks (guards stale apply). */
  const tracksOwnerRef = useRef<string | null>(null);
  /** Latest scrollTop for the visible list — don't rely on DOM during provider teardown. */
  const scrollTopRef = useRef(0);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    chartsRef.current = charts;
  }, [charts]);
  useEffect(() => {
    providerIdRef.current = providerId;
  }, [providerId]);

  const readScrollTop = useCallback(() => {
    return scrollRef.current?.scrollTop ?? 0;
  }, []);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const isLive = useCallback((provider: string, chartId?: string | null) => {
    if (providerIdRef.current !== provider) return false;
    if (chartId != null && activeRef.current !== chartId) return false;
    return true;
  }, []);

  /** Persist one provider's current list into the session cache. */
  // (snapshot happens in useLayoutEffect on provider change — see below)

  const applyPage = useCallback(
    (
      provider: string,
      chartId: string,
      list: Track[],
      more: boolean,
      scrollTop?: number,
      opts?: { updateUi?: boolean; forceUi?: boolean },
    ) => {
      const owned = tracksForProvider(provider, list);
      // Prefer explicit scroll, then this provider's remembered position (0 is valid).
      const top =
        scrollTop != null ? scrollTop : resolveScroll(provider, chartId);
      // Only overwrite cache with real data — an empty fetch must not wipe a good page.
      if (owned.length > 0) {
        setChartPage(provider, chartId, owned, more, top);
        rememberScroll(provider, chartId, top);
      }
      setProviderActive(provider, chartId);

      const updateUi = opts?.updateUi !== false;
      if (!updateUi) return;
      // forceUi: bootstrap restore runs before activeRef catches up via useEffect.
      if (!opts?.forceUi && !isLive(provider, chartId)) return;

      tracksOwnerRef.current = provider;
      activeRef.current = chartId;
      providerIdRef.current = provider;
      setTracks([...owned]);
      setHasMore(owned.length > 0 && more);
      scrollTopRef.current = top;
      // Always schedule restore — including 0, so we don't keep the previous
      // provider's scrollTop on the shared panel-body.
      pendingScrollRef.current = top;
    },
    [isLive],
  );

  const fetchTracksFor = useCallback(
    async (provider: string, chartId: string, opts?: { force?: boolean }) => {
      if (!opts?.force) {
        const cached = getChartPage(provider, chartId);
        if (cached && cached.tracks.length > 0) {
          if (providerIdRef.current !== provider) return;
          activeRef.current = chartId;
          setActive(chartId);
          const top = resolveScroll(provider, chartId, cached.scrollTop);
          applyPage(
            provider,
            chartId,
            cached.tracks,
            cached.hasMore,
            top,
            { forceUi: true },
          );
          setLoading(false);
          setLoadingMore(false);
          setError(null);
          return;
        }
      }

      const key = reqKey(provider, chartId);
      inflightKey.current = key;
      if (isLive(provider)) {
        setLoading(true);
        setLoadingMore(false);
        setError(null);
        pendingScrollRef.current = 0;
      }
      try {
        const res = await api.chartTracks(chartId, PAGE_SIZE, provider, 0);
        const owned = tracksForProvider(provider, res);
        const more = owned.length >= PAGE_SIZE;
        // Always cache this provider/chart result; only update UI if still current.
        // (Prevents losing a good response when the user briefly switched away.)
        applyPage(provider, chartId, owned, more, 0, {
          updateUi:
            inflightKey.current === key && isLive(provider, chartId),
        });
        if (
          inflightKey.current === key &&
          isLive(provider, chartId) &&
          owned.length === 0
        ) {
          setError("暂时没有拿到歌曲，请稍后再点「重新加载」");
        }
      } catch (e) {
        if (inflightKey.current === key && isLive(provider, chartId)) {
          setError(String(e).replace(/^Error:\s*/, ""));
        }
      } finally {
        if (inflightKey.current === key && isLive(provider, chartId)) {
          setLoading(false);
        }
      }
    },
    [applyPage, isLive],
  );

  const loadMore = useCallback(async () => {
    if (!active || loading || loadingMore || !hasMore) return;
    const provider = providerId;
    const chartId = active;
    if (tracksOwnerRef.current !== provider) return;
    const key = reqKey(provider, chartId);
    const offset = tracks.length;
    inflightKey.current = key;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api.chartTracks(chartId, PAGE_SIZE, provider, offset);
      if (inflightKey.current !== key || !isLive(provider, chartId)) return;
      if (res.length === 0) {
        setHasMore(false);
        setChartPage(
          provider,
          chartId,
          tracksForProvider(provider, tracksRef.current),
          false,
          readScrollTop(),
        );
        return;
      }
      const ownedFresh = tracksForProvider(provider, res);
      const seen = new Set(tracksRef.current.map(trackKey));
      const fresh = ownedFresh.filter((t) => !seen.has(trackKey(t)));
      if (fresh.length === 0) {
        setHasMore(false);
        setChartPage(
          provider,
          chartId,
          tracksForProvider(provider, tracksRef.current),
          false,
          readScrollTop(),
        );
        return;
      }
      const merged = [...tracksRef.current, ...fresh];
      const more = res.length >= PAGE_SIZE;
      applyPage(provider, chartId, merged, more, readScrollTop());
    } catch (e) {
      if (inflightKey.current !== key) return;
      if (isLive(provider, chartId)) {
        setError(String(e).replace(/^Error:\s*/, ""));
      }
    } finally {
      if (inflightKey.current === key && isLive(provider, chartId)) {
        setLoadingMore(false);
      }
    }
  }, [
    active,
    loading,
    loadingMore,
    hasMore,
    providerId,
    tracks,
    applyPage,
    readScrollTop,
    isLive,
  ]);

  // Snapshot scroll + list BEFORE paint effects clear content.
  // Important: this must be useLayoutEffect — useEffect runs after a paint where
  // playableTracks was already filtered empty for the new provider (scroll → 0).
  const prevProviderRef = useRef(providerId);
  useLayoutEffect(() => {
    const prev = prevProviderRef.current;
    if (prev === providerId) return;

    const chartId = activeRef.current;
    const top = scrollRef.current?.scrollTop ?? scrollTopRef.current;
    if (
      chartId &&
      tracksOwnerRef.current === prev &&
      tracksRef.current.length > 0
    ) {
      scrollTopRef.current = top;
      rememberScroll(prev, chartId, top);
      if (chartsRef.current.length > 0) {
        setProviderCharts(prev, chartsRef.current, chartId);
      }
      setChartPage(
        prev,
        chartId,
        tracksForProvider(prev, tracksRef.current),
        hasMoreRef.current,
        top,
      );
    }
    prevProviderRef.current = providerId;
  }, [providerId]);

  // Cancel in-flight debounce when leaving a provider.
  useEffect(() => {
    return () => {
      clearDebounce();
    };
  }, [providerId, clearDebounce]);

  // Keep scrollTop fresh while the user scrolls the list body.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const onScroll = () => {
      const chartId = activeRef.current;
      const provider = tracksOwnerRef.current ?? providerIdRef.current;
      if (!chartId || tracksOwnerRef.current !== provider) return;
      const top = scroller.scrollTop;
      scrollTopRef.current = top;
      rememberScroll(provider, chartId, top);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      const chartId = activeRef.current;
      const provider = tracksOwnerRef.current;
      if (chartId && provider && tracksRef.current.length > 0) {
        const top = scroller.scrollTop;
        scrollTopRef.current = top;
        rememberScroll(provider, chartId, top);
      }
    };
  }, [providerId, active]);

  // Restore scroll after tracks paint. Must apply 0 too — shared scroller would
  // otherwise keep the previous provider's offset.
  useLayoutEffect(() => {
    const top = pendingScrollRef.current;
    if (top == null) return;
    const scroller = scrollRef.current;
    if (!scroller) return;

    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      scroller.scrollTop = top;
      scrollTopRef.current = top;
    };
    apply();
    const raf1 = window.requestAnimationFrame(() => {
      apply();
      window.requestAnimationFrame(apply);
    });
    const timer = window.setTimeout(() => {
      apply();
      if (Math.abs(scroller.scrollTop - top) < 2) {
        pendingScrollRef.current = null;
      }
    }, 100);
    const timer2 = window.setTimeout(() => {
      apply();
      pendingScrollRef.current = null;
    }, 250);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(timer);
      window.clearTimeout(timer2);
    };
  }, [tracks, providerId, active]);
  // Provider bootstrap — restore session cache when possible (no network).
  useEffect(() => {
    const epoch = ++providerEpoch.current;
    const forProvider = providerId;
    clearDebounce();
    inflightKey.current = null;
    setError(null);
    setLoadingMore(false);

    // Keep refs in sync immediately — downstream isLive/applyPage depend on them.
    providerIdRef.current = forProvider;

    const cachedProvider = getProviderCharts(forProvider);
    if (cachedProvider && cachedProvider.charts.length > 0) {
      const firstId =
        cachedProvider.activeId &&
        cachedProvider.charts.some((c) => c.id === cachedProvider.activeId)
          ? cachedProvider.activeId
          : (cachedProvider.charts[0]?.id ?? null);

      setCharts(cachedProvider.charts);
      chartsRef.current = cachedProvider.charts;
      setActive(firstId);
      activeRef.current = firstId;

      if (!firstId) {
        tracksOwnerRef.current = forProvider;
        setTracks([]);
        setHasMore(false);
        setLoading(false);
        pendingScrollRef.current = 0;
        return;
      }

      const cachedPage = getChartPage(forProvider, firstId);
      if (cachedPage && cachedPage.tracks.length > 0) {
        const top = resolveScroll(forProvider, firstId, cachedPage.scrollTop);
        applyPage(
          forProvider,
          firstId,
          cachedPage.tracks,
          cachedPage.hasMore,
          top,
          { forceUi: true },
        );
        setLoading(false);
        return;
      }

      // Charts meta cached but page missing — fetch once.
      tracksOwnerRef.current = forProvider;
      setTracks([]);
      setHasMore(false);
      setLoading(true);
      pendingScrollRef.current = 0;
      void fetchTracksFor(forProvider, firstId);
      return;
    }

    tracksOwnerRef.current = forProvider;
    setCharts([]);
    setActive(null);
    activeRef.current = null;
    setTracks([]);
    setHasMore(false);
    setLoading(true);
    pendingScrollRef.current = 0;

    (async () => {
      try {
        const list = await api.listCharts(forProvider);
        if (epoch !== providerEpoch.current || providerIdRef.current !== forProvider) {
          return;
        }

        setCharts(list);
        chartsRef.current = list;
        const firstId = list[0]?.id ?? null;
        setActive(firstId);
        activeRef.current = firstId;
        setProviderCharts(forProvider, list, firstId);

        if (!firstId) {
          setTracks([]);
          setLoading(false);
          return;
        }

        await fetchTracksFor(forProvider, firstId);
      } catch (e) {
        if (epoch !== providerEpoch.current || providerIdRef.current !== forProvider) {
          return;
        }
        setCharts([]);
        setTracks([]);
        setActive(null);
        activeRef.current = null;
        setHasMore(false);
        setError(String(e).replace(/^Error:\s*/, ""));
        setLoading(false);
      }
    })();

    return () => {
      providerEpoch.current += 1;
      inflightKey.current = null;
      clearDebounce();
    };
  }, [providerId, fetchTracksFor, applyPage, clearDebounce]);

  const selectChart = useCallback(
    (chartId: string) => {
      if (chartId === active && !loading) return;
      const provider = providerId;

      // Flush current tab only when list still belongs to this provider+chart.
      if (
        active &&
        tracksOwnerRef.current === provider &&
        tracksRef.current.length > 0
      ) {
        setChartPage(
          provider,
          active,
          tracksForProvider(provider, tracksRef.current),
          hasMoreRef.current,
          readScrollTop(),
        );
      }

      clearDebounce();
      setActive(chartId);
      activeRef.current = chartId;
      setProviderActive(provider, chartId);
      inflightKey.current = null;

      const cached = getChartPage(provider, chartId);
      if (cached && cached.tracks.length > 0) {
        const top = resolveScroll(provider, chartId, cached.scrollTop);
        applyPage(
          provider,
          chartId,
          cached.tracks,
          cached.hasMore,
          top,
          { forceUi: true },
        );
        setLoading(false);
        setError(null);
        return;
      }

      // Clear immediately so we never show the previous chart's songs under a new tab.
      tracksOwnerRef.current = provider;
      setTracks([]);
      setHasMore(false);
      setLoading(true);
      setError(null);
      pendingScrollRef.current = 0;

      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        if (providerIdRef.current !== provider || activeRef.current !== chartId) {
          return;
        }
        void fetchTracksFor(provider, chartId);
      }, 180);
    },
    [
      active,
      loading,
      fetchTracksFor,
      providerId,
      applyPage,
      readScrollTop,
      clearDebounce,
    ],
  );

  useEffect(() => {
    return () => {
      clearDebounce();
    };
  }, [clearDebounce]);

  const current = charts.find((c) => c.id === active);
  const showList = !loading || tracks.length > 0;
  // While providerId has changed but tracks haven't swapped yet, keep showing the
  // old list — otherwise the body collapses and scrollTop resets to 0 before we
  // can snapshot it in the layout effect above.
  const listOwner =
    tracks.length > 0 &&
    tracksOwnerRef.current &&
    tracksOwnerRef.current !== providerId
      ? tracksOwnerRef.current
      : providerId;
  const playableTracks = tracksForProvider(listOwner, tracks);

  return (
    <section className="panel">
      <header className="panel-head row">
        <div>
          <p className="eyebrow">Charts · {providerLabel(providerId)}</p>
          <h1>榜单</h1>
          {current ? <p className="panel-desc">{current.description}</p> : null}
        </div>
        <div className="panel-actions">
          {loading ? (
            <span className="panel-head-meta">加载中…</span>
          ) : playableTracks.length > 0 ? (
            <span className="panel-head-meta">{playableTracks.length} 首</span>
          ) : null}
          {!loading && playableTracks.length > 0 ? (
            <button
              type="button"
              className="play-all-btn"
              onClick={() => onPlayAll(playableTracks)}
            >
              <Play size={14} fill="currentColor" />
              全部播放
            </button>
          ) : null}
          {!loading && active ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                void fetchTracksFor(providerId, active, { force: true })
              }
              title="忽略缓存，重新拉取"
            >
              {playableTracks.length === 0 ? "重新加载" : "刷新"}
            </button>
          ) : null}
        </div>
      </header>

      {charts.length > 0 ? (
        <div className="chart-tabs" role="tablist" aria-label="分类">
          {charts.map((c) => {
            const badge = regionBadge(c.region);
            return (
              <button
                key={c.id}
                type="button"
                className={`chart-tab ${active === c.id ? "on" : ""}`}
                onClick={() => selectChart(c.id)}
              >
                {c.name}
                {badge ? <span>{badge}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="panel-body" ref={scrollRef}>
        {error ? <div className="error-banner">{error}</div> : null}
        {loading && playableTracks.length === 0 ? (
          <div className="empty">正在加载可免费完整播放的歌曲…</div>
        ) : null}
        {showList && !(loading && playableTracks.length === 0) ? (
          <div className={loading ? "list-dim" : undefined}>
            <SongList
              tracks={playableTracks}
              currentKey={currentKey}
              playing={playing}
              favoriteKeys={favoriteKeys}
              onPlay={onPlay}
              onTogglePlay={onTogglePlay}
              onPlayNext={onPlayNext}
              onAddToQueue={onAddToQueue}
              onAddToPlaylist={onAddToPlaylist}
              onToggleFavorite={onToggleFavorite}
              hideProvider
            />
            {hasMore ? (
              <div className="load-more-wrap">
                <button
                  type="button"
                  className="ghost-btn load-more-btn"
                  disabled={loadingMore || loading}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              </div>
            ) : playableTracks.length > 0 && !loading ? (
              <p className="load-more-end">已加载全部</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
