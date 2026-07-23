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

export interface ProviderInfo {
  id: string;
  name: string;
}

export type NavKey = "charts" | "search" | "favorites" | "history";
