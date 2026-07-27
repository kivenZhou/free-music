import type { AudioQuality, ProviderInfo, RepeatMode, Track } from "./types";

export const QUEUE_STORAGE_KEY = "yinzhan-queue-v1";
export const PROVIDER_ORDER_KEY = "yinzhan-provider-order";
export const AUDIO_QUALITY_KEY = "yinzhan-audio-quality";
export const NORMAL_MIN = { width: 900, height: 600 };
export const MINI_SIZE = { width: 480, height: 96 };

export const AUDIO_QUALITY_OPTIONS: {
  id: AudioQuality;
  label: string;
  hint: string;
}[] = [
  { id: "standard", label: "标准", hint: "约 128kbps，省流量" },
  { id: "high", label: "较高", hint: "约 192–320kbps" },
  { id: "highest", label: "最高", hint: "优先最高可用免费音质" },
];

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

export function readStoredAudioQuality(): AudioQuality {
  const raw = localStorage.getItem(AUDIO_QUALITY_KEY);
  if (raw === "standard" || raw === "high" || raw === "highest") return raw;
  return "high";
}

export function writeStoredAudioQuality(q: AudioQuality) {
  localStorage.setItem(AUDIO_QUALITY_KEY, q);
}

export function audioQualityLabel(q: AudioQuality): string {
  return AUDIO_QUALITY_OPTIONS.find((o) => o.id === q)?.label ?? q;
}

/** Humanize provider-reported quality strings for the player bar. */
export function formatStreamQuality(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "cache" || s === "outer" || s === "default") return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 1000) return `${Math.round(n / 1000)}kbps`;
    if (n > 0) return `${n}kbps`;
  }
  if (/^\d+k(mp3|flac)?$/i.test(s)) return s.toLowerCase();
  if (/^M\d+/i.test(s) || /^C\d+/i.test(s)) return s;
  if (s === "HQ" || s === "hq") return "HQ";
  return s;
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
