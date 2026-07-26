export type ProviderHealthEntry = {
  ok: number;
  fail: number;
  lastError?: string;
  lastErrorAt?: string;
  lastOkAt?: string;
};

const HEALTH_KEY = "yinzhan-provider-health-v1";
const DISABLED_KEY = "yinzhan-disabled-providers";
const MAX_PROVIDERS = 32;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function trimHealth(
  health: Record<string, ProviderHealthEntry>,
): Record<string, ProviderHealthEntry> {
  const ids = Object.keys(health);
  if (ids.length <= MAX_PROVIDERS) return health;
  const ranked = ids.sort((a, b) => {
    const aTime = health[a].lastOkAt || health[a].lastErrorAt || "";
    const bTime = health[b].lastOkAt || health[b].lastErrorAt || "";
    return bTime.localeCompare(aTime);
  });
  const kept = ranked.slice(0, MAX_PROVIDERS);
  const next: Record<string, ProviderHealthEntry> = {};
  for (const id of kept) next[id] = health[id];
  return next;
}

export function readDisabledProviders(): Set<string> {
  const list = readJson<string[]>(DISABLED_KEY, []);
  return new Set(list);
}

export function writeDisabledProviders(ids: Set<string>): void {
  writeJson(DISABLED_KEY, [...ids]);
}

export function toggleProviderDisabled(id: string): Set<string> {
  const next = readDisabledProviders();
  if (next.has(id)) next.delete(id);
  else next.add(id);
  writeDisabledProviders(next);
  return next;
}

export function readProviderHealth(): Record<string, ProviderHealthEntry> {
  return readJson<Record<string, ProviderHealthEntry>>(HEALTH_KEY, {});
}

function persistHealth(health: Record<string, ProviderHealthEntry>): void {
  writeJson(HEALTH_KEY, trimHealth(health));
}

export function recordProviderOk(provider: string): void {
  const health = readProviderHealth();
  const entry = health[provider] ?? { ok: 0, fail: 0 };
  entry.ok += 1;
  entry.lastOkAt = new Date().toISOString();
  health[provider] = entry;
  persistHealth(health);
}

export function recordProviderFail(provider: string, message: string): void {
  const health = readProviderHealth();
  const entry = health[provider] ?? { ok: 0, fail: 0 };
  entry.fail += 1;
  entry.lastError = message.slice(0, 200);
  entry.lastErrorAt = new Date().toISOString();
  health[provider] = entry;
  persistHealth(health);
}
