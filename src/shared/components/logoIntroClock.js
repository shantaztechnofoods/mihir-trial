// Wall-clock timeline for the SHANTAZ login logo intro (pure, no three.js — unit-tested).
//
// The intro follows REAL elapsed time (performance.now), not a frame count, so a throttled
// or slow browser (background tab, weak phone, screenshot tool, 10 fps) still finishes it:
//   - each frame advances by the real delta; only a single huge jump (> MAX_STEP) is clamped,
//     so one long stall never teleports the gear;
//   - while the intro is running, the timeline is never behind (wall seconds since start) ×
//     INTRO_END / INTRO_DEADLINE, so it is complete by INTRO_DEADLINE seconds of wall clock
//     whatever the frame rate;
//   - hidden page at start / during the intro → jump straight to the final pose.
export const MAX_STEP = 0.25;        // s — larger single deltas are clamped
export const INTRO_DEADLINE = 4.0;   // s of wall clock by which the intro is complete

export function createIntroClock(introEnd) {
  const s = { t: 0, prevNow: 0, startNow: 0 };
  const floorRate = (introEnd + 0.01) / INTRO_DEADLINE;   // never faster than real time (< 1 s per s)
  const finish = () => { if (s.t < introEnd) s.t = introEnd + 0.01; };
  return {
    // now: performance.now() ms of the current frame. Returns timeline seconds.
    tick(now) {
      if (!s.startNow) s.startNow = now;
      if (s.prevNow) s.t += Math.min(Math.max(0, (now - s.prevNow) / 1000), MAX_STEP);
      s.prevNow = now;
      if (s.t < introEnd) s.t = Math.max(s.t, ((now - s.startNow) / 1000) * floorRate);
      return s.t;
    },
    // the intro starts now (canvas shown): the ~4 s deadline counts from here, even if the first frame is late
    begin(now) { if (!s.startNow) { s.startNow = now; s.prevNow = now; } },
    // after a pause (tab hidden, loop stopped): the next tick measures from there, no catch-up
    pause() { s.prevNow = 0; },
    // the page went hidden (or was hidden at start): skip the rest of the intro
    hidden() { finish(); s.prevNow = 0; },
    get t() { return s.t; },
  };
}
