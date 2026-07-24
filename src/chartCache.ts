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

export function getChartPage(provider: string, chartId: string): ChartPageCache | null {
  return pageCache.get(chartCacheKey(provider, chartId)) ?? null;
}

export function setChartPage(
  provider: string,
  chartId: string,
  tracks: Track[],
  hasMore: boolean,
  scrollTop?: number,
) {
  const key = chartCacheKey(provider, chartId);
  const prev = pageCache.get(key);
  pageCache.set(key, {
    tracks,
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
