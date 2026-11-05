// UI P0 (2026-11-05) — one shared toast helper on top of sonner.
// sonner (~9 KB gzip) is loaded on the first call (dynamic import), never in the
// entry/login chunk. The <Toaster/> is mounted once after login (App.jsx →
// LazyAppToaster from ./lazyUi.js).
//
//   import { toast } from "../../shared/ui/toast.js";
//   toast.success("Saved");            toast.error("Could not save");
//   toast.promise(save(), { loading: "Saving…", success: "Saved", error: "Could not save" });
//
// Meaning is always in the words (never motion alone); sonner itself turns its
// animations off under prefers-reduced-motion. Success adds a 10 ms haptic tick
// on phones that support it (Android Chrome); everything else ignores it.
// Each call returns a Promise of sonner's toast id. A failed chunk load never
// throws into the caller (console.warn only) — a toast is never worth a crash.

export function haptic(ms = 10, nav = typeof navigator !== "undefined" ? navigator : undefined) {
  try { if (nav && typeof nav.vibrate === "function") nav.vibrate(ms); } catch {}
}

/** Build a toast API around a loader that resolves to the sonner module ({ toast }). */
export function createToast(load, { onSuccess = () => haptic() } = {}) {
  let pending = null;
  const lib = () => (pending ||= Promise.resolve().then(load).catch((e) => { pending = null; throw e; }));
  const call = (fn) => lib().then((m) => fn(m.toast)).catch((e) => { try { console.warn("[toast] unavailable:", e?.message || e); } catch {} return undefined; });

  const toast = (message, opts) => call((t) => t(message, opts));
  toast.success = (message, opts) => { onSuccess(); return call((t) => t.success(message, opts)); };
  toast.error = (message, opts) => call((t) => t.error(message, opts));
  toast.info = (message, opts) => call((t) => t.info(message, opts));
  toast.warning = (message, opts) => call((t) => t.warning(message, opts));
  toast.promise = (promise, msgs, opts) => {
    const p = Promise.resolve(promise);
    p.then(() => onSuccess(), () => {});
    return call((t) => t.promise(p, { ...msgs, ...opts }));
  };
  toast.dismiss = (id) => call((t) => t.dismiss(id));
  /** Start downloading sonner early (e.g. right after login) without showing anything. */
  toast.preload = () => lib().then(() => true, () => false);
  return toast;
}

export const toast = createToast(() => import("sonner"));
export default toast;
