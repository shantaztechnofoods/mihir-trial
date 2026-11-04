// 2026-11-04 (fix/perf-1) — on-demand chunks (lazy pages, charts). After a new
// deploy an already-open tab may ask for a chunk file that no longer exists;
// reload ONCE per tab to pick up the new build instead of showing an error.
const FLAG = "erp_chunk_reload";
export function importWithReload(load) {
  return load().then((m) => { try { sessionStorage.removeItem(FLAG); } catch {} return m; }).catch((e) => {
    try {
      if (typeof window !== "undefined" && !sessionStorage.getItem(FLAG)) {
        sessionStorage.setItem(FLAG, "1");
        window.location.reload();
        return new Promise(() => {});
      }
    } catch {}
    throw e;
  });
}
