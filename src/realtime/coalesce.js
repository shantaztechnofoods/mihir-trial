// 2026-11-04 — trailing debounce with a max wait, used to coalesce bursts of
// realtime events into one refetch. Pure (timers injectable) for unit tests.
//
//   const run = makeCoalescer(fn, { wait: 300, maxWait: 1500 });
//   run(payload)  — schedules fn(lastPayload); bursts collapse into one call
//   run.cancel()  — drop anything pending (channel teardown / unmount)
export function makeCoalescer(fn, { wait = 300, maxWait = 1500, setT = setTimeout, clearT = clearTimeout, now = () => Date.now() } = {}) {
  let timer = null;
  let firstAt = 0;
  let last;
  const fire = () => {
    timer = null;
    firstAt = 0;
    const p = last;
    last = undefined;
    fn(p);
  };
  const run = (payload) => {
    last = payload;
    const t = now();
    if (!firstAt) firstAt = t;
    if (timer) clearT(timer);
    const remaining = Math.max(0, Math.min(wait, maxWait - (t - firstAt)));
    timer = setT(fire, remaining);
  };
  run.cancel = () => { if (timer) clearT(timer); timer = null; firstAt = 0; last = undefined; };
  run.pending = () => !!timer;
  return run;
}
