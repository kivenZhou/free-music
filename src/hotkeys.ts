import {
  isRegistered,
  register,
  unregister,
  unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";

export const HOTKEYS_ENABLED_KEY = "yinzhan-hotkeys-enabled";
export const HOTKEYS_MAP_KEY = "yinzhan-hotkeys-map-v1";

export type HotkeyAction = "toggle" | "next" | "prev" | "favorite";

export type HotkeyHandlers = {
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onFavorite: () => void;
};

/** Sensible defaults that avoid stealing plain media keys from other apps. */
export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  toggle: "CommandOrControl+Alt+P",
  next: "CommandOrControl+Alt+Right",
  prev: "CommandOrControl+Alt+Left",
  favorite: "CommandOrControl+Alt+F",
};

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  toggle: "播放 / 暂停",
  next: "下一首",
  prev: "上一首",
  favorite: "收藏当前曲",
};

const ACTIONS: HotkeyAction[] = ["toggle", "next", "prev", "favorite"];

export function readHotkeysEnabled(): boolean {
  const raw = localStorage.getItem(HOTKEYS_ENABLED_KEY);
  // Default on for desktop music UX.
  if (raw == null) return true;
  return raw === "1";
}

export function writeHotkeysEnabled(on: boolean) {
  localStorage.setItem(HOTKEYS_ENABLED_KEY, on ? "1" : "0");
}

export function readHotkeyMap(): Record<HotkeyAction, string> {
  try {
    const raw = localStorage.getItem(HOTKEYS_MAP_KEY);
    if (!raw) return { ...DEFAULT_HOTKEYS };
    const parsed = JSON.parse(raw) as Partial<Record<HotkeyAction, string>>;
    return {
      toggle: parsed.toggle?.trim() || DEFAULT_HOTKEYS.toggle,
      next: parsed.next?.trim() || DEFAULT_HOTKEYS.next,
      prev: parsed.prev?.trim() || DEFAULT_HOTKEYS.prev,
      favorite: parsed.favorite?.trim() || DEFAULT_HOTKEYS.favorite,
    };
  } catch {
    return { ...DEFAULT_HOTKEYS };
  }
}

export function writeHotkeyMap(map: Record<HotkeyAction, string>) {
  localStorage.setItem(HOTKEYS_MAP_KEY, JSON.stringify(map));
}

/** Editable field form — avoid awkward "Or" in CommandOrControl. */
export function toHotkeyDisplay(accel: string): string {
  return accel
    .replace(/CommandOrControl/gi, "Command/Control")
    .replace(/CmdOrCtrl/gi, "Cmd/Ctrl");
}

/** Normalize user input back to Tauri accelerator syntax. */
export function fromHotkeyDisplay(text: string): string {
  return text
    .trim()
    .replace(/Command\s*\/\s*Control/gi, "CommandOrControl")
    .replace(/Cmd\s*\/\s*Ctrl/gi, "CommandOrControl")
    .replace(/⌘\s*\/\s*Ctrl/gi, "CommandOrControl");
}

function displayAccel(accel: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return toHotkeyDisplay(accel)
    .replace(/Command\/Control/gi, isMac ? "⌘" : "Ctrl")
    .replace(/Cmd\/Ctrl/gi, isMac ? "⌘" : "Ctrl")
    .replace(/CommandOrControl/gi, isMac ? "⌘" : "Ctrl")
    .replace(/Command/gi, "⌘")
    .replace(/Control/gi, "Ctrl")
    .replace(/Alt/gi, isMac ? "⌥" : "Alt")
    .replace(/Shift/gi, isMac ? "⇧" : "Shift")
    .replace(/\+/g, " + ");
}

export function formatHotkeyAccel(accel: string): string {
  return displayAccel(accel);
}

export function normalizeHotkeyMap(
  map: Record<HotkeyAction, string>,
): Record<HotkeyAction, string> {
  return {
    toggle: fromHotkeyDisplay(map.toggle) || DEFAULT_HOTKEYS.toggle,
    next: fromHotkeyDisplay(map.next) || DEFAULT_HOTKEYS.next,
    prev: fromHotkeyDisplay(map.prev) || DEFAULT_HOTKEYS.prev,
    favorite: fromHotkeyDisplay(map.favorite) || DEFAULT_HOTKEYS.favorite,
  };
}

async function safeUnregister(accel: string) {
  try {
    if (await isRegistered(accel)) {
      await unregister(accel);
    }
  } catch {
    // ignore — shortcut may already be gone
  }
}

export async function unregisterAllHotkeys(map?: Record<HotkeyAction, string>) {
  try {
    await unregisterAll();
    return;
  } catch {
    // Fall back to per-accelerator cleanup if unregisterAll is unavailable.
  }
  if (!map) return;
  const unique = [...new Set(ACTIONS.map((a) => map[a]).filter(Boolean))];
  await Promise.all(unique.map((accel) => safeUnregister(accel)));
}

/**
 * Register global shortcuts. Returns list of accelerators that failed
 * (usually already taken by another app).
 */
export async function registerHotkeys(
  map: Record<HotkeyAction, string>,
  handlers: HotkeyHandlers,
): Promise<string[]> {
  await unregisterAllHotkeys(map);

  const failed: string[] = [];
  const byAccel = new Map<string, HotkeyAction[]>();
  for (const action of ACTIONS) {
    const accel = map[action]?.trim();
    if (!accel) continue;
    const list = byAccel.get(accel) ?? [];
    list.push(action);
    byAccel.set(accel, list);
  }

  for (const [accel, actions] of byAccel) {
    try {
      if (await isRegistered(accel)) {
        await unregister(accel);
      }
      await register(accel, (event) => {
        if (event.state !== "Pressed") return;
        for (const action of actions) {
          switch (action) {
            case "toggle":
              handlers.onToggle();
              break;
            case "next":
              handlers.onNext();
              break;
            case "prev":
              handlers.onPrev();
              break;
            case "favorite":
              handlers.onFavorite();
              break;
          }
        }
      });
    } catch (e) {
      console.warn("register hotkey failed", accel, e);
      failed.push(accel);
    }
  }

  return failed;
}
