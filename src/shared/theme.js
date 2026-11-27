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
// Switching (perf/inp-theme-toggle, 2026-11-27 — was a 200 ms cross-fade that
// put a transition on EVERY element, ~550 ms to the next paint at 4x CPU):
//   * the swap is instant and only flips the --p-* tokens (data-theme on <html>);
//   * html.theme-xf turns transitions OFF for the one frame of the swap, so no
//     element animates its colour (no flash, no per-frame restyle); it is
//     removed once the new colours are painted and the page is idle;
//   * the dark-only inline-colour remaps (style="…" substring selectors) live in
//     theme-inline-dark.css and are switched on only while the page is dark, so
//     light mode never tests elements against them.
// No layout change. Visual only — no data, logic or permissions.
import { useSyncExternalStore } from "react";
import inlineDarkCss from "./theme-inline-dark.css?inline";

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
let inlineDark = null;

// The dark-only sheet: one <style> element, active (media="screen") only in dark.
// Created at boot (installTheme → apply) in both modes, so it always sits at the
// same place in the cascade: after the main CSS, before any lazily loaded page CSS
// (where these rules were when they lived in world-ui.css).
function setInlineDark(on) {
  try {
    if (!inlineDark) {
      inlineDark = document.createElement("style");
      inlineDark.setAttribute("data-theme-inline-dark", "");
      inlineDark.media = on ? "screen" : "not all";
      inlineDark.textContent = inlineDarkCss;
      document.head.appendChild(inlineDark);
      return;
    }
    const media = on ? "screen" : "not all";
    if (inlineDark.media !== media) inlineDark.media = media;
  } catch { /* cosmetic only */ }
}

function write(root, resolved, keepSheet = false) {
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-mode", mode);
  root.style.colorScheme = resolved;
  // Light → dark: the remaps must be on in the same frame. Dark → light: they
  // match nothing in light, so a switch defers turning them off to idle time
  // (a stylesheet change empties the browser's style cache: one less full restyle
  // in the frame the person is waiting for).
  if (resolved === "dark" || !keepSheet) setInlineDark(resolved === "dark");
  try { const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", META_COLOR[resolved]); } catch { /* cosmetic */ }
}

function apply(fade) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveTheme(mode);
  if (!fade || root.getAttribute("data-theme") === resolved) return write(root, resolved);
  // Instant swap with transitions off for this frame (one style recalc, then paint).
  // Clean-up (transitions back on, dark-only sheet off in light) is one more full
  // restyle, so it waits until the new colours are on screen and the page is idle.
  cancelIdle();
  root.classList.add("theme-xf");
  write(root, resolved, true);
  idleId = onIdle(() => {
    idleId = null;
    root.classList.remove("theme-xf");
    setInlineDark(root.getAttribute("data-theme") === "dark");
  });
}

let idleId = null;
// After the next paint (two frames), then when the main thread is free (at most ~0.3 s later).
function onIdle(fn) {
  const h = { dead: false, ric: 0, t: 0 };
  const ric = typeof window !== "undefined" && typeof window.requestIdleCallback === "function";
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 16);
  const run = () => { if (!h.dead) fn(); };
  raf(() => raf(() => { if (h.dead) return; if (ric) h.ric = window.requestIdleCallback(run, { timeout: 300 }); else h.t = setTimeout(run, 120); }));
  h.cancel = () => { h.dead = true; if (h.ric) window.cancelIdleCallback(h.ric); if (h.t) clearTimeout(h.t); };
  return h;
}
function cancelIdle() { if (idleId) { idleId.cancel(); idleId = null; } }

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
