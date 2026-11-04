// 2026-11-04 — double-submit protection (fix/harden-2). Pure, unit-tested.
//
// A worker on a slow tablet taps "Accept" / "Put on hold" / "Delete" twice;
// both taps reach the handler before the first write has re-rendered the
// screen, so both pass the "is it still pending?" check against stale state.
// makeInFlight() keeps the set of keys whose write is still running; a second
// call with the same key while the first is in flight is refused with
// BUSY_RESULT instead of writing twice. The key is released when the first
// call settles (resolve OR throw), so a genuine retry after a failure works.

export const BUSY_MESSAGE = "Already saving — please wait a moment.";
export const BUSY_RESULT = Object.freeze({ success: false, busy: true, error: BUSY_MESSAGE });

export function makeInFlight() {
  const keys = new Set();
  // Run fn() unless `key` is already running. Always returns a Promise.
  const run = async (key, fn) => {
    if (key == null || key === "") return fn();
    if (keys.has(key)) {
      try { console.warn("[inFlight] duplicate submit ignored:", key); } catch { /* ignore */ }
      return BUSY_RESULT;
    }
    keys.add(key);
    try {
      return await fn();
    } finally {
      keys.delete(key);
    }
  };
  // Wrap an async handler: keyOf(...args) names the record being written.
  const guard = (keyOf, fn) => (...args) => {
    let key = null;
    try { key = keyOf(...args); } catch { key = null; }
    return run(key, () => fn(...args));
  };
  return { run, guard, has: (k) => keys.has(k), size: () => keys.size };
}

// A refetch "latest wins" sequencer: when two refetches of the same table
// overlap (realtime + catch-up + a handler's own refetch), the slower, OLDER
// response must not overwrite the newer one.
export function makeLatest() {
  let seq = 0;
  return (promise, apply) => {
    const mine = ++seq;
    return Promise.resolve(promise).then((v) => { if (mine === seq) apply(v); return v; }, (e) => { try { console.warn("[refetch] failed", e); } catch { /* ignore */ } });
  };
}
