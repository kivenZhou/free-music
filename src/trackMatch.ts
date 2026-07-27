import type { FavoriteItem, Track } from "./types";

export function favKey(t: Track) {
  return `${t.provider}:${t.id}`;
}

/** Strip track-number prefixes / artist suffixes so cross-source dupes match. */
export function normalizeSongTitle(title: string): string {
  let s = (title || "").toLowerCase().trim();
  s = s.replace(/^(?:p\d+\s*)?\d{1,3}[\.．、．\s]+/i, "");
  s = s.replace(/^[\[【\(（][^\]】\)）]{0,24}[\]】\)）]\s*/g, "");
  s = s.replace(
    /\s*[-—–_～~｜|／/]\s*[\u4e00-\u9fffA-Za-z0-9·\s]{1,20}$/u,
    "",
  );
  s = s.replace(
    /(?:官方(?:歌词)?版|直播版|现场版|完整版|高音质|无损|音频|伴奏|纯音乐|翻唱)$/g,
    "",
  );
  s = s.replace(/[\s\-—–_～~｜|·.,，。!！?？、；;：:（）()【】\[\]"'“”‘’]/g, "");
  return s;
}

export function normalizeArtistName(artist: string): string {
  return (artist || "")
    .toLowerCase()
    .replace(/合集|精选|音乐|无损|音频|合辑|playlist|collection/g, "")
    .replace(/[\s\-—–_～~｜|·.,，。!！?？、；;：:（）()【】\[\]"'“”‘’']/g, "")
    .trim();
}

export function isSameSong(a: Track, b: Track): boolean {
  if (favKey(a) === favKey(b)) return true;
  const ta = normalizeSongTitle(a.title || "");
  const tb = normalizeSongTitle(b.title || "");
  if (ta.length < 2 || tb.length < 2) return false;

  const titleHit =
    ta === tb ||
    (ta.length >= 4 && tb.length >= 4 && (ta.includes(tb) || tb.includes(ta)));
  if (!titleHit) return false;

  const aa = normalizeArtistName(a.artist || "");
  const ab = normalizeArtistName(b.artist || "");
  // B站合集等「歌手」常是 UP 主名，标题足够长时只靠标题判重
  if (!aa || !ab) return true;
  if (aa.includes(ab) || ab.includes(aa)) return true;
  if (Math.min(ta.length, tb.length) >= 6) return true;
  return false;
}

export function uniqueTracks(list: Track[]): Track[] {
  const out: Track[] = [];
  for (const t of list) {
    if (out.some((x) => isSameSong(x, t))) continue;
    out.push(t);
  }
  return out;
}

/** Higher = closer title match. Exact favorites must beat “香草吧噗动态鼓谱”. */
function lcsLen(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array<number>(n + 1).fill(0);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] as number) + 1
          : Math.max(prev[j] as number, cur[j - 1] as number);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[n] as number;
}

/** Soften common ASR confusions inside short titles. */
function softenTitle(s: string): string {
  return s
    .replace(/[巴八扒]/g, "吧")
    .replace(/[扑蒲埔]/g, "噗")
    .replace(/[的得地]/g, "");
}

function parseArtistTitleQuery(query: string): { artist: string; title: string } {
  const q = query.trim();
  const m = q.match(/^(.+?)的(.+)$/);
  if (m?.[1] && m?.[2] && m[1].length >= 2 && m[2].length >= 1) {
    return { artist: m[1].trim(), title: m[2].trim() };
  }
  return { artist: "", title: q };
}

export function scoreTrackMatch(track: Track, query: string): number {
  const parsed = parseArtistTitleQuery(query);
  const qTitle = softenTitle(normalizeSongTitle(parsed.title || query));
  const qArtist = normalizeArtistName(parsed.artist || "");
  const qFull = softenTitle(normalizeSongTitle(query));
  const title = softenTitle(normalizeSongTitle(track.title || ""));
  const artist = normalizeArtistName(track.artist || "");
  if (!qTitle && !qFull) return 0;
  if (!title && !artist) return 0;

  let score = 0;
  const candidates = [qTitle, qFull].filter((x, i, arr) => x && arr.indexOf(x) === i);

  for (const q of candidates) {
    if (title === q) {
      score = Math.max(score, 100);
      continue;
    }
    if (title.startsWith(q)) {
      const extra = title.length - q.length;
      score = Math.max(
        score,
        extra <= 2 ? 92 : Math.max(48, Math.round(88 * (q.length / title.length))),
      );
      continue;
    }
    if (q.startsWith(title) && title.length >= 2) {
      const extra = q.length - title.length;
      score = Math.max(score, extra <= 2 ? 88 : 52);
      continue;
    }
    if (title.includes(q) && q.length >= 2) {
      score = Math.max(score, Math.round(42 + 50 * (q.length / title.length)));
      continue;
    }
    if (q.includes(title) && title.length >= 2) {
      score = Math.max(score, Math.round(42 + 50 * (title.length / q.length)));
      continue;
    }
    if (q.length >= 3 && title.length >= 3) {
      const lcs = lcsLen(title, q);
      const ratio = lcs / Math.max(q.length, title.length);
      const cover = lcs / q.length;
      if (cover >= 0.75 && ratio >= 0.6) {
        score = Math.max(score, Math.round(55 + 40 * cover));
      } else if (cover >= 0.6 && lcs >= 3) {
        score = Math.max(score, Math.round(40 + 30 * cover));
      }
    }
  }

  if (qArtist && artist) {
    if (artist === qArtist || artist.includes(qArtist) || qArtist.includes(artist)) {
      score = Math.min(100, score + (score >= 40 ? 15 : 25));
    }
  } else if (!qArtist && artist && qFull.includes(artist) && title) {
    if (qFull.includes(title)) score = Math.max(score, 80);
  }

  return score;
}

export function findBestMatchingTrack(
  tracks: Track[],
  query: string,
  minScore = 1,
): { track: Track; index: number; score: number } | null {
  let best: Track | null = null;
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!track || track.playability === "unavailable") continue;
    const score = scoreTrackMatch(track, query);
    if (score > bestScore) {
      bestScore = score;
      best = track;
      bestIndex = i;
    }
  }
  return best && bestIndex >= 0 && bestScore >= minScore
    ? { track: best, index: bestIndex, score: bestScore }
    : null;
}

export function findFavoriteTrack(
  favorites: FavoriteItem[],
  query: string,
): { track: Track; score: number } | null {
  const hit = findBestMatchingTrack(
    favorites.map((item) => item.track).filter(Boolean),
    query,
    55,
  );
  return hit ? { track: hit.track, score: hit.score } : null;
}

/** Queue jump only for near-exact title; favorites win over long-suffix hits. */
export const QUEUE_STRONG_SCORE = 92;
