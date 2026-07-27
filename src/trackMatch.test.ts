import { describe, expect, it } from "vitest";
import {
  findBestMatchingTrack,
  isSameSong,
  normalizeArtistName,
  normalizeSongTitle,
  scoreTrackMatch,
  uniqueTracks,
} from "./trackMatch";
import type { Track } from "./types";

function track(
  partial: Partial<Track> & Pick<Track, "id" | "title" | "artist">,
): Track {
  return {
    provider: "netease",
    playability: "full",
    ...partial,
  };
}

describe("normalizeSongTitle", () => {
  it("strips track numbers and brackets", () => {
    expect(normalizeSongTitle("01.告白气球")).toBe("告白气球");
    expect(normalizeSongTitle("【LIVE】晴天")).toBe("晴天");
  });

  it("strips trailing version tags", () => {
    expect(normalizeSongTitle("稻香 官方版")).toBe("稻香");
  });
});

describe("normalizeArtistName", () => {
  it("drops filler words", () => {
    expect(normalizeArtistName("周杰伦 精选")).toContain("周杰伦");
  });
});

describe("isSameSong", () => {
  it("matches identical provider keys", () => {
    const a = track({ id: "1", title: "晴天", artist: "周杰伦" });
    const b = track({ id: "1", title: "其他", artist: "别人" });
    expect(isSameSong(a, b)).toBe(true);
  });

  it("matches cross-source by title", () => {
    const a = track({
      id: "a",
      provider: "netease",
      title: "晴天",
      artist: "周杰伦",
    });
    const b = track({
      id: "b",
      provider: "qq",
      title: "晴天",
      artist: "周杰伦",
    });
    expect(isSameSong(a, b)).toBe(true);
  });
});

describe("uniqueTracks", () => {
  it("dedupes same song across providers", () => {
    const list = uniqueTracks([
      track({ id: "1", provider: "netease", title: "晴天", artist: "周杰伦" }),
      track({ id: "2", provider: "qq", title: "晴天", artist: "周杰伦" }),
      track({ id: "3", provider: "kugou", title: "稻香", artist: "周杰伦" }),
    ]);
    expect(list).toHaveLength(2);
  });
});

describe("scoreTrackMatch", () => {
  it("scores exact title highest", () => {
    const t = track({ id: "1", title: "香草吧噗", artist: "测试" });
    expect(scoreTrackMatch(t, "香草吧噗")).toBeGreaterThanOrEqual(100);
  });

  it("boosts artist when title alone is only a partial hit", () => {
    const hit = track({ id: "1", title: "七里香", artist: "周杰伦" });
    const miss = track({ id: "2", title: "七里香演唱会录音", artist: "路人" });
    expect(scoreTrackMatch(hit, "周杰伦的七里香")).toBeGreaterThan(
      scoreTrackMatch(miss, "周杰伦的七里香"),
    );
  });
});

describe("findBestMatchingTrack", () => {
  it("returns null when nothing scores", () => {
    expect(
      findBestMatchingTrack(
        [track({ id: "1", title: "aaa", artist: "bbb" })],
        "完全无关的歌名xyz",
        80,
      ),
    ).toBeNull();
  });

  it("picks the strongest title match", () => {
    const tracks = [
      track({ id: "1", title: "夜曲现场录音加长版", artist: "周杰伦" }),
      track({ id: "2", title: "夜曲", artist: "周杰伦" }),
    ];
    const best = findBestMatchingTrack(tracks, "夜曲");
    expect(best?.track.id).toBe("2");
  });
});
