// src/shared/theme.js — Light / Dark colour mode (Petrol Steel theme, 2026-11-05).
//
// Each person picks a mode; it is remembered in this browser only (localStorage,
// every access wrapped in try/catch so a private window or blocked storage just
// falls back to "light"). First visit = LIGHT (owner rule 2026-11-05).
// 2026-11-27 (owner): only TWO options, Light and Dark. "Auto" (follow the
// device) is gone; a browser that still has "auto" saved opens in Light.
// The resolved mode lives on <html data-theme="light|dark">; the CSS in
// world-ui.css reads it (plus a prefers-color-scheme fallback for the moment
// before this script runs — index.html sets the attribute before first paint).
// Switching adds html.theme-xf for 260 ms: a 200 ms colour-only cross-fade, no
// layout change (see world-ui.css). Visual only — no data, logic or permissions.
import { useSyncExternalStore } from "react";

export const THEME_KEY = "erp_theme_mode";
export const THEME_MODES = ["light", "dark"];
const META_COLOR = { light: "#0C1424", dark: "#061012" };

export function readThemeMode() {
  try { const v = localStorage.getItem(THEME_KEY); return THEME_MODES.includes(v) ? v : "light"; } catch { return "light"; }
}

export function resolveTheme(mode) {
  return mode === "dark" ? "dark" : "light";
}

let mode = typeof window !== "undefined" ? readThemeMode() : "light";
const subs = new Set();
let xfTimer = 0;

function apply(fade) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveTheme(mode);
  if (fade && root.getAttribute("data-theme") !== resolved) {
    root.classList.add("theme-xf");
    clearTimeout(xfTimer);
    xfTimer = setTimeout(() => root.classList.remove("theme-xf"), 260);
  }
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-mode", mode);
  root.style.colorScheme = resolved;
  try { const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", META_COLOR[resolved]); } catch { /* cosmetic */ }
}

export function getThemeMode() { return mode; }

export function setThemeMode(next) {
  if (!THEME_MODES.includes(next) || next === mode) return;
  mode = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* per-browser preference only */ }
  apply(true);
  subs.forEach((f) => f());
}

function subscribe(f) { subs.add(f); return () => subs.delete(f); }

export function useThemeMode() {
  return useSyncExternalStore(subscribe, getThemeMode, () => "light");
}

// Call once at boot: applies the saved mode (an old saved "auto" reads as light).
export function installTheme() {
  apply(false);
  // Another tab changed the mode: follow it.
  try {
    window.addEventListener("storage", (e) => {
      if (e.key !== THEME_KEY) return;
      const v = THEME_MODES.includes(e.newValue) ? e.newValue : "light";
      if (v !== mode) { mode = v; apply(true); subs.forEach((f) => f()); }
    });
  } catch { /* ignore */ }
}
