import type { Chart, Track } from "./types";

export type ChartPageCache = {
  tracks: Track[];
  hasMore: boolean;
  scrollTop: number;
  updatedAt: number;
};

export type ProviderChartsCache = {
  charts: Chart[];
  activeId: string | null;
};

/** In-memory session cache — survives provider/tab switches without re-hitting APIs. */
const pageCache = new Map<string, ChartPageCache>();
const providerCache = new Map<string, ProviderChartsCache>();

export function chartCacheKey(provider: string, chartId: string) {
  return `${provider}::${chartId}`;
}

/** Drop tracks that don't belong to this provider (guards cross-source cache pollution). */
export function tracksForProvider(provider: string, tracks: Track[]): Track[] {
  return tracks.filter((t) => t.provider === provider);
}

export function getChartPage(provider: string, chartId: string): ChartPageCache | null {
  const cached = pageCache.get(chartCacheKey(provider, chartId));
  if (!cached) return null;
  const tracks = tracksForProvider(provider, cached.tracks);
  if (tracks.length === 0) {
    // Polluted / empty entry — force a refetch next time.
    pageCache.delete(chartCacheKey(provider, chartId));
    return null;
  }
  if (tracks.length !== cached.tracks.length) {
    const cleaned = { ...cached, tracks, updatedAt: Date.now() };
    pageCache.set(chartCacheKey(provider, chartId), cleaned);
    return cleaned;
  }
  return cached;
}

export function setChartPage(
  provider: string,
  chartId: string,
  tracks: Track[],
  hasMore: boolean,
  scrollTop?: number,
) {
  const owned = tracksForProvider(provider, tracks);
  // Never persist another provider's songs under this key.
  if (owned.length === 0 && tracks.length > 0) return;

  const key = chartCacheKey(provider, chartId);
  const prev = pageCache.get(key);
  pageCache.set(key, {
    tracks: owned,
    hasMore,
    scrollTop: scrollTop ?? prev?.scrollTop ?? 0,
    updatedAt: Date.now(),
  });
}

export function setChartScroll(provider: string, chartId: string, scrollTop: number) {
  const key = chartCacheKey(provider, chartId);
  const prev = pageCache.get(key);
  if (!prev) {
    pageCache.set(key, {
      tracks: [],
      hasMore: false,
      scrollTop,
      updatedAt: Date.now(),
    });
    return;
  }
  pageCache.set(key, { ...prev, scrollTop, updatedAt: Date.now() });
}

export function getProviderCharts(provider: string): ProviderChartsCache | null {
  return providerCache.get(provider) ?? null;
}

export function setProviderCharts(
  provider: string,
  charts: Chart[],
  activeId: string | null,
) {
  providerCache.set(provider, { charts, activeId });
}

export function setProviderActive(provider: string, activeId: string | null) {
  const prev = providerCache.get(provider);
  if (!prev) return;
  providerCache.set(provider, { ...prev, activeId });
}
