import { invoke } from "@tauri-apps/api/core";
import type {
  Chart,
  FavoriteItem,
  PlayUrl,
  ProviderInfo,
  SearchHistoryItem,
  Track,
} from "./types";

export const api = {
  listProviders: () => invoke<ProviderInfo[]>("list_providers"),
  searchTracks: (query: string, limit = 30, provider: string | null = "all") =>
    invoke<Track[]>("search_tracks", { query, limit, provider }),
  listCharts: (provider: string | null = null) =>
    invoke<Chart[]>("list_charts", { provider }),
  chartTracks: (chartId: string, limit = 40, provider: string | null = null) =>
    invoke<Track[]>("chart_tracks", { chartId, limit, provider }),
  resolvePlayUrl: (track: Track) =>
    invoke<PlayUrl>("resolve_play_url", {
      trackId: track.id,
      provider: track.provider,
      title: track.title,
      artist: track.artist,
    }),
  getSearchHistory: (limit = 20) =>
    invoke<SearchHistoryItem[]>("get_search_history", { limit }),
  clearSearchHistory: () => invoke<void>("clear_search_history"),
  addFavorite: (track: Track) => invoke<void>("add_favorite", { track }),
  removeFavorite: (provider: string, trackId: string) =>
    invoke<void>("remove_favorite", { provider, trackId }),
  listFavorites: () => invoke<FavoriteItem[]>("list_favorites"),
  isFavorite: (provider: string, trackId: string) =>
    invoke<boolean>("is_favorite", { provider, trackId }),
};

export function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—:—";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function providerLabel(id: string): string {
  switch (id) {
    case "kuwo":
      return "酷我";
    case "netease":
      return "网易云";
    case "kugou":
      return "酷狗";
    case "bilibili":
      return "B站";
    case "youtube":
      return "YouTube";
    case "migu":
      return "咪咕";
    default:
      return id;
  }
}
