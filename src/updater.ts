import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateProgress = {
  downloaded: number;
  total: number | null;
};

export type UpdateCheckResult = {
  /** Tauri updater handle — only set when a signed package can be installed in-app. */
  update: Update | null;
  /** Remote release version (without leading v), if known. */
  remoteVersion: string | null;
  /** User-facing status. */
  status: "up-to-date" | "available" | "unavailable";
  message: string;
};

const RELEASES_API =
  "https://api.github.com/repos/kivenZhou/free-music/releases/latest";
const RELEASES_PAGE =
  "https://github.com/kivenZhou/free-music/releases/latest";
const CHECK_TIMEOUT_MS = 12_000;

function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, "");
}

/** Semver-ish compare: a>b → 1, a<b → -1, equal → 0. */
function compareVersion(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(/[.+-]/)
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = normalizeVersion(b)
    .split(/[.+-]/)
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x > y ? 1 : -1;
      continue;
    }
    const xs = String(x);
    const ys = String(y);
    if (xs !== ys) return xs > ys ? 1 : -1;
  }
  return 0;
}

async function fetchLatestReleaseTag(): Promise<{
  tag: string;
  hasUpdaterManifest: boolean;
} | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_API, {
      signal: ctrl.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      assets?: { name?: string }[];
    };
    const tag = data.tag_name;
    if (!tag) return null;
    const hasUpdaterManifest = (data.assets ?? []).some(
      (a) => a.name === "latest.json",
    );
    return { tag, hasUpdaterManifest };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Check for updates.
 * Prefer GitHub API (usually reachable) for version compare; only hit the
 * signed updater endpoint when a newer release actually ships latest.json.
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const current = normalizeVersion(await getVersion().catch(() => "0.0.0"));
  const release = await fetchLatestReleaseTag();

  if (!release) {
    // API unreachable — last resort: Tauri updater with hard timeout.
    try {
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (update) {
        return {
          update,
          remoteVersion: normalizeVersion(update.version),
          status: "available",
          message: `发现新版本 ${normalizeVersion(update.version)}`,
        };
      }
      return {
        update: null,
        remoteVersion: current,
        status: "up-to-date",
        message: "当前已是最新版本",
      };
    } catch {
      return {
        update: null,
        remoteVersion: null,
        status: "unavailable",
        message: `无法连接更新服务器，请稍后重试或手动查看 ${RELEASES_PAGE}`,
      };
    }
  }

  const remote = normalizeVersion(release.tag);
  if (compareVersion(remote, current) <= 0) {
    return {
      update: null,
      remoteVersion: remote,
      status: "up-to-date",
      message: "当前已是最新版本",
    };
  }

  // Newer release exists.
  if (!release.hasUpdaterManifest) {
    return {
      update: null,
      remoteVersion: remote,
      status: "available",
      message: `发现新版本 ${remote}，但尚未提供应用内更新包，请前往 Releases 手动下载`,
    };
  }

  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    if (update) {
      return {
        update,
        remoteVersion: normalizeVersion(update.version),
        status: "available",
        message: `发现新版本 ${normalizeVersion(update.version)}`,
      };
    }
  } catch (e) {
    console.warn("signed updater unreachable:", e);
  }

  return {
    update: null,
    remoteVersion: remote,
    status: "available",
    message: `发现新版本 ${remote}，自动更新通道暂时不可用，请手动下载或稍后重试`,
  };
}

/** Quiet launch check — only returns an installable Update handle. */
export async function checkForInstallableUpdate(): Promise<Update | null> {
  try {
    const release = await fetchLatestReleaseTag();
    if (!release?.hasUpdaterManifest) return null;
    const current = normalizeVersion(await getVersion().catch(() => "0.0.0"));
    if (compareVersion(normalizeVersion(release.tag), current) <= 0) {
      return null;
    }
    return await check({ timeout: CHECK_TIMEOUT_MS });
  } catch (e) {
    console.warn("background update check failed:", e);
    return null;
  }
}

export async function installAppUpdate(
  update: Update,
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall(
    (event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? null;
          downloaded = 0;
          onProgress?.({ downloaded, total });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          onProgress?.({ downloaded, total });
          break;
        case "Finished":
          onProgress?.({ downloaded, total });
          break;
      }
    },
    { timeout: 120_000 },
  );

  await relaunch();
}

export { RELEASES_PAGE };
