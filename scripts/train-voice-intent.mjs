/**
 * Train a tiny hashed n-gram softmax intent classifier and write JSON weights.
 * No external deps — runs with plain Node.
 *
 * Usage: node scripts/train-voice-intent.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../src/voice-intent-model.json");

const LABELS = [
  "next",
  "prev",
  "play",
  "pause",
  "toggle",
  "mute",
  "volume_up",
  "volume_down",
  "show_lyrics",
  "hide_lyrics",
  "favorite",
  "unfavorite",
  "shuffle",
  "repeat",
  "clear_queue",
  "show_queue",
  "whats_playing",
  "play_favorites",
  "provider_play",
  "theme_play",
  "append_tracks",
  "search_play",
  "none",
];

const DIM = 384;
const EPOCHS = 48;
const LR = 0.18;

/** @type {Record<string, string[]>} */
const SAMPLES = {
  next: [
    "下一首",
    "下一曲",
    "下首歌",
    "切歌",
    "换歌",
    "换一首",
    "换一曲",
    "切一首",
    "跳过",
    "下一条",
    "播放下一首",
    "再来一首",
    "来下一首",
    "这首不要了",
    "换下一首",
    "跳过这首",
    "下一首歌",
    "帮我切歌",
    "帮我换一首",
    "给我下一首",
    "请下一首",
    "换掉这首",
    "不要这首了",
    "跳到下一首",
  ],
  prev: [
    "上一首",
    "上一曲",
    "上首歌",
    "前一首",
    "上一条",
    "播放上一首",
    "回上一首",
    "返回上一首",
    "刚才那首",
    "上一首歌",
    "帮我上一首",
    "倒回去一首",
    "回到上一首",
  ],
  play: [
    "播放",
    "放歌",
    "放音乐",
    "播放音乐",
    "来点音乐",
    "开始播放",
    "开始吧",
    "放吧",
    "继续",
    "继续播放",
    "继续放",
    "继续听",
    "接着放",
    "接着听",
    "接着播",
    "恢复播放",
    "接着来",
    "继续吧",
    "回来听",
    "接着放吧",
    "把音乐打开",
    "继续放音乐",
  ],
  pause: [
    "暂停",
    "停止播放",
    "先停",
    "别放了",
    "停下",
    "停一下",
    "先别放",
    "不要放了",
    "关掉音乐",
    "关闭音乐",
    "停止",
    "先暂停",
    "暂停一下",
    "先别播了",
    "音乐停一下",
    "帮我暂停",
    "请暂停",
  ],
  toggle: ["播放暂停", "暂停播放", "开始或暂停", "切换播放暂停"],
  mute: [
    "静音",
    "关闭声音",
    "把声音关了",
    "闭嘴",
    "取消静音",
    "打开声音",
    "恢复声音",
    "解除静音",
    "声音关掉",
    "把静音打开",
    "帮我静音",
  ],
  volume_up: [
    "音量加大",
    "加大音量",
    "大声点",
    "大声一点",
    "增大音量",
    "音量高",
    "大点声",
    "声音大点",
    "音量调高",
    "再大声一点",
    "声音大一些",
    "帮我调大音量",
  ],
  volume_down: [
    "音量减小",
    "减小音量",
    "小声点",
    "小声一点",
    "降低音量",
    "音量低",
    "小点声",
    "声音小点",
    "音量调低",
    "再小声一点",
    "声音小一些",
    "帮我调小音量",
  ],
  show_lyrics: [
    "显示歌词",
    "打开歌词",
    "看歌词",
    "歌词",
    "把歌词打开",
    "给我看歌词",
    "帮我打开歌词",
    "显示一下歌词",
    "打开歌词面板",
    "我想看歌词",
  ],
  hide_lyrics: [
    "关闭歌词",
    "收起歌词",
    "隐藏歌词",
    "关掉歌词",
    "把歌词关了",
    "关闭歌词面板",
    "不要歌词了",
  ],
  favorite: [
    "收藏",
    "收藏这首",
    "加入收藏",
    "添加到收藏",
    "帮我收藏",
    "收藏当前歌曲",
    "把这首歌收藏",
    "喜欢这首",
    "加到收藏",
    "收藏一下",
  ],
  unfavorite: [
    "取消收藏",
    "移除收藏",
    "不收藏了",
    "取消这首收藏",
    "从收藏里删掉",
    "取消喜欢",
    "移除收藏这首",
  ],
  shuffle: [
    "随机播放",
    "打开随机",
    "开启随机",
    "关闭随机",
    "取消随机",
    "随机模式",
  ],
  repeat: [
    "单曲循环",
    "列表循环",
    "循环播放",
    "顺序播放",
    "切换循环",
    "循环模式",
  ],
  clear_queue: [
    "清空歌单",
    "清空播放列表",
    "清除队列",
    "清空列表",
    "只留当前",
    "清空播放队列",
  ],
  show_queue: [
    "打开播放列表",
    "显示播放列表",
    "打开队列",
    "显示队列",
    "看看队列",
    "打开列表",
  ],
  whats_playing: [
    "这是什么歌",
    "现在播什么",
    "当前是什么歌",
    "在听什么",
    "播放的是什么",
    "现在播放什么",
  ],
  play_favorites: [
    "播放我的收藏",
    "播放收藏",
    "来点收藏",
    "听收藏",
    "播放收藏的歌",
    "打开收藏播放",
  ],
  provider_play: [
    "播放B站里面的音乐",
    "播放B站的音乐",
    "播放B站的歌",
    "来点B站音乐",
    "放B站的歌",
    "听B站音乐",
    "B站放点歌",
    "播放网易云的歌",
    "播放网易云音乐",
    "来点网易云",
    "放网易云热歌",
    "播放酷狗的歌",
    "来点酷狗音乐",
    "播放酷我的音乐",
    "放QQ音乐的歌",
    "播放QQ音乐",
    "来点QQ音乐",
    "切换到B站放歌",
    "用B站放音乐",
    "播放哔哩哔哩的歌",
    "放点网易云里面的歌",
    "帮我播放B站音乐",
    "我想听B站的歌",
    "播放kugou的歌",
  ],
  theme_play: [
    "播放粤语的歌",
    "播放国语的歌",
    "播放英语歌",
    "播放90年代的歌",
    "播放八十年代的歌",
    "来点轻音乐",
    "播放一首安静的歌",
    "我想听安静的歌",
    "放点流行歌",
    "我想听摇滚",
    "来点爵士",
    "播放纯音乐",
    "放一首民谣",
    "来点古风",
    "播放说唱",
    "听点治愈的歌",
    "来点睡前音乐",
    "播放日语歌",
    "播放韩语的歌",
    "来点电音",
    "播放经典老歌",
    "放点抖音热歌",
    "播放周杰伦的歌",
    "来点陈奕迅的歌",
    "播放摇滚乐",
  ],
  append_tracks: [
    "追加20首歌",
    "帮我给歌单追加20首歌",
    "再来20首",
    "再加十首",
    "加载更多",
    "多来点歌",
    "再来点音乐",
    "再补二十首",
    "给列表追加十五首",
    "再来几首",
    "追加三十首歌",
    "再加载一些",
  ],
  search_play: [
    "播放七里香",
    "放七里香",
    "播放周杰伦",
    "我想听七里香",
    "我要听晴天",
    "帮我播放稻香",
    "给我放一首青花瓷",
    "来一首夜曲",
    "点一首简单爱",
    "想听林俊杰",
    "要听告白气球",
    "听听七里香",
    "搜索周杰伦",
    "搜一下晴天",
    "找一首稻香",
    "放陈奕迅",
    "帮我放点周杰伦",
    "播放海阔天空",
    "放一下演员",
    "麻烦播放七里香",
    "请播放晴天",
    "替我放青花瓷",
    "点播夜曲",
    "听一下稻香",
    "播放薛之谦",
  ],
  none: [
    "今天天气怎么样",
    "你好",
    "你是谁",
    "几点了",
    "打开浏览器",
    "讲个笑话",
    "明天会下雨吗",
    "帮我设个闹钟",
    "谢谢",
    "没事了",
    "算了",
    "不用了",
  ],
};

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\s,，。.!！?？、；;：:\-—_'"`~]/g, "");
}

function hashFeature(n) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return (x >>> 0) % DIM;
}

/** @param {string} text */
function featurize(text) {
  const s = normalize(text);
  const v = new Float64Array(DIM);
  if (!s) return v;
  for (let i = 0; i < s.length; i++) {
    v[hashFeature(s.charCodeAt(i) + 17)] += 1;
    if (i + 1 < s.length) {
      v[hashFeature(s.charCodeAt(i) * 131 + s.charCodeAt(i + 1) + 101)] += 1.6;
    }
    if (i + 2 < s.length) {
      v[
        hashFeature(
          s.charCodeAt(i) * 131 * 131 +
            s.charCodeAt(i + 1) * 131 +
            s.charCodeAt(i + 2) +
            303,
        )
      ] += 1.1;
    }
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

function softmax(logits) {
  let max = -Infinity;
  for (const x of logits) if (x > max) max = x;
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((x) => x / sum);
}

function dot(wRow, x) {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += wRow[i] * x[i];
  return s;
}

const data = [];
for (const [label, phrases] of Object.entries(SAMPLES)) {
  const yi = LABELS.indexOf(label);
  for (const p of phrases) {
    data.push({ x: featurize(p), y: yi });
    // light augmentation: drop last char sometimes
    if (p.length > 3) {
      data.push({ x: featurize(p.slice(0, -1)), y: yi });
    }
  }
}

const W = Array.from({ length: LABELS.length }, () => new Float64Array(DIM));
const b = new Float64Array(LABELS.length);

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  // shuffle
  for (let i = data.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [data[i], data[j]] = [data[j], data[i]];
  }
  const lr = LR * (1 - epoch / (EPOCHS + 2));
  for (const { x, y } of data) {
    const logits = LABELS.map((_, k) => dot(W[k], x) + b[k]);
    const p = softmax(logits);
    for (let k = 0; k < LABELS.length; k++) {
      const err = p[k] - (k === y ? 1 : 0);
      for (let i = 0; i < DIM; i++) W[k][i] -= lr * err * x[i];
      b[k] -= lr * err;
    }
  }
}

// evaluate
let correct = 0;
for (const { x, y } of data) {
  const logits = LABELS.map((_, k) => dot(W[k], x) + b[k]);
  const p = softmax(logits);
  let best = 0;
  for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
  if (best === y) correct++;
}
const acc = correct / data.length;

const model = {
  version: 1,
  dim: DIM,
  labels: LABELS,
  weights: W.map((row) => Array.from(row, (v) => Math.round(v * 1e5) / 1e5)),
  bias: Array.from(b, (v) => Math.round(v * 1e5) / 1e5),
  minScore: 0.42,
  trainedAcc: Math.round(acc * 1000) / 1000,
};

writeFileSync(OUT, JSON.stringify(model));
console.log(
  `Wrote ${OUT} (${(JSON.stringify(model).length / 1024).toFixed(1)} KB), train acc=${(acc * 100).toFixed(1)}%`,
);
