export type PlayErrorKind = "resolve" | "network" | "media" | "unavailable" | "unknown";

export type PlayErrorInfo = {
  kind: PlayErrorKind;
  message: string;
  provider?: string;
};

const KIND_HINT_ZH: Record<PlayErrorKind, string> = {
  resolve: "解析失败",
  network: "网络错误",
  media: "媒体错误",
  unavailable: "无法播放",
  unknown: "播放失败",
};

function cleanMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error:\s*/, "");
}

function classifyKind(message: string): PlayErrorKind {
  const text = message.toLowerCase();
  if (/timeout|network|fetch|cors|failed to fetch|net::|连接|网络|超时/.test(text)) {
    return "network";
  }
  if (
    /未获取|无法解析|试听|不可用|无版权|版权|会员|无免费完整播放/.test(message) ||
    /vip|unavailable/.test(text)
  ) {
    return "unavailable";
  }
  if (/media_err|audio|decode|decod|解码|格式/.test(text)) {
    return "media";
  }
  if (/resolve|play_url|play url|解析/.test(text)) {
    return "resolve";
  }
  return "unknown";
}

function isGenericMessage(message: string): boolean {
  const trimmed = message.trim();
  return trimmed === "" || trimmed === "播放失败";
}

export function classifyPlayError(err: unknown, provider?: string): PlayErrorInfo {
  const cleaned = cleanMessage(err);
  const kind = classifyKind(cleaned);
  let message = cleaned;
  if (isGenericMessage(message)) {
    message = KIND_HINT_ZH[kind];
  }
  return { kind, message, provider };
}

/** Short UI string with kind tag, e.g.「网络 · 请求超时」. */
export function formatPlayError(info: PlayErrorInfo): string {
  const hint = KIND_HINT_ZH[info.kind];
  if (info.message === hint || info.kind === "unknown") return info.message;
  return `${hint} · ${info.message}`;
}

/** Map HTMLMediaElement error codes to a classify-able message. */
export function mediaElementErrorMessage(audio: HTMLAudioElement | null): string {
  const code = audio?.error?.code;
  // Numeric fallbacks — MediaError may be missing in non-DOM test envs.
  if (code === 1) return "播放被中断";
  if (code === 2) return "网络错误，音频加载失败";
  if (code === 3) return "音频解码失败";
  if (code === 4) return "音频格式不支持或地址无效";
  return "播放失败";
}
