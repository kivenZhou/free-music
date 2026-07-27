import { describe, expect, it } from "vitest";
import {
  formatStreamQuality,
  playbackDuration,
  sortProvidersByOrder,
} from "./playerUtils";
import type { ProviderInfo } from "./types";

describe("sortProvidersByOrder", () => {
  const list: ProviderInfo[] = [
    { id: "netease", name: "网易云" },
    { id: "qq", name: "QQ" },
    { id: "kugou", name: "酷狗" },
  ];

  it("keeps original order when no preference", () => {
    expect(sortProvidersByOrder(list, []).map((p) => p.id)).toEqual([
      "netease",
      "qq",
      "kugou",
    ]);
  });

  it("ranks known ids first", () => {
    expect(
      sortProvidersByOrder(list, ["kugou", "netease"]).map((p) => p.id),
    ).toEqual(["kugou", "netease", "qq"]);
  });
});

describe("playbackDuration", () => {
  it("falls back to metadata ms", () => {
    expect(playbackDuration(null, 90_000)).toBe(90);
  });

  it("prefers audio.duration when finite", () => {
    const audio = {
      duration: 120,
      seekable: { length: 0 },
    } as HTMLAudioElement;
    expect(playbackDuration(audio, 90_000)).toBe(120);
  });
});

describe("formatStreamQuality", () => {
  it("formats bitrate numbers", () => {
    expect(formatStreamQuality("320000")).toBe("320kbps");
    expect(formatStreamQuality("128")).toBe("128kbps");
  });

  it("hides opaque cache labels", () => {
    expect(formatStreamQuality("cache")).toBeNull();
    expect(formatStreamQuality("outer")).toBeNull();
  });
});
