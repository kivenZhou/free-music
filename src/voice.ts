import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  classifyIntent,
  guessSearchQuery,
  type ModelIntentLabel,
} from "./voiceIntentModel";

export const VOICE_WAKE_WORD = "小栈小栈";
export const VOICE_ENABLED_KEY = "yinzhan-voice-enabled";
export const VOICE_WAKE_REPLY = "在呢";

export type VoiceAction =
  | "next"
  | "prev"
  | "play"
  | "pause"
  | "toggle"
  | "mute"
  | "volume_up"
  | "volume_down"
  | "show_lyrics"
  | "hide_lyrics"
  | "favorite"
  | "unfavorite"
  | "shuffle"
  | "repeat"
  | "clear_queue"
  | "show_queue"
  | "whats_playing"
  | "play_favorites";

export type VoiceIntent =
  | { kind: "wake" }
  | { kind: "command"; action: VoiceAction }
  | { kind: "wake_and_command"; action: VoiceAction }
  | { kind: "search_play"; query: string; provider?: string }
  | { kind: "wake_and_search_play"; query: string; provider?: string }
  | { kind: "theme_play"; query: string; provider?: string; limit?: number }
  | { kind: "wake_and_theme_play"; query: string; provider?: string; limit?: number }
  | { kind: "append_tracks"; count: number }
  | { kind: "wake_and_append_tracks"; count: number }
  | { kind: "provider_play"; provider: string }
  | { kind: "wake_and_provider_play"; provider: string }
  | { kind: "switch_provider"; provider: string }
  | { kind: "wake_and_switch_provider"; provider: string };

export type VoiceUiStatus =
  | "off"
  | "starting"
  | "listening"
  | "speaking"
  | "awake"
  | "error"
  | "stopped";

export interface VoiceAssistantInfo {
  running: boolean;
  backend: string;
  wakeWord: string;
  supported: boolean;
}

export interface VoiceHandlers {
  onNext: () => void;
  onPrev: () => void;
  onPlay: () => void;
  onPause: () => void;
  onToggle: () => void;
  onMute: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onShowLyrics: () => void;
  onHideLyrics: () => void;
  onFavorite: () => void | Promise<void>;
  onUnfavorite: () => void | Promise<void>;
  /** Search and play by natural language query, e.g. 七里香 / 周杰伦. */
  onSearchPlay: (query: string, provider?: string) => void | Promise<void>;
  /** Search a theme/genre/era and replace queue with a batch of tracks. */
  onThemePlay: (
    query: string,
    provider?: string,
    limit?: number,
  ) => void | Promise<void>;
  /** Append N more tracks related to the last voice feed (search/chart). */
  onAppendTracks: (count: number) => void | Promise<void>;
  /** Switch source and play that provider's chart / catalog into the queue. */
  onProviderPlay: (provider: string) => void | Promise<void>;
  /** Switch audio source only. */
  onSwitchProvider: (provider: string) => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onClearQueue: () => void;
  onShowQueue: () => void;
  onWhatsPlaying: () => void | Promise<void>;
  onPlayFavorites: () => void | Promise<void>;
  onStatus?: (status: VoiceUiStatus, detail: string) => void;
  /**
   * hold=true: pause music for the wake/command window.
   * hold=false: end window; resume=true means continue playback if it was playing.
   */
  onMusicHold?: (hold: boolean, resume?: boolean) => void;
  /**
   * Soft-duck is only used during brief TTS echo windows if needed.
   * Do NOT duck while idle-listening for wake — that made music stay quiet
   * the whole time voice assistant was on.
   */
  onMusicDuck?: (factor: number) => void;
}

type SpeechRecCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

/** Homophones / near-misses ASR often returns for 栈 (esp. far-field). */
const ZHAN_VARIANTS = "栈站战占赞暂绽湛蘸张章胀账杖展斩盏";

function normalize(text: string): string {
  let s = text
    .toLowerCase()
    .replace(/[\s,，。.!！?？、；;：:\-—_'"\`~··]/g, "");
  // Whole-phrase ASR mangling common at a distance
  s = s.replace(/xiao\s*zhan/gi, "小栈");
  s = s.replace(
    /校长|嚣张|小镇|小江|小姜|小疆|音栈|银栈|银站|阴站|心战|小展|小斩|小盏|消站|笑站|想站/g,
    "小栈",
  );
  // Map 小X → 小栈 for common variants
  const re = new RegExp(`小[${ZHAN_VARIANTS}]`, "g");
  s = s.replace(re, "小栈");
  // Collapse stutter / ASR doubles: 小栈栈 → 小栈小栈-ish handled in hasWakeWord
  s = s.replace(/栈{2,}/g, "栈栈");
  return s;
}

function wakeFillerOnly(rest: string): boolean {
  if (!rest) return true;
  // Tolerate short trailing ASR junk after the wake word.
  if (rest.length <= 4) return true;
  return /^(?:呀|啊|呢|嗯|哦|哎|欸|诶|呀啊|啊啊|嗯嗯|请|你|我说|那个|在吗|在不在|你好|嗨|喂)$/.test(
    rest,
  );
}

function hasWakeWord(norm: string): boolean {
  if (norm.includes("小栈小栈")) return true;
  const parts = norm.split("小栈");
  if (parts.length >= 3) return true;
  if (/小栈{2,}/.test(norm)) return true;
  if (/小栈栈|栈小栈|小小栈|栈栈/.test(norm)) return true;
  // Single「小栈」is enough — even with short trailing noise.
  if (countWakeTokens(norm) >= 1 && wakeFillerOnly(stripWakeWord(norm))) {
    return true;
  }
  // Short utterance containing 小栈 anywhere (near-mic ASR often wraps fillers).
  if (countWakeTokens(norm) >= 1 && norm.length <= 12) {
    return true;
  }
  return false;
}

/** Count how many 小栈-like tokens appear after normalize. */
function countWakeTokens(norm: string): number {
  const m = norm.match(/小栈/g);
  return m ? m.length : 0;
}

function stripWakeWord(norm: string): string {
  return norm
    .replace(/小栈小栈/g, "")
    .replace(/小栈/g, "")
    .replace(/栈栈/g, "")
    .trim();
}

/** Longest-first aliases → provider id (normalized text). */
const PROVIDER_ALIASES: Array<{ id: string; aliases: string[] }> = [
  {
    id: "bilibili",
    aliases: ["哔哩哔哩", "bilibili", "bilibili音乐", "b站音乐", "b站", "哔哩"],
  },
  {
    id: "netease",
    aliases: ["网易云音乐", "网易云", "网易", "netease"],
  },
  {
    id: "kugou",
    aliases: ["酷狗音乐", "酷狗", "kugou"],
  },
  {
    id: "kuwo",
    aliases: ["酷我音乐", "酷我", "kuwo"],
  },
  {
    id: "qq",
    aliases: ["qq音乐", "qqmusic", "企鹅音乐", "qq"],
  },
  {
    id: "audius",
    aliases: ["audius"],
  },
];

const PROVIDER_ALIAS_FLAT: Array<{ id: string; alias: string }> = PROVIDER_ALIASES.flatMap(
  (p) => p.aliases.map((alias) => ({ id: p.id, alias })),
).sort((a, b) => b.alias.length - a.alias.length);

export function providerSpeakName(id: string): string {
  switch (id) {
    case "bilibili":
      return "B站";
    case "netease":
      return "网易云";
    case "kugou":
      return "酷狗";
    case "kuwo":
      return "酷我";
    case "qq":
      return "QQ音乐";
    case "audius":
      return "Audius";
    default:
      return id;
  }
}

function findProviderInText(
  norm: string,
): { id: string; alias: string; index: number } | null {
  for (const { id, alias } of PROVIDER_ALIAS_FLAT) {
    const index = norm.indexOf(alias);
    if (index >= 0) return { id, alias, index };
  }
  return null;
}

/**
 * 「播放B站里面的音乐」→ provider_play
 * 「播放B站的七里香」→ search_play + provider
 * 「切换到网易云」→ switch_provider
 */
function parseProviderScoped(
  norm: string,
):
  | { kind: "provider_play"; provider: string }
  | { kind: "switch_provider"; provider: string }
  | { kind: "search_play"; query: string; provider: string }
  | null {
  const hit = findProviderInText(norm);
  if (!hit) return null;

  const withoutAlias = (
    norm.slice(0, hit.index) + norm.slice(hit.index + hit.alias.length)
  ).trim();

  const switchOnly =
    /(?:切换到|切到|换成|改成|转到|用一下)/.test(norm) &&
    !/(?:播放|放歌|来点|听听|搜|搜索|点播|我想听|我要听)/.test(norm);

  if (switchOnly || /^(?:切换到|切到|换成|改成|转到|用)$/.test(withoutAlias)) {
    return { kind: "switch_provider", provider: hit.id };
  }

  let q = withoutAlias
    .replace(/^(?:帮我|给我|替我|麻烦你?|请)/, "")
    .replace(
      /^(?:播放|放|放点|放一下|来点|来一首|点一首|点播|听听|听一下|听|搜一下|搜索|搜|找一下|找歌|找一首|我想听|我要听|想听|要听)/,
      "",
    )
    .replace(/^(?:一下|一首|一个|这个|那个|首)/, "")
    .replace(/^(?:里面的|里的|里头的|上的|中的|里面|里头|里边|的)/, "")
    .replace(
      /(?:里面的|里的|里头的|上的|中的|的)?(?:音乐|歌曲|歌单|热歌|榜单|排行榜|榜|歌)$/g,
      "",
    )
    .replace(/^(?:里面的|里的|的|里面|里头)/, "")
    .trim();

  if (!q || /^(?:音乐|歌曲|歌|热歌|榜|歌单|里面)$/.test(q)) {
    return { kind: "provider_play", provider: hit.id };
  }
  if (matchAction(q)) return { kind: "provider_play", provider: hit.id };
  return { kind: "search_play", query: q, provider: hit.id };
}

function matchAction(norm: string): VoiceAction | null {
  if (!norm) return null;

  // More specific first
  if (
    /下一首|下一曲|下首歌|切歌|换歌|换一首|换一曲|切一首|跳过|下一条|播放下一|再来一首|来下一首/.test(
      norm,
    )
  ) {
    return "next";
  }
  if (/上一首|上一曲|上首歌|前一首|上一条|播放上一|回上一首/.test(norm)) {
    return "prev";
  }
  if (/关闭歌词|收起歌词|隐藏歌词|关掉歌词|把歌词关了/.test(norm)) {
    return "hide_lyrics";
  }
  if (/显示歌词|打开歌词|看歌词|把歌词打开|歌词面板|我想看歌词|^歌词$/.test(norm)) {
    return "show_lyrics";
  }
  if (/取消收藏|移除收藏|不收藏|取消喜欢/.test(norm)) {
    return "unfavorite";
  }
  if (/加入收藏|添加到收藏|收藏这首|收藏当前|把这首歌收藏|喜欢这首|加到收藏|帮我收藏|^收藏$|收藏一下/.test(norm)) {
    return "favorite";
  }
  if (/取消静音|打开声音|恢复声音|解除静音/.test(norm)) {
    return "mute";
  }
  if (/静音|关闭声音|把声音关了/.test(norm) || norm === "闭嘴") {
    return "mute";
  }
  if (/音量加大|加大音量|大声(?:点|一点)?|增大音量|音量高|大点声|声音大点/.test(norm)) {
    return "volume_up";
  }
  if (/音量减小|减小音量|小声(?:点|一点)?|降低音量|音量低|小点声|声音小点/.test(norm)) {
    return "volume_down";
  }
  if (
    /暂停|停止播放|先停|别放了|停下|停一下|先别放|不要放了|关掉音乐|关闭音乐|停止/.test(
      norm,
    )
  ) {
    return "pause";
  }
  // 「继续」等自然语言 → 继续播放
  if (
    /继续播放|继续放|继续听|接着(?:放|听|播)?|恢复播放|接着来|继续吧|继续|回来听/.test(
      norm,
    )
  ) {
    return "play";
  }
  if (/^(?:播放|放歌|放音乐|播放音乐|来点音乐|开始播放|开始吧|放吧)$/.test(norm)) {
    return "play";
  }
  if (/播放暂停|暂停播放|开始或暂停/.test(norm)) {
    return "toggle";
  }
  if (/随机播放|打开随机|开启随机|关闭随机|取消随机|随机模式/.test(norm)) {
    return "shuffle";
  }
  if (/单曲循环|列表循环|循环播放|顺序播放|切换循环|循环模式/.test(norm)) {
    return "repeat";
  }
  if (/清空(?:播放)?(?:列表|歌单|队列)|清除(?:播放)?(?:列表|歌单)|只留当前/.test(norm)) {
    return "clear_queue";
  }
  if (/打开(?:播放)?列表|显示(?:播放)?列表|看看队列|打开队列|显示队列/.test(norm)) {
    return "show_queue";
  }
  if (
    /这是什么歌|现在(?:在)?播(?:放)?什么|当前(?:是)?什么歌|在听什么|播放的是什么/.test(
      norm,
    )
  ) {
    return "whats_playing";
  }
  // Local favorites → queue, never online search for「收藏里面的音乐」.
  if (
    !/取消收藏|移除收藏|不收藏|加入收藏|添加到收藏|收藏这首|收藏当前|收藏一下|帮我收藏|喜欢这首/.test(
      norm,
    ) &&
    (/(?:播放|放|听|来点|打开)(?:一下)?(?:我的)?收藏/.test(norm) ||
      /从收藏(?:夹|列表)?(?:里|里面)?(?:播放|放|听)/.test(norm) ||
      /把收藏(?:夹|列表)?(?:里|里面)?的?(?:歌|音乐|歌曲)?(?:都)?(?:拿出来)?(?:播放|放)/.test(
        norm,
      ) ||
      /收藏(?:夹|列表)?(?:里|里面)的(?:歌|音乐|歌曲|曲子)?/.test(norm) ||
      /^(?:播放|放)(?:我的)?收藏(?:夹|列表)?$/.test(norm))
  ) {
    return "play_favorites";
  }
  return null;
}

/** Query that only names the local favorites library (not a song title). */
function isFavoritesLibraryQuery(q: string): boolean {
  if (!q) return false;
  return /^(?:我的)?收藏(?:夹|列表)?(?:里|里面)?(?:的)?(?:歌|音乐|歌曲|曲子)?$/.test(
    q,
  );
}

const THEME_RE =
  /粤语|国语|英语|英文|日语|日文|韩语|韩文|摇滚|民谣|爵士|轻音乐|纯音乐|古风|说唱|嘻哈|电音|流行|经典|热门|抖音|治愈|睡前|运动|开车|抒情|欢快|悲伤|安静|儿歌|动漫|二次元|摇滚乐|金属|朋克|蓝调|乡村|电子|舞曲|R&B|hiphop|rap/;

const ERA_RE =
  /\d{2,4}年代|[七八九十两]十年代|九十年代|八十年代|七十年代|六十年代|五十年代|零零年代|千禧|00后|10后|20后|00年代|10年代|20年代|上世纪/;

function chineseCountToNumber(raw: string): number | null {
  const map: Record<string, number> = {
    两: 2,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十五: 15,
    二十: 20,
    三十: 30,
    四十: 40,
    五十: 50,
  };
  if (map[raw] != null) return map[raw];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(50, Math.floor(n)) : null;
}

/** 「追加20首歌」「再来十首」「加载更多」 */
function extractAppendCount(norm: string): number | null {
  if (!norm) return null;
  if (/^(?:加载更多|再加载|多加载一点|继续加载)$/.test(norm) || /加载更多/.test(norm)) {
    return 20;
  }
  if (/^(?:多来点(?:歌|音乐)?|再来点(?:歌|音乐)?|再来几首|多放几首|再补点歌)$/.test(norm)) {
    return 20;
  }
  const m = norm.match(
    /(?:帮我|给我|请)?(?:给)?(?:歌单|播放列表|队列|列表)?(?:再)?(?:追加|添加|加上|补上|加入|多加|再加|再来|再放|再补)(?:(\d+)|([两二三四五六七八九十]+))?首/,
  );
  if (m) {
    const n = chineseCountToNumber(m[1] || m[2] || "二十");
    return n ?? 20;
  }
  const m2 = norm.match(
    /(?:追加|再来|再加|再补|添加)(?:(\d+)|([两二三四五六七八九十]+))首/,
  );
  if (m2) {
    return chineseCountToNumber(m2[1] || m2[2] || "二十") ?? 20;
  }
  return null;
}

/** Theme / era / “来点xx” → play a batch, not a single title. */
function shouldPlayAsList(norm: string, query: string): boolean {
  if (THEME_RE.test(query) || THEME_RE.test(norm)) return true;
  if (ERA_RE.test(query) || ERA_RE.test(norm)) return true;
  if (/来点|来一些|来一批|整点|放点|听点|来几首/.test(norm)) return true;
  if (/(?:的歌|的音乐|的曲子|类歌曲|风格的歌)$/.test(query)) return true;
  if (/(?:热歌|榜单|排行榜|歌单)$/.test(query)) return true;
  return false;
}

/** Extract "play this song/artist" query from natural language. */
function extractSearchPlay(norm: string): string | null {
  if (!norm) return null;
  // Bare resume words are not search
  if (/^(?:播放|放歌|放音乐|播放音乐|来点音乐|开始播放|开始吧|放吧|继续|继续播放)$/.test(norm)) {
    return null;
  }

  const patterns: RegExp[] = [
    /^(?:帮我|给我|替我|麻烦你?|请)?(?:播放|放|放一首|放一下|放点|来点|来一些|来一批|整点|听点|来一首|点一首|点播|听一下|我想听|我要听|想听|要听|听听)(?:一下|一首|一些|一批|这个|那个)?(.+)$/,
    /^(?:搜索|搜一下|搜|找一下|找歌|找一首)(.+)$/,
    /^播放(.+)$/,
    /^放(.+)$/,
  ];

  for (const re of patterns) {
    const m = norm.match(re);
    if (!m?.[1]) continue;
    let q = m[1]
      .replace(/^(?:一下|一首|一个|一些|一批|这个|那个|首)/, "")
      .trim();
    const raw = q;
    // Do NOT strip bare 吧/呀/啊 — song titles like「香草吧噗」contain them.
    q = q
      .replace(/(?:谢谢你|谢谢)$/g, "")
      .replace(/(?:歌曲吧|音乐吧|歌吧)$/g, "")
      .replace(/(?:的)?(?:歌曲|歌单)$/g, "")
      .replace(/的歌$/, "")
      .trim();
    // Keep compounds like 轻音乐 / 粤语的歌 when stripping would kill the theme.
    if (
      (THEME_RE.test(raw) || ERA_RE.test(raw)) &&
      !(THEME_RE.test(q) || ERA_RE.test(q))
    ) {
      q = raw.replace(/(?:谢谢你|谢谢)$/g, "").trim();
    }
    if (q.length < 1) continue;
    if (isFavoritesLibraryQuery(q) || isFavoritesLibraryQuery(raw)) continue;
    if (matchAction(q) || matchAction(norm)) continue;
    if (/^(?:下一首|上一首|暂停|继续|静音)$/.test(q)) continue;
    return q;
  }
  return null;
}

function detectedWake(norm: string): boolean {
  if (hasWakeWord(norm)) return true;
  // 「小栈播放…」— single wake token as prefix (far-field often drops the repeat)
  return countWakeTokens(norm) >= 1 && /^小栈/.test(norm);
}

export function parseVoiceText(text: string, awake: boolean): VoiceIntent | null {
  const norm = normalize(text);
  if (!norm) return null;

  const woke = detectedWake(norm);
  const rest = woke ? stripWakeWord(norm) : norm;

  // Empty after wake word only
  if (!rest) {
    return woke ? { kind: "wake" } : null;
  }

  // 「播放B站里面的音乐」must win before generic search-play.
  const scoped = parseProviderScoped(rest);
  if (scoped) {
    if (scoped.kind === "provider_play") {
      if (woke) return { kind: "wake_and_provider_play", provider: scoped.provider };
      if (awake) return { kind: "provider_play", provider: scoped.provider };
      return null;
    }
    if (scoped.kind === "switch_provider") {
      if (woke) return { kind: "wake_and_switch_provider", provider: scoped.provider };
      if (awake) return { kind: "switch_provider", provider: scoped.provider };
      return null;
    }
    if (scoped.kind === "search_play") {
      const list = shouldPlayAsList(rest, scoped.query);
      if (list) {
        if (woke) {
          return {
            kind: "wake_and_theme_play",
            query: scoped.query,
            provider: scoped.provider,
          };
        }
        if (awake) {
          return {
            kind: "theme_play",
            query: scoped.query,
            provider: scoped.provider,
          };
        }
        return null;
      }
      if (woke) {
        return {
          kind: "wake_and_search_play",
          query: scoped.query,
          provider: scoped.provider,
        };
      }
      if (awake) {
        return {
          kind: "search_play",
          query: scoped.query,
          provider: scoped.provider,
        };
      }
      return null;
    }
  }

  const appendCount = extractAppendCount(rest);
  if (appendCount != null) {
    if (woke) return { kind: "wake_and_append_tracks", count: appendCount };
    if (awake) return { kind: "append_tracks", count: appendCount };
    return null;
  }

  // Commands like「播放收藏里面的音乐」must beat generic search/theme play.
  const action = matchAction(rest);
  if (action) {
    if (woke) return { kind: "wake_and_command", action };
    if (awake) return { kind: "command", action };
    return null;
  }

  // IMPORTANT: 「播放七里香」must be search, not bare「播放」.
  const query = extractSearchPlay(rest);
  if (query) {
    if (shouldPlayAsList(rest, query)) {
      if (woke) return { kind: "wake_and_theme_play", query };
      if (awake) return { kind: "theme_play", query };
      return null;
    }
    if (woke) return { kind: "wake_and_search_play", query };
    if (awake) return { kind: "search_play", query };
    return null;
  }

  if (woke) return { kind: "wake" };
  return null;
}

function modelLabelToIntent(
  label: ModelIntentLabel,
  rest: string,
  woke: boolean,
  awake: boolean,
): VoiceIntent | null {
  if (!woke && !awake) return null;
  if (label === "none") return null;

  // Rules may have missed after ASR noise; still prefer local favorites.
  const favAction = matchAction(rest);
  if (favAction === "play_favorites" || label === "play_favorites") {
    if (woke) return { kind: "wake_and_command", action: "play_favorites" };
    return { kind: "command", action: "play_favorites" };
  }

  if (label === "provider_play") {
    const scoped = parseProviderScoped(rest);
    if (scoped?.kind === "provider_play") {
      if (woke) return { kind: "wake_and_provider_play", provider: scoped.provider };
      return { kind: "provider_play", provider: scoped.provider };
    }
    if (scoped?.kind === "switch_provider") {
      if (woke) return { kind: "wake_and_switch_provider", provider: scoped.provider };
      return { kind: "switch_provider", provider: scoped.provider };
    }
    if (scoped?.kind === "search_play") {
      if (woke) {
        return {
          kind: "wake_and_search_play",
          query: scoped.query,
          provider: scoped.provider,
        };
      }
      return {
        kind: "search_play",
        query: scoped.query,
        provider: scoped.provider,
      };
    }
    const hit = findProviderInText(rest);
    if (!hit) return null;
    if (woke) return { kind: "wake_and_provider_play", provider: hit.id };
    return { kind: "provider_play", provider: hit.id };
  }

  if (label === "search_play" || label === "theme_play") {
    const scoped = parseProviderScoped(rest);
    if (scoped?.kind === "search_play") {
      const list = label === "theme_play" || shouldPlayAsList(rest, scoped.query);
      if (list) {
        if (woke) {
          return {
            kind: "wake_and_theme_play",
            query: scoped.query,
            provider: scoped.provider,
          };
        }
        return {
          kind: "theme_play",
          query: scoped.query,
          provider: scoped.provider,
        };
      }
      if (woke) {
        return {
          kind: "wake_and_search_play",
          query: scoped.query,
          provider: scoped.provider,
        };
      }
      return {
        kind: "search_play",
        query: scoped.query,
        provider: scoped.provider,
      };
    }
    if (scoped?.kind === "provider_play") {
      if (woke) return { kind: "wake_and_provider_play", provider: scoped.provider };
      return { kind: "provider_play", provider: scoped.provider };
    }
    const query = extractSearchPlay(rest) || guessSearchQuery(rest);
    if (!query) return null;
    if (label === "theme_play" || shouldPlayAsList(rest, query)) {
      if (woke) return { kind: "wake_and_theme_play", query };
      return { kind: "theme_play", query };
    }
    if (woke) return { kind: "wake_and_search_play", query };
    return { kind: "search_play", query };
  }

  if (label === "append_tracks") {
    const count = extractAppendCount(rest) ?? 20;
    if (woke) return { kind: "wake_and_append_tracks", count };
    return { kind: "append_tracks", count };
  }

  const action = label as VoiceAction;
  if (woke) return { kind: "wake_and_command", action };
  return { kind: "command", action };
}

/**
 * Rules first (fast / exact), then tiny bundled intent model for paraphrases.
 * No API key; model weights ship inside the app (~30KB).
 */
export function resolveVoiceIntent(
  text: string,
  awake: boolean,
): VoiceIntent | null {
  const rules = parseVoiceText(text, awake);
  // Prefer concrete commands / search; bare wake can still try model on rest.
  if (
    rules &&
    (rules.kind === "command" ||
      rules.kind === "wake_and_command" ||
      rules.kind === "search_play" ||
      rules.kind === "wake_and_search_play" ||
      rules.kind === "theme_play" ||
      rules.kind === "wake_and_theme_play" ||
      rules.kind === "append_tracks" ||
      rules.kind === "wake_and_append_tracks" ||
      rules.kind === "provider_play" ||
      rules.kind === "wake_and_provider_play" ||
      rules.kind === "switch_provider" ||
      rules.kind === "wake_and_switch_provider")
  ) {
    return rules;
  }

  const norm = normalize(text);
  if (!norm) return null;
  const woke = detectedWake(norm);
  const rest = woke ? stripWakeWord(norm) : norm;
  if (!rest) {
    return woke || rules?.kind === "wake" ? { kind: "wake" } : null;
  }
  if (!awake && !woke) return rules;

  const pred = classifyIntent(rest);
  if (pred) {
    const fromModel = modelLabelToIntent(pred.label, rest, woke, awake);
    if (fromModel) return fromModel;
  }

  return rules;
}

function getSpeechRecognitionCtor(): SpeechRecCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function applyAction(action: VoiceAction, handlers: VoiceHandlers) {
  switch (action) {
    case "next":
      handlers.onNext();
      break;
    case "prev":
      handlers.onPrev();
      break;
    case "play":
      handlers.onPlay();
      break;
    case "pause":
      handlers.onPause();
      break;
    case "toggle":
      handlers.onToggle();
      break;
    case "mute":
      handlers.onMute();
      break;
    case "volume_up":
      handlers.onVolumeUp();
      break;
    case "volume_down":
      handlers.onVolumeDown();
      break;
    case "show_lyrics":
      handlers.onShowLyrics();
      break;
    case "hide_lyrics":
      handlers.onHideLyrics();
      break;
    case "favorite":
      void handlers.onFavorite();
      break;
    case "unfavorite":
      void handlers.onUnfavorite();
      break;
    case "shuffle":
      handlers.onShuffle();
      break;
    case "repeat":
      handlers.onRepeat();
      break;
    case "clear_queue":
      handlers.onClearQueue();
      break;
    case "show_queue":
      handlers.onShowQueue();
      break;
    case "whats_playing":
      void handlers.onWhatsPlaying();
      break;
    case "play_favorites":
      void handlers.onPlayFavorites();
      break;
  }
}

export class VoiceAssistant {
  private handlers: VoiceHandlers;
  private awakeUntil = 0;
  private running = false;
  private backend: "native" | "web" | null = null;
  private webRec: SpeechRecognitionLike | null = null;
  private unlistenTranscript: UnlistenFn | null = null;
  private unlistenStatus: UnlistenFn | null = null;
  private lastActionAt = 0;
  private lastWakeAt = 0;
  /** Accumulate partial「小栈」hits across short transcripts. */
  private wakeHits = 0;
  private wakeHitResetAt = 0;
  private wakeExpireTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ignore mic while TTS is speaking (avoid hearing our own reply). */
  private ignoreUntil = 0;
  /** After a pause/mute command, don't auto-resume when hold ends. */
  private suppressResume = false;
  private holdingMusic = false;
  /** Growing ASR hypothesis; committed after silence. */
  private utteranceBuf = "";
  private endpointTimer: ReturnType<typeof setTimeout> | null = null;
  /** Wait this long after user stops speaking before parsing. */
  private static readonly ENDPOINT_MS = 1600;
  private static readonly ENDPOINT_FINAL_MS = 900;

  constructor(handlers: VoiceHandlers) {
    this.handlers = handlers;
  }

  updateHandlers(handlers: VoiceHandlers) {
    this.handlers = handlers;
  }

  isRunning() {
    return this.running;
  }

  isAwake() {
    return Date.now() < this.awakeUntil;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.handlers.onStatus?.("starting", "正在启动语音助手…");

    const info = await invoke<VoiceAssistantInfo>("voice_assistant_info").catch(
      () => null,
    );

    // Prefer native macOS Speech — never use Web Speech in the packaged app
    // (WKWebView returns not-allowed for mic without a secure web context).
    const useNative =
      info?.backend === "macos-speech" ||
      info?.backend === "native" ||
      info?.supported === true;

    if (useNative) {
      this.backend = "native";
      await this.bindNativeEvents();
      await invoke("start_voice_assistant");
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (Ctor) {
      this.backend = "web";
      await this.startWeb(Ctor);
      return;
    }

    this.backend = "native";
    await this.bindNativeEvents();
    await invoke("start_voice_assistant");
  }

  async stop(): Promise<void> {
    this.running = false;
    this.awakeUntil = 0;
    if (this.wakeExpireTimer) {
      clearTimeout(this.wakeExpireTimer);
      this.wakeExpireTimer = null;
    }
    if (this.endpointTimer) {
      clearTimeout(this.endpointTimer);
      this.endpointTimer = null;
    }
    this.utteranceBuf = "";
    this.endMusicHold(false);
    this.restoreFullVolume();
    this.stopWeb();
    if (this.unlistenTranscript) {
      this.unlistenTranscript();
      this.unlistenTranscript = null;
    }
    if (this.unlistenStatus) {
      this.unlistenStatus();
      this.unlistenStatus = null;
    }
    try {
      await invoke("stop_voice_assistant");
    } catch {
      // ignore
    }
    this.handlers.onStatus?.("stopped", "语音助手已关闭");
  }

  private async bindNativeEvents() {
    if (!this.unlistenTranscript) {
      this.unlistenTranscript = await listen<{ text: string; isFinal: boolean }>(
        "voice-transcript",
        (ev) => {
          this.onTranscript(ev.payload.text, ev.payload.isFinal);
        },
      );
    }
    if (!this.unlistenStatus) {
      this.unlistenStatus = await listen<{ status: string; detail: string }>(
        "voice-status",
        (ev) => {
          this.mapStatus(ev.payload.status, ev.payload.detail);
        },
      );
    }
  }

  private async startWeb(Ctor: SpeechRecCtor) {
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "zh-CN";
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const item = ev.results[i];
        const text = item?.[0]?.transcript?.trim();
        if (!text) continue;
        this.onTranscript(text, Boolean(item.isFinal));
      }
    };
    rec.onerror = (ev) => {
      const err = ev.error ?? "unknown";
      if (err === "aborted" || err === "no-speech") return;
      this.handlers.onStatus?.("error", `语音识别错误：${err}`);
      void invoke("report_voice_web_status", {
        status: "error",
        detail: String(err),
      });
    };
    rec.onend = () => {
      if (!this.running || this.backend !== "web") return;
      try {
        rec.start();
      } catch {
        // ignore restart races
      }
    };
    this.webRec = rec;
    try {
      rec.start();
      this.handlers.onStatus?.(
        "listening",
        `可以说「${VOICE_WAKE_WORD}」`,
      );
      this.restoreFullVolume();
      await invoke("report_voice_web_status", {
        status: "listening",
        detail: VOICE_WAKE_WORD,
      });
    } catch (e) {
      this.running = false;
      this.handlers.onStatus?.("error", String(e));
      throw e;
    }
  }

  private stopWeb() {
    if (!this.webRec) return;
    const rec = this.webRec;
    this.webRec = null;
    rec.onend = null;
    rec.onresult = null;
    rec.onerror = null;
    try {
      rec.abort();
    } catch {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
  }

  private mapStatus(status: string, detail: string) {
    if (!this.running && status !== "stopped") return;
    if (status === "speaking") {
      this.handlers.onStatus?.(
        "speaking",
        detail || VOICE_WAKE_REPLY,
      );
      return;
    }
    if (status === "listening" || status === "starting") {
      if (status === "listening" && this.isAwake()) return;
      // Idle listen must not duck music — that made volume stay tiny while voice was on.
      if (status === "listening" && !this.holdingMusic) this.restoreFullVolume();
      this.handlers.onStatus?.(
        status === "starting" ? "starting" : "listening",
        detail || `可以说「${VOICE_WAKE_WORD}」`,
      );
      return;
    }
    if (status === "awake") {
      this.handlers.onStatus?.("awake", detail || VOICE_WAKE_REPLY);
      return;
    }
    if (status === "error") {
      this.endMusicHold(false);
      this.restoreFullVolume();
      this.handlers.onStatus?.("error", detail || "语音助手出错");
      return;
    }
    if (status === "stopped") {
      this.running = false;
      this.endMusicHold(false);
      this.restoreFullVolume();
      this.handlers.onStatus?.("stopped", detail);
    }
  }

  private beginMusicHold() {
    if (this.holdingMusic) return;
    this.holdingMusic = true;
    this.suppressResume = false;
    this.handlers.onMusicDuck?.(1);
    this.handlers.onMusicHold?.(true);
  }

  private endMusicHold(resume: boolean) {
    if (!this.holdingMusic) return;
    this.holdingMusic = false;
    const shouldResume = resume && !this.suppressResume;
    this.suppressResume = false;
    this.handlers.onMusicHold?.(false, shouldResume);
    this.restoreFullVolume();
  }

  /** Always restore full playback level when not in an active hold. */
  private restoreFullVolume() {
    this.handlers.onMusicDuck?.(1);
  }

  private scheduleCommandWindow(ms: number) {
    if (this.wakeExpireTimer) clearTimeout(this.wakeExpireTimer);
    this.awakeUntil = Date.now() + ms;
    this.wakeExpireTimer = setTimeout(() => {
      if (!this.running) return;
      if (Date.now() >= this.awakeUntil) {
        this.endMusicHold(true);
        this.handlers.onStatus?.(
          "listening",
          `可以说「${VOICE_WAKE_WORD}」`,
        );
      }
    }, ms + 50);
  }

  private triggerWake(detail = VOICE_WAKE_REPLY) {
    const now = Date.now();
    if (now - this.lastWakeAt < 800) return;
    this.lastWakeAt = now;
    this.wakeHits = 0;
    this.beginMusicHold();
    // Short ignore for TTS echo; speakReply resets this when done.
    this.ignoreUntil = now + 1800;
    this.awakeUntil = now + 12000;
    this.handlers.onStatus?.("speaking", detail);
    void this.speakReply(VOICE_WAKE_REPLY);
  }

  private async speakReply(text: string) {
    try {
      await invoke("voice_speak", { text });
      this.handlers.onStatus?.("awake", "请说指令…");
    } catch (e) {
      this.handlers.onStatus?.("awake", "请直接说指令");
      console.warn("voice_speak failed", e);
    } finally {
      this.ignoreUntil = Date.now() + 600;
      // Longer window for natural phrases like「帮我播放周杰伦」
      this.scheduleCommandWindow(5500);
    }
  }

  private async speakAck(text: string) {
    this.handlers.onStatus?.("speaking", text);
    // Block only while TTS may echo — don't leave a long deaf window after.
    this.ignoreUntil = Date.now() + 12_000;
    try {
      await invoke("voice_speak", { text });
    } catch {
      // ignore
    } finally {
      this.ignoreUntil = Date.now() + 700;
    }
  }

  private finishSession(statusDetail: string, resume: boolean) {
    this.awakeUntil = Date.now();
    if (this.wakeExpireTimer) {
      clearTimeout(this.wakeExpireTimer);
      this.wakeExpireTimer = null;
    }
    this.endMusicHold(resume);
    this.handlers.onStatus?.("listening", statusDetail);
  }

  private async runCommand(action: VoiceAction, fromWakeCombo: boolean) {
    if (fromWakeCombo) this.beginMusicHold();

    if (action === "whats_playing") {
      applyAction(action, this.handlers);
      this.finishSession("当前曲目", true);
      return;
    }

    if (action === "pause" || action === "mute") {
      this.suppressResume = true;
    }
    if (action === "play_favorites") {
      this.suppressResume = true;
    }

    // Skip tracks before TTS so「上一首 / 下一首」isn't delayed by speech.
    if (action === "next" || action === "prev") {
      applyAction(action, this.handlers);
      // New track may have started playing; pause again so the ack is clear.
      this.handlers.onPause();
      await this.speakAck(`收到，${actionLabel(action)}`);
      this.finishSession(`已执行：${actionLabel(action)}`, true);
      return;
    }

    await this.speakAck(`收到，${actionLabel(action)}`);
    applyAction(action, this.handlers);
    const resume =
      action !== "pause" && action !== "mute" && action !== "play_favorites";
    this.finishSession(`已执行：${actionLabel(action)}`, resume);
  }

  private async runSearchPlay(
    query: string,
    fromWakeCombo: boolean,
    provider?: string,
  ) {
    if (fromWakeCombo) this.beginMusicHold();
    this.suppressResume = true;
    const name = provider ? providerSpeakName(provider) : "";
    await this.speakAck(
      provider ? `收到，在${name}播放${query}` : `收到，播放${query}`,
    );
    this.finishSession(`正在搜索：${query}`, false);
    try {
      await this.handlers.onSearchPlay(query, provider);
    } catch (e) {
      console.warn("onSearchPlay failed", e);
      void this.speakAck("搜索失败，请再说一次");
    }
  }

  private async runThemePlay(
    query: string,
    fromWakeCombo: boolean,
    provider?: string,
    limit?: number,
  ) {
    if (fromWakeCombo) this.beginMusicHold();
    this.suppressResume = true;
    await this.speakAck(`收到，播放${query}`);
    this.finishSession(`正在搜索：${query}`, false);
    try {
      await this.handlers.onThemePlay(query, provider, limit);
    } catch (e) {
      console.warn("onThemePlay failed", e);
      void this.speakAck("搜索失败，请再说一次");
    }
  }

  private async runAppendTracks(count: number, fromWakeCombo: boolean) {
    if (fromWakeCombo) this.beginMusicHold();
    this.suppressResume = true;
    await this.speakAck(`收到，追加${count}首歌`);
    this.finishSession(`正在追加：${count}首`, false);
    try {
      await this.handlers.onAppendTracks(count);
    } catch (e) {
      console.warn("onAppendTracks failed", e);
      void this.speakAck("追加失败，请再说一次");
    }
  }

  private async runProviderPlay(provider: string, fromWakeCombo: boolean) {
    if (fromWakeCombo) this.beginMusicHold();
    this.suppressResume = true;
    const name = providerSpeakName(provider);
    await this.speakAck(`收到，播放${name}的音乐`);
    this.finishSession(`正在加载：${name}`, false);
    try {
      await this.handlers.onProviderPlay(provider);
    } catch (e) {
      console.warn("onProviderPlay failed", e);
      void this.speakAck("加载失败，请再说一次");
    }
  }

  private async runSwitchProvider(provider: string, fromWakeCombo: boolean) {
    if (fromWakeCombo) this.beginMusicHold();
    const name = providerSpeakName(provider);
    await this.speakAck(`收到，已切换到${name}`);
    this.handlers.onSwitchProvider(provider);
    this.finishSession(`已切换：${name}`, true);
  }

  private clearEndpointTimer() {
    if (this.endpointTimer) {
      clearTimeout(this.endpointTimer);
      this.endpointTimer = null;
    }
  }

  private scheduleEndpoint(delayMs: number) {
    this.clearEndpointTimer();
    this.endpointTimer = setTimeout(() => {
      this.endpointTimer = null;
      void this.commitUtterance();
    }, delayMs);
  }

  /** Parse only after the user has stopped speaking for a bit. */
  private async commitUtterance() {
    const trimmed = this.utteranceBuf.trim();
    this.utteranceBuf = "";
    if (!trimmed || !this.running) return;
    if (Date.now() < this.ignoreUntil) return;

    const awake = this.isAwake();
    const parsed = resolveVoiceIntent(trimmed, awake);
    if (!parsed) {
      if (awake) {
        this.handlers.onStatus?.("awake", "没听清，请再说一次");
        this.scheduleCommandWindow(4000);
      }
      return;
    }

    const now = Date.now();
    if (now - this.lastActionAt < 700) return;
    this.lastActionAt = now;

    if (parsed.kind === "wake") {
      this.triggerWake();
      return;
    }

    if (parsed.kind === "command" || parsed.kind === "wake_and_command") {
      await this.runCommand(
        parsed.action,
        parsed.kind === "wake_and_command",
      );
      return;
    }

    if (parsed.kind === "search_play" || parsed.kind === "wake_and_search_play") {
      await this.runSearchPlay(
        parsed.query,
        parsed.kind === "wake_and_search_play",
        parsed.provider,
      );
      return;
    }

    if (parsed.kind === "theme_play" || parsed.kind === "wake_and_theme_play") {
      await this.runThemePlay(
        parsed.query,
        parsed.kind === "wake_and_theme_play",
        parsed.provider,
        parsed.limit,
      );
      return;
    }

    if (
      parsed.kind === "append_tracks" ||
      parsed.kind === "wake_and_append_tracks"
    ) {
      await this.runAppendTracks(
        parsed.count,
        parsed.kind === "wake_and_append_tracks",
      );
      return;
    }

    if (
      parsed.kind === "provider_play" ||
      parsed.kind === "wake_and_provider_play"
    ) {
      await this.runProviderPlay(
        parsed.provider,
        parsed.kind === "wake_and_provider_play",
      );
      return;
    }

    if (
      parsed.kind === "switch_provider" ||
      parsed.kind === "wake_and_switch_provider"
    ) {
      await this.runSwitchProvider(
        parsed.provider,
        parsed.kind === "wake_and_switch_provider",
      );
    }
  }

  private onTranscript(text: string, isFinal: boolean) {
    if (!this.running) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const now = Date.now();
    if (now < this.ignoreUntil) return;

    const echoNorm = normalize(trimmed);
    if (
      !detectedWake(echoNorm) &&
      (/^(?:在呢|我在你说|我在|你说|收到|好的|已暂停|音量已调大|音量已调小|搜索失败|请说指令|没听清)/.test(
        echoNorm,
      ) ||
        /^好的播放/.test(echoNorm) ||
        /^收到播放/.test(echoNorm) ||
        /^收到/.test(echoNorm) ||
        /^没有找到/.test(echoNorm) ||
        /^为你播放/.test(echoNorm))
    ) {
      return;
    }

    this.utteranceBuf = trimmed;
    const awake = this.isAwake();
    const norm = normalize(trimmed);

    if (!awake) {
      const wokeOnly = parseVoiceText(trimmed, false);
      const tokens = countWakeTokens(norm);
      const rest = stripWakeWord(norm);
      const pureWake =
        wokeOnly?.kind === "wake" ||
        (tokens >= 1 && (wakeFillerOnly(rest) || norm.length <= 12));

      // Pure wake (incl. short partial ASR) — fire immediately.
      if (pureWake && (!wokeOnly || wokeOnly.kind === "wake")) {
        this.clearEndpointTimer();
        this.utteranceBuf = "";
        this.triggerWake();
        return;
      }

      if (!wokeOnly && tokens > 0) {
        if (now > this.wakeHitResetAt) this.wakeHits = 0;
        this.wakeHits += tokens;
        this.wakeHitResetAt = now + 5000;
        if (this.wakeHits >= 1 && (wakeFillerOnly(rest) || norm.length <= 12)) {
          this.clearEndpointTimer();
          this.utteranceBuf = "";
          this.triggerWake();
          return;
        }
      }

      // 「小栈小栈播放xxx」— wait until speech ends so we don't cut off the song name.
      if (
        wokeOnly &&
        (wokeOnly.kind === "wake_and_command" ||
          wokeOnly.kind === "wake_and_search_play" ||
          wokeOnly.kind === "wake_and_theme_play" ||
          wokeOnly.kind === "wake_and_append_tracks" ||
          wokeOnly.kind === "wake_and_provider_play" ||
          wokeOnly.kind === "wake_and_switch_provider")
      ) {
        this.handlers.onStatus?.("listening", "正在听…");
        this.scheduleEndpoint(
          isFinal
            ? VoiceAssistant.ENDPOINT_FINAL_MS
            : VoiceAssistant.ENDPOINT_MS,
        );
        return;
      }
      return;
    }

    // Awake: buffer until ~1.6s silence, then understand the full sentence.
    this.scheduleCommandWindow(6500);
    this.handlers.onStatus?.("awake", "正在听…");
    this.scheduleEndpoint(
      isFinal ? VoiceAssistant.ENDPOINT_FINAL_MS : VoiceAssistant.ENDPOINT_MS,
    );
  }
}

function actionLabel(action: VoiceAction): string {
  switch (action) {
    case "next":
      return "下一首";
    case "prev":
      return "上一首";
    case "play":
      return "继续播放";
    case "pause":
      return "暂停";
    case "toggle":
      return "播放暂停";
    case "mute":
      return "静音";
    case "volume_up":
      return "大声一点";
    case "volume_down":
      return "小声一点";
    case "show_lyrics":
      return "打开歌词";
    case "hide_lyrics":
      return "关闭歌词";
    case "favorite":
      return "收藏";
    case "unfavorite":
      return "取消收藏";
    case "shuffle":
      return "随机播放";
    case "repeat":
      return "切换循环";
    case "clear_queue":
      return "清空歌单";
    case "show_queue":
      return "打开播放列表";
    case "whats_playing":
      return "当前曲目";
    case "play_favorites":
      return "播放收藏";
  }
}

export function readVoiceEnabled(): boolean {
  return localStorage.getItem(VOICE_ENABLED_KEY) === "1";
}

export function writeVoiceEnabled(on: boolean) {
  localStorage.setItem(VOICE_ENABLED_KEY, on ? "1" : "0");
}
