import { invoke } from "@tauri-apps/api/core";
import type {
  Chart,
  FavoriteItem,
  Playlist,
  PlaylistTrackItem,
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
  getCacheStats: () => invoke<CacheStats>("get_cache_stats"),
  clearAudioCache: () => invoke<CacheStats>("clear_audio_cache"),
  fetchLyrics: (track: Track) =>
    invoke<LyricsPayload>("fetch_lyrics", {
      trackId: track.id,
      provider: track.provider,
      title: track.title,
      artist: track.artist,
    }),
  listPlaylists: () => invoke<Playlist[]>("list_playlists"),
  createPlaylist: (name: string) => invoke<Playlist>("create_playlist", { name }),
  renamePlaylist: (id: number, name: string) =>
    invoke<void>("rename_playlist", { id, name }),
  deletePlaylist: (id: number) => invoke<void>("delete_playlist", { id }),
  listPlaylistTracks: (playlistId: number) =>
    invoke<PlaylistTrackItem[]>("list_playlist_tracks", { playlistId }),
  addToPlaylist: (playlistId: number, track: Track) =>
    invoke<void>("add_to_playlist", { playlistId, track }),
  removeFromPlaylist: (playlistId: number, provider: string, trackId: string) =>
    invoke<void>("remove_from_playlist", { playlistId, provider, trackId }),
};

export interface CacheStats {
  sizeBytes: number;
  fileCount: number;
  path: string;
}

export interface LyricsPayload {
  lrc?: string | null;
  translatedLrc?: string | null;
  source: string;
}

export function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—:—";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
    default:
      return id;
  }
}
