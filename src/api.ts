import { invoke } from "@tauri-apps/api/core";
import type {
  AudioQuality,
  Chart,
  FavoriteItem,
  PlayHistoryItem,
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
  chartTracks: (
    chartId: string,
    limit = 20,
    provider: string | null = null,
    offset = 0,
  ) => invoke<Track[]>("chart_tracks", { chartId, limit, provider, offset }),
  resolvePlayUrl: (track: Track, quality: AudioQuality = "high") =>
    invoke<PlayUrl>("resolve_play_url", {
      trackId: track.id,
      provider: track.provider,
      title: track.title,
      artist: track.artist,
      quality,
    }),
  getSearchHistory: (limit = 20) =>
    invoke<SearchHistoryItem[]>("get_search_history", { limit }),
  clearSearchHistory: () => invoke<void>("clear_search_history"),
  removeSearchHistory: (id: number) =>
    invoke<void>("remove_search_history", { id }),
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
      album: track.album ?? null,
      durationMs: track.durationMs ?? null,
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
  addPlayHistory: (track: Track) => invoke<void>("add_play_history", { track }),
  listPlayHistory: (limit = 100) =>
    invoke<PlayHistoryItem[]>("list_play_history", { limit }),
  clearPlayHistory: () => invoke<void>("clear_play_history"),
  voiceAssistantInfo: () => invoke<VoiceAssistantInfo>("voice_assistant_info"),
  startVoiceAssistant: () => invoke<void>("start_voice_assistant"),
  stopVoiceAssistant: () => invoke<void>("stop_voice_assistant"),
};

export interface VoiceAssistantInfo {
  running: boolean;
  backend: string;
  wakeWord: string;
  supported: boolean;
}

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
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—:—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
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
    case "qq":
      return "QQ音乐";
    case "audius":
      return "Audius";
    default:
      return id;
  }
}
