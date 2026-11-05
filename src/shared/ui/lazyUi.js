// UI P0 (2026-11-05) — on-demand UI pieces. Each one is its own chunk: nothing
// here is in the entry/login download, and a page pays only for what it renders.
import { lazy } from "react";
import { importWithReload } from "../../utils/lazyImport.js";

/** The one sonner <Toaster/> — mounted once by the signed-in app shell.
 *  If its chunk cannot load, it renders nothing (a toast area is never worth an error screen). */
export const LazyAppToaster = lazy(() => importWithReload(() => import("./AppToaster.jsx"))
  .catch((e) => { try { console.warn("[toast] toaster unavailable:", e?.message || e); } catch {} return { default: () => null }; }));

/** TanStack Table + Virtual grid skeleton — admin pages only (not used yet). */
export const LazyDataTable = lazy(() => importWithReload(() => import("./DataTable.jsx")));
