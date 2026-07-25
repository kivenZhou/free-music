import modelJson from "./voice-intent-model.json";

export type ModelIntentLabel =
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
  | "play_favorites"
  | "provider_play"
  | "theme_play"
  | "append_tracks"
  | "search_play"
  | "none";

interface IntentModel {
  version: number;
  dim: number;
  labels: ModelIntentLabel[];
  weights: number[][];
  bias: number[];
  minScore: number;
}

const model = modelJson as IntentModel;

function hashFeature(n: number, dim: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return (x >>> 0) % dim;
}

function featurize(norm: string, dim: number): Float64Array {
  const v = new Float64Array(dim);
  if (!norm) return v;
  for (let i = 0; i < norm.length; i++) {
    v[hashFeature(norm.charCodeAt(i) + 17, dim)] += 1;
    if (i + 1 < norm.length) {
      v[
        hashFeature(
          norm.charCodeAt(i) * 131 + norm.charCodeAt(i + 1) + 101,
          dim,
        )
      ] += 1.6;
    }
    if (i + 2 < norm.length) {
      v[
        hashFeature(
          norm.charCodeAt(i) * 131 * 131 +
            norm.charCodeAt(i + 1) * 131 +
            norm.charCodeAt(i + 2) +
            303,
          dim,
        )
      ] += 1.1;
    }
  }
  let n = 0;
  for (let i = 0; i < dim; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

function softmax(logits: number[]): number[] {
  let max = -Infinity;
  for (const x of logits) if (x > max) max = x;
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((x) => x / sum);
}

export interface IntentPrediction {
  label: ModelIntentLabel;
  score: number;
}

/** Tiny bundled n-gram softmax classifier (~30KB, no network / API key). */
export function classifyIntent(normText: string): IntentPrediction | null {
  const text = normText.trim();
  if (!text) return null;

  const { dim, labels, weights, bias, minScore } = model;
  const x = featurize(text, dim);
  const logits = labels.map((_, k) => {
    let s = bias[k] ?? 0;
    const row = weights[k];
    for (let i = 0; i < dim; i++) s += (row[i] ?? 0) * x[i];
    return s;
  });
  const probs = softmax(logits);
  let best = 0;
  for (let k = 1; k < probs.length; k++) {
    if (probs[k]! > probs[best]!) best = k;
  }
  const label = labels[best]!;
  const score = probs[best]!;
  if (label === "none" || score < minScore) return null;
  return { label, score };
}

/** Strip common “play …” prefixes when model says search_play. */
export function guessSearchQuery(norm: string): string | null {
  const stripped = norm
    .replace(
      /^(?:帮我|给我|替我|麻烦你?|请)?(?:播放|放|放一首|放一下|来一首|点一首|点播|听一下|我想听|我要听|想听|要听|听听|搜索|搜一下|搜|找一下|找歌|找一首)(?:一下|一首|这个|那个)?/,
      "",
    )
    .replace(/^(?:一下|一首|一个|这个|那个|首)/, "")
    .replace(
      /(?:的)?(?:音乐|歌曲|歌单|歌曲吧|音乐吧|歌吧)$/g,
      "",
    )
    .replace(/(?:谢谢你|谢谢)$/g, "")
    .trim();
  if (stripped.length >= 1 && stripped !== norm) return stripped;
  if (norm.length >= 2) return norm;
  return null;
}
