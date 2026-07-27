import { describe, expect, it } from "vitest";
import { classifyPlayError, formatPlayError } from "./playErrors";

describe("classifyPlayError", () => {
  it("strips Error prefix", () => {
    const info = classifyPlayError(new Error("Error: 未获取到可播地址"), "netease");
    expect(info.message).toBe("未获取到可播地址");
    expect(info.kind).toBe("unavailable");
    expect(info.provider).toBe("netease");
  });

  it("classifies network errors", () => {
    expect(classifyPlayError("fetch failed").kind).toBe("network");
    expect(classifyPlayError("请求超时").kind).toBe("network");
    expect(classifyPlayError("CORS blocked").kind).toBe("network");
  });

  it("classifies unavailable errors", () => {
    expect(classifyPlayError("未获取到可播地址").kind).toBe("unavailable");
    expect(classifyPlayError("VIP only preview").kind).toBe("unavailable");
    expect(classifyPlayError("track unavailable").kind).toBe("unavailable");
  });

  it("classifies media errors", () => {
    expect(classifyPlayError("MEDIA_ERR_DECODE").kind).toBe("media");
    expect(classifyPlayError("audio decode failed").kind).toBe("media");
  });

  it("classifies resolve errors", () => {
    expect(classifyPlayError("resolve play_url failed").kind).toBe("resolve");
    expect(classifyPlayError("无法解析播放地址").kind).toBe("unavailable");
  });

  it("uses kind hint for generic 播放失败", () => {
    expect(classifyPlayError("播放失败").message).toBe("播放失败");
    expect(classifyPlayError("播放失败", "qq").kind).toBe("unknown");
  });

  it("keeps specific messages", () => {
    expect(classifyPlayError("连续多首无法播放，已暂停").message).toBe(
      "连续多首无法播放，已暂停",
    );
  });

  it("formats kind-tagged messages", () => {
    expect(formatPlayError(classifyPlayError("请求超时"))).toBe("网络错误 · 请求超时");
    expect(formatPlayError(classifyPlayError("播放失败"))).toBe("播放失败");
  });
});
