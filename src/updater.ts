import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateProgress = {
  downloaded: number;
  total: number | null;
};

/** Returns update metadata when a newer signed release exists; otherwise null. */
export async function checkForAppUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch (e) {
    // Dev builds / missing latest.json / offline — treat as no update.
    console.warn("update check failed:", e);
    return null;
  }
}

export async function installAppUpdate(
  update: Update,
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
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
  });

  await relaunch();
}
