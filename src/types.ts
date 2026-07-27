export type Playability = "full" | "preview" | "unavailable";

export interface Track {
  id: string;
  provider: string;
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  durationMs?: number | null;
  playability: Playability;
}

export interface PlayUrl {
  url: string;
  localPath?: string | null;
  playability: Playability;
  quality?: string | null;
  expiresHint?: string | null;
}

export interface Chart {
  id: string;
  name: string;
  region: string;
  description: string;
}

export interface SearchHistoryItem {
  id: number;
  query: string;
  searchedAt: string;
}

export interface FavoriteItem {
  id: number;
  track: Track;
  favoritedAt: string;
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  trackCount: number;
}

export interface PlaylistTrackItem {
  id: number;
  track: Track;
  addedAt: string;
}

export interface PlayHistoryItem {
  id: number;
  track: Track;
  playedAt: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
}

export type NavKey =
  | "charts"
  | "search"
  | "favorites"
  | "history"
  | "playlists"
  | "settings";

export type RepeatMode = "off" | "all" | "one";

/** App chrome theme. */
export type ThemeMode = "dark" | "light";

/**
 * Preferred stream bitrate. Providers fall back when a tier is unavailable.
 * - standard ≈ 128kbps
 * - high ≈ 192–320kbps
 * - highest tries the best free tier first
 */
export type AudioQuality = "standard" | "high" | "highest";
