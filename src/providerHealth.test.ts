import { beforeEach, describe, expect, it } from "vitest";
import {
  readDisabledProviders,
  readProviderHealth,
  recordProviderFail,
  recordProviderOk,
  toggleProviderDisabled,
  writeDisabledProviders,
} from "./providerHealth";

const store: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    },
    configurable: true,
  });
});

describe("providerHealth", () => {
  it("records ok and fail counts", () => {
    recordProviderOk("netease");
    recordProviderOk("netease");
    recordProviderFail("netease", "timeout");
    const health = readProviderHealth();
    expect(health.netease.ok).toBe(2);
    expect(health.netease.fail).toBe(1);
    expect(health.netease.lastError).toBe("timeout");
    expect(health.netease.lastOkAt).toBeTruthy();
    expect(health.netease.lastErrorAt).toBeTruthy();
  });

  it("toggles disabled providers", () => {
    expect(readDisabledProviders().size).toBe(0);
    const next = toggleProviderDisabled("qq");
    expect(next.has("qq")).toBe(true);
    expect(readDisabledProviders().has("qq")).toBe(true);
    const enabled = toggleProviderDisabled("qq");
    expect(enabled.has("qq")).toBe(false);
  });

  it("persists disabled list", () => {
    writeDisabledProviders(new Set(["kugou", "kuwo"]));
    expect([...readDisabledProviders()].sort()).toEqual(["kugou", "kuwo"]);
  });
});
