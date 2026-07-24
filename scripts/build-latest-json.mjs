#!/usr/bin/env node
/**
 * Merge signed updater artifacts into latest.json for GitHub Releases.
 *
 * Expected files in --dir (names may vary; matched by suffix):
 *   *_aarch64.app.tar.gz(+.sig)  → darwin-aarch64
 *   *_x64.app.tar.gz(+.sig)      → darwin-x86_64  (or *_x86_64.*)
 *   *_windows_x64-setup.exe(+.sig) / *_x64-setup.exe(+.sig) → windows-x86_64
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const dir = path.resolve(arg("--dir", "release-files"));
const version = arg("--version", process.env.VERSION || "");
const tag = arg("--tag", process.env.TAG || `v${version}`);
const repo = arg("--repo", process.env.GITHUB_REPOSITORY || "kivenZhou/free-music");
const out = path.resolve(arg("--out", path.join(dir, "latest.json")));
const notes = arg("--notes", process.env.RELEASE_NOTES || "");

if (!version) {
  console.error("Missing --version");
  process.exit(1);
}

const files = fs.readdirSync(dir);
const base = `https://github.com/${repo}/releases/download/${tag}`;

function findPair(matchFn) {
  const artifact = files.find((f) => matchFn(f) && !f.endsWith(".sig"));
  if (!artifact) return null;
  const sigName = `${artifact}.sig`;
  if (!files.includes(sigName)) {
    console.warn(`Missing signature for ${artifact}`);
    return null;
  }
  return {
    url: `${base}/${artifact}`,
    signature: fs.readFileSync(path.join(dir, sigName), "utf8").trim(),
  };
}

const platforms = {};

const aarch64 = findPair(
  (f) =>
    f.endsWith(".app.tar.gz") &&
    (f.includes("aarch64") || f.includes("arm64")),
);
if (aarch64) platforms["darwin-aarch64"] = aarch64;

const x64Mac = findPair(
  (f) =>
    f.endsWith(".app.tar.gz") &&
    (f.includes("_x64.") || f.includes("x86_64") || f.includes("x86-64")) &&
    !f.includes("aarch64") &&
    !f.includes("arm64"),
);
if (x64Mac) platforms["darwin-x86_64"] = x64Mac;

// Universal mac updater artifact (single .app.tar.gz without arch in name)
if (!platforms["darwin-aarch64"] && !platforms["darwin-x86_64"]) {
  const uni = findPair(
    (f) => f.endsWith(".app.tar.gz") && f.includes("universal"),
  );
  if (uni) {
    platforms["darwin-aarch64"] = uni;
    platforms["darwin-x86_64"] = uni;
  }
}

const win = findPair(
  (f) =>
    f.endsWith(".exe") &&
    (f.includes("windows") || f.includes("setup") || f.includes("nsis")),
);
if (win) platforms["windows-x86_64"] = win;

if (Object.keys(platforms).length === 0) {
  console.error("No signed updater artifacts found in", dir);
  console.error("Files:", files.join(", ") || "(empty)");
  process.exit(1);
}

const manifest = {
  version,
  notes: notes || `YinZhan ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Wrote", out);
console.log(JSON.stringify(manifest, null, 2));
