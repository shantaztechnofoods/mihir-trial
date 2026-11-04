// 2026-11-03 — app-wide "No internet" banner + the offline guard for write
// buttons (see src/utils/online.js for the decision and the pure helpers).
//
// * navigator.onLine + online/offline events decide "offline".
// * A failed save ("erp-save-failed", fired by saveFailed in App.jsx) is a
//   hint: if the browser already knows it is offline the banner switches to
//   offline at once; otherwise the calm message shows for a few seconds.
// * While offline, any element marked data-needs-net is shown disabled with a
//   small "Offline" tag (index.css, html.erp-offline) and a tap on it is
//   swallowed in the capture phase — the handler never runs, nothing is
//   queued, and the open popup keeps everything typed / signed / ticked.
// * Back online: green "Back online ✓" for 2 s. Fresh data comes from the
//   existing realtime catch-up (useRealtimeTables refetches every Machine
//   Tracker table on the browser's "online" event) — no new store calls here.
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { readOnline, subscribeOnline, bannerReducer, offlineGuardTarget, BACK_MS, HINT_MS } from "../../utils/online.js";

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => readOnline(), () => true);
}

export default function OfflineBanner() {
  const online = useOnline();
  const [state, dispatch] = useReducer(bannerReducer, readOnline() ? "hidden" : "offline");
  const [pulse, setPulse] = useState(0);

  useEffect(() => { dispatch({ type: online ? "online" : "offline" }); }, [online]);
  useEffect(() => {
    if (state === "back") { const t = setTimeout(() => dispatch({ type: "backDone" }), BACK_MS); return () => clearTimeout(t); }
    if (state === "hint") { const t = setTimeout(() => dispatch({ type: "hintDone" }), HINT_MS); return () => clearTimeout(t); }
    return undefined;
  }, [state]);

  // The disabled look for write buttons hangs off one class on <html>.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("erp-offline", !online);
    return () => el.classList.remove("erp-offline");
  }, [online]);

  useEffect(() => {
    const onFail = () => dispatch({ type: "saveFailed", online: readOnline() });
    const onPulse = () => setPulse((n) => n + 1);
    // Capture phase on window runs before React's root listener, so the
    // button's own onClick never fires while offline.
    const guard = (e) => {
      if (!offlineGuardTarget(e.target, readOnline())) return;
      e.preventDefault(); e.stopPropagation();
      onPulse();
    };
    window.addEventListener("erp-save-failed", onFail);
    window.addEventListener("erp-offline-pulse", onPulse);
    // (Enter / Space on a button arrive here as a click too.)
    window.addEventListener("click", guard, true);
    return () => {
      window.removeEventListener("erp-save-failed", onFail);
      window.removeEventListener("erp-offline-pulse", onPulse);
      window.removeEventListener("click", guard, true);
    };
  }, []);

  const shown = state !== "hidden";
  // Keep the last message while the banner slides out (no empty flash).
  const lastRef = useRef(state); if (shown) lastRef.current = state;
  const back = lastRef.current === "back";
  return (
    <div data-offline-banner={state} role="status" aria-live="polite" aria-hidden={!shown}
         className={`offline-banner${shown ? " is-shown" : ""}${back ? " is-back" : ""}`}>
      <div key={pulse} className={`offline-banner-card${pulse ? " is-pulse" : ""}`}>
        {back ? <Wifi size={18} strokeWidth={2.4} aria-hidden="true" /> : <WifiOff size={18} strokeWidth={2.4} aria-hidden="true" />}
        <span className="offline-banner-text">
          {back ? "Back online ✓" : <><b>No internet</b> — your work is not lost. Wait for the connection, then press again.</>}
        </span>
      </div>
    </div>
  );
}
