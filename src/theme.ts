import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ThemeMode } from "./types";

export const THEME_STORAGE_KEY = "yinzhan-theme";

const DARK_BG = "#141210";
const LIGHT_BG = "#f7f4ee";

export function readStoredTheme(): ThemeMode {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "light" ? "light" : "dark";
}

export function writeStoredTheme(theme: ThemeMode) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/** Apply theme to document before React paint (call from main). */
export function applyDocumentTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

export async function syncWindowTheme(theme: ThemeMode) {
  try {
    const win = getCurrentWindow();
    await win.setTheme(theme);
    await win.setBackgroundColor(theme === "light" ? LIGHT_BG : DARK_BG);
  } catch {
    // Web preview / non-Tauri — ignore.
  }
}

export function themeLabel(theme: ThemeMode): string {
  return theme === "light" ? "浅色" : "深色";
}
