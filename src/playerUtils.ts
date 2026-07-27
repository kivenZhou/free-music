import type { ProviderInfo, RepeatMode, Track } from "./types";

export const QUEUE_STORAGE_KEY = "yinzhan-queue-v1";
export const PROVIDER_ORDER_KEY = "yinzhan-provider-order";
export const NORMAL_MIN = { width: 900, height: 600 };
export const MINI_SIZE = { width: 480, height: 96 };

export function loadProviderOrder(): string[] {
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

export function sortProvidersByOrder(
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

export function loadStoredQueue(): { tracks: Track[]; index: number } | null {
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

export function readStoredVolume(): number {
  const raw = localStorage.getItem("yinzhan-volume");
  if (raw == null) return 0.85;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.85;
}

export function readStoredRepeat(): RepeatMode {
  // v2: default list-loop (was "off", which auto-persisted on first launch).
  const raw = localStorage.getItem("yinzhan-repeat-v2");
  if (raw === "all" || raw === "one" || raw === "off") return raw;
  return "all";
}

export function shuffleTracks(list: Track[], preferIndex = 0): Track[] {
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
export function playbackDuration(
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

export function clampSeekTime(audio: HTMLAudioElement, sec: number): number {
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
