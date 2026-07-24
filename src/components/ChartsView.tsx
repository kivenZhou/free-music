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
  setChartScroll,
  setProviderActive,
  setProviderCharts,
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
  kr: "韩国",
  jp: "日本",
  us: "欧美",
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

/** Charts share one pane scroller; always use `.view-pane.on`. */
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  return (
    (el?.closest(".view-pane") as HTMLElement | null) ??
    (document.querySelector(".view-pane.on") as HTMLElement | null)
  );
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
  const panelRef = useRef<HTMLElement | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const providerIdRef = useRef(providerId);

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
    const scroller = getScrollParent(panelRef.current);
    return scroller?.scrollTop ?? 0;
  }, []);

  const persistCurrent = useCallback(() => {
    const id = providerIdRef.current;
    const chartId = activeRef.current;
    if (chartsRef.current.length > 0) {
      setProviderCharts(id, chartsRef.current, chartId);
    }
    if (!chartId || tracksRef.current.length === 0) return;
    setChartPage(
      id,
      chartId,
      tracksRef.current,
      hasMoreRef.current,
      readScrollTop(),
    );
  }, [readScrollTop]);

  const applyPage = useCallback(
    (
      provider: string,
      chartId: string,
      list: Track[],
      more: boolean,
      scrollTop?: number,
    ) => {
      // Clone so React always commits when restoring the same cache array ref.
      setTracks([...list]);
      setHasMore(more);
      setChartPage(provider, chartId, list, more, scrollTop);
      setProviderActive(provider, chartId);
      if (scrollTop != null) {
        pendingScrollRef.current = scrollTop;
      }
    },
    [],
  );

  const fetchTracksFor = useCallback(
    async (provider: string, chartId: string, opts?: { force?: boolean }) => {
      if (!opts?.force) {
        const cached = getChartPage(provider, chartId);
        if (cached && cached.tracks.length > 0) {
          setActive(chartId);
          applyPage(
            provider,
            chartId,
            cached.tracks,
            cached.hasMore,
            cached.scrollTop,
          );
          setLoading(false);
          setLoadingMore(false);
          setError(null);
          return;
        }
      }

      const key = reqKey(provider, chartId);
      inflightKey.current = key;
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      pendingScrollRef.current = 0;
      try {
        const res = await api.chartTracks(chartId, PAGE_SIZE, provider, 0);
        if (inflightKey.current !== key) return;
        const more = res.length >= PAGE_SIZE;
        applyPage(provider, chartId, res, more, 0);
      } catch (e) {
        if (inflightKey.current !== key) return;
        setError(String(e).replace(/^Error:\s*/, ""));
      } finally {
        if (inflightKey.current === key) {
          setLoading(false);
        }
      }
    },
    [applyPage],
  );

  const loadMore = useCallback(async () => {
    if (!active || loading || loadingMore || !hasMore) return;
    const provider = providerId;
    const chartId = active;
    const key = reqKey(provider, chartId);
    const offset = tracks.length;
    inflightKey.current = key;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api.chartTracks(chartId, PAGE_SIZE, provider, offset);
      if (inflightKey.current !== key) return;
      if (res.length === 0) {
        setHasMore(false);
        setChartPage(
          provider,
          chartId,
          tracksRef.current,
          false,
          readScrollTop(),
        );
        return;
      }
      const seen = new Set(tracks.map(trackKey));
      const fresh = res.filter((t) => !seen.has(trackKey(t)));
      if (fresh.length === 0) {
        setHasMore(false);
        setChartPage(
          provider,
          chartId,
          tracksRef.current,
          false,
          readScrollTop(),
        );
        return;
      }
      const merged = (() => {
        const keys = new Set(tracksRef.current.map(trackKey));
        return [
          ...tracksRef.current,
          ...fresh.filter((t) => !keys.has(trackKey(t))),
        ];
      })();
      const more = res.length >= PAGE_SIZE;
      applyPage(provider, chartId, merged, more, readScrollTop());
    } catch (e) {
      if (inflightKey.current !== key) return;
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      if (inflightKey.current === key) {
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
  ]);

  // Persist snapshot (tracks + scroll) before leaving a provider.
  useEffect(() => {
    return () => {
      persistCurrent();
    };
  }, [providerId, persistCurrent]);

  // Keep scrollTop fresh while the user scrolls this pane.
  useEffect(() => {
    const scroller = getScrollParent(panelRef.current);
    if (!scroller) return;

    const onScroll = () => {
      const chartId = activeRef.current;
      if (!chartId) return;
      setChartScroll(providerIdRef.current, chartId, scroller.scrollTop);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      // Flush latest position when detaching / switching.
      const chartId = activeRef.current;
      if (chartId && tracksRef.current.length > 0) {
        setChartScroll(providerIdRef.current, chartId, scroller.scrollTop);
      }
    };
  }, [providerId, active]);

  // Restore scroll after tracks paint.
  useLayoutEffect(() => {
    if (pendingScrollRef.current == null) return;
    const top = pendingScrollRef.current;
    pendingScrollRef.current = null;
    const scroller = getScrollParent(panelRef.current);
    if (!scroller) return;
    scroller.scrollTop = top;
    // Second frame: list height may settle after layout.
    window.requestAnimationFrame(() => {
      scroller.scrollTop = top;
    });
  }, [tracks, providerId, active]);

  // Provider bootstrap — restore session cache when possible.
  useEffect(() => {
    const epoch = ++providerEpoch.current;
    const forProvider = providerId;
    inflightKey.current = null;
    setError(null);
    setLoadingMore(false);

    const cachedProvider = getProviderCharts(forProvider);
    if (cachedProvider && cachedProvider.charts.length > 0) {
      const firstId =
        cachedProvider.activeId &&
        cachedProvider.charts.some((c) => c.id === cachedProvider.activeId)
          ? cachedProvider.activeId
          : (cachedProvider.charts[0]?.id ?? null);

      setCharts(cachedProvider.charts);
      setActive(firstId);

      if (!firstId) {
        setTracks([]);
        setHasMore(false);
        setLoading(false);
        pendingScrollRef.current = 0;
        return;
      }

      const cachedPage = getChartPage(forProvider, firstId);
      if (cachedPage && cachedPage.tracks.length > 0) {
        applyPage(
          forProvider,
          firstId,
          cachedPage.tracks,
          cachedPage.hasMore,
          cachedPage.scrollTop,
        );
        setLoading(false);
        return;
      }

      setTracks([]);
      setHasMore(false);
      setLoading(true);
      pendingScrollRef.current = 0;
      void fetchTracksFor(forProvider, firstId);
      return;
    }

    setCharts([]);
    setActive(null);
    setTracks([]);
    setHasMore(false);
    setLoading(true);
    pendingScrollRef.current = 0;

    (async () => {
      try {
        const list = await api.listCharts(forProvider);
        if (epoch !== providerEpoch.current) return;

        setCharts(list);
        const firstId = list[0]?.id ?? null;
        setActive(firstId);
        setProviderCharts(forProvider, list, firstId);

        if (!firstId) {
          setTracks([]);
          setLoading(false);
          return;
        }

        await fetchTracksFor(forProvider, firstId);
      } catch (e) {
        if (epoch !== providerEpoch.current) return;
        setCharts([]);
        setTracks([]);
        setActive(null);
        setHasMore(false);
        setError(String(e).replace(/^Error:\s*/, ""));
        setLoading(false);
      }
    })();

    return () => {
      providerEpoch.current += 1;
      inflightKey.current = null;
    };
  }, [providerId, fetchTracksFor, applyPage]);

  const debounceRef = useRef<number | null>(null);

  const selectChart = useCallback(
    (chartId: string) => {
      if (chartId === active && !loading) return;

      // Flush current tab (incl. scroll) into cache before leaving.
      if (active && tracksRef.current.length > 0) {
        setChartPage(
          providerId,
          active,
          tracksRef.current,
          hasMoreRef.current,
          readScrollTop(),
        );
      }

      setActive(chartId);
      setProviderActive(providerId, chartId);

      const cached = getChartPage(providerId, chartId);
      if (cached && cached.tracks.length > 0) {
        applyPage(
          providerId,
          chartId,
          cached.tracks,
          cached.hasMore,
          cached.scrollTop,
        );
        setLoading(false);
        setError(null);
        return;
      }

      setHasMore(false);
      pendingScrollRef.current = 0;
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void fetchTracksFor(providerId, chartId);
      }, 180);
    },
    [active, loading, fetchTracksFor, providerId, applyPage, readScrollTop],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const current = charts.find((c) => c.id === active);
  const showList = !loading || tracks.length > 0;

  return (
    <section className="panel" ref={panelRef}>
      <header className="panel-head row">
        <div>
          <p className="eyebrow">Charts · {providerLabel(providerId)}</p>
          <h1>榜单</h1>
          {current ? <p className="panel-desc">{current.description}</p> : null}
        </div>
        <div className="panel-actions">
          {loading ? (
            <span className="panel-head-meta">加载中…</span>
          ) : tracks.length > 0 ? (
            <span className="panel-head-meta">{tracks.length} 首</span>
          ) : null}
          {!loading && tracks.length > 0 ? (
            <button
              type="button"
              className="play-all-btn"
              onClick={() => onPlayAll(tracks)}
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
              {tracks.length === 0 ? "重新加载" : "刷新"}
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

      {error ? <div className="error-banner">{error}</div> : null}
      {loading && tracks.length === 0 ? (
        <div className="empty">正在加载可免费完整播放的歌曲…</div>
      ) : null}
      {showList && !(loading && tracks.length === 0) ? (
        <div className={loading ? "list-dim" : undefined}>
          <SongList
            tracks={tracks}
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
          ) : tracks.length > 0 && !loading ? (
            <p className="load-more-end">已加载全部</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
