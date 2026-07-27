import { describe, expect, it } from "vitest";
import { parseVoiceText } from "./voice";

describe("play favorites voice intent", () => {
  const phrases = [
    "播放收藏里面的音乐",
    "播放收藏里的歌",
    "播放我的收藏",
    "播放收藏",
    "来点收藏",
    "听收藏里面的歌",
    "从收藏里播放",
    "把收藏里的歌播放起来",
    "打开收藏夹",
  ];

  for (const phrase of phrases) {
    it(`maps「${phrase}」to play_favorites when awake`, () => {
      const intent = parseVoiceText(phrase, true);
      expect(intent).toEqual({ kind: "command", action: "play_favorites" });
    });

    it(`maps「小栈${phrase}」to wake_and_command`, () => {
      const intent = parseVoiceText(`小栈${phrase}`, false);
      expect(intent).toEqual({
        kind: "wake_and_command",
        action: "play_favorites",
      });
    });
  }

  it("does not treat favorite-this-track as play_favorites", () => {
    expect(parseVoiceText("收藏这首", true)).toEqual({
      kind: "command",
      action: "favorite",
    });
    expect(parseVoiceText("取消收藏", true)).toEqual({
      kind: "command",
      action: "unfavorite",
    });
  });

  it("still searches song titles", () => {
    expect(parseVoiceText("播放七里香", true)).toEqual({
      kind: "search_play",
      query: "七里香",
    });
  });
});
