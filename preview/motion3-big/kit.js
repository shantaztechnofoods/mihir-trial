// PREVIEW ONLY (motion3 big moments) — injected by record.mjs into the local
// build; never imported by src/. window.__m3p.{glide,rackFill,stamp,sparkle,pages,empties}
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rectIn = (el, host) => { const a = el.getBoundingClientRect(), b = host.getBoundingClientRect(); return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 }; };
  const stepCircles = (card) => [...card.querySelectorAll("div")].filter((d) => d.childElementCount === 0 && /^(Mechanical|Electrical|Trial|Ready)$/.test(d.textContent.trim()))
    .map((lab) => lab.parentElement.firstElementChild);

  // A. the department token glides Mechanical → Electrical on the machine card
  async function glide(card) {
    card.style.position = "relative";
    const steps = stepCircles(card);
    const from = steps[0], to = steps[1];
    const a = rectIn(from, card), b = rectIn(to, card);
    const t = document.createElement("div"); t.className = "m3p-token"; t.textContent = "✓";
    t.style.left = `${a.x - 13}px`; t.style.top = `${a.y - 13}px`; card.appendChild(t);
    card.classList.add("m3p-card-lift");
    await wait(60);
    t.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px)`;
    await wait(470);
    to.classList.add("m3p-step-pop");
    to.style.background = "#b45309"; to.style.color = "#fff"; to.style.borderColor = "#b45309";
    await wait(300); t.remove();
  }

  // B. rack slots fill one by one (left → right, top → bottom), 70 ms apart
  async function rackFill() {
    const crates = [...document.querySelectorAll(".rack-crate")];
    crates.forEach((c) => c.classList.add("m3p-crate-hide"));
    await wait(500);
    for (const c of crates) { c.classList.remove("m3p-crate-hide"); c.classList.add("m3p-crate-in"); await wait(70); }
  }

  // C. certificate issued: the seal stamps onto the machine card
  function stamp(card) {
    card.style.position = "relative";
    const s = document.createElement("div"); s.className = "m3p-stamp";
    s.innerHTML = "<span>TRIAL<b>✓</b>CERTIFIED</span>"; card.appendChild(s);
  }

  // D. machine reaches Ready: 10 sparkles + the Ready number pops (< 1 s)
  function sparkle(tile) {
    tile.classList.remove("m3p-spark-host"); void tile.offsetWidth; tile.classList.add("m3p-spark-host");
    const num = tile.querySelector(".mt-kpi-value") || tile;
    num.classList.remove("m3p-ready-pop"); void num.offsetWidth; num.classList.add("m3p-ready-pop");
    for (let i = 0; i < 10; i++) {
      const s = document.createElement("i"); s.className = "m3p-spark";
      const ang = (i / 10) * Math.PI * 2 + 0.3, r = 62 + (i % 3) * 14;
      s.style.setProperty("--c", ["#f59e0b", "#22c55e", "#facc15"][i % 3]);
      s.style.setProperty("--dx", `${Math.cos(ang) * r}px`); s.style.setProperty("--dy", `${Math.sin(ang) * r * 0.7}px`);
      s.style.animationDelay = `${(i % 4) * 30}ms`; tile.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  // E. turn on the module page transition
  function pages() { document.documentElement.classList.add("m3p-pages"); }

  // F. empty states get a small line drawing (box + lens) that draws itself
  const SVG = '<svg class="m3p-empty" viewBox="0 0 96 72" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path class="d" pathLength="1" d="M14 30 L44 18 L74 30 L44 42 Z"/><path class="d d2" pathLength="1" d="M14 30 V52 L44 64 L74 52 V30 M44 42 V64"/>'
    + '<g class="lens"><circle cx="66" cy="20" r="9" stroke="#2E50D6"/><path d="M72.5 26.5 L80 34" stroke="#2E50D6"/></g></svg>';
  function empties() {
    const mark = () => document.querySelectorAll("td").forEach((td) => {
      if (/^No (items match your filters|purchase orders found)/.test(td.textContent.trim()) && !td.querySelector(".m3p-empty")) td.insertAdjacentHTML("afterbegin", SVG);
    });
    new MutationObserver(mark).observe(document.body, { childList: true, subtree: true }); mark();
  }
  // B2. empty slots pulse once; then a slot gets its parts: fill-up + count badge
  function rackPulse() {
    document.querySelectorAll(".rack-crate").forEach((c) => { if (/Empty/.test(c.innerText)) { c.classList.remove("m3p-pulse"); void c.offsetWidth; c.classList.add("m3p-pulse"); } });
  }
  async function rackIssue(crate, total = 12) {
    crate.classList.add("m3p-slot");
    const title = [...crate.querySelectorAll("*")].find((e) => e.childElementCount === 0 && /^[MR]-\d+$/.test(e.textContent.trim()));
    crate.style.setProperty("--rc", title ? getComputedStyle(title).color : "#2E50D6");
    const fill = document.createElement("i"); fill.className = "m3p-fill"; crate.prepend(fill);
    const badge = document.createElement("span"); badge.className = "m3p-badge"; badge.textContent = `0/${total}`; crate.appendChild(badge);
    const t0 = performance.now();
    await new Promise((res) => { const tick = (t) => { const k = Math.min(1, (t - t0) / 360); badge.textContent = `${Math.round(total * (1 - Math.pow(1 - k, 3)))}/${total}`; k < 1 ? requestAnimationFrame(tick) : res(); }; requestAnimationFrame(tick); });
    const tw = document.createTreeWalker(crate, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) if (/Empty/.test(n.nodeValue)) { n.nodeValue = n.nodeValue.replace("Empty", "Filled ✓"); n.parentElement.classList.add("m3p-filled-word"); break; }
    crate.querySelectorAll("*").forEach((e) => { if (e.childElementCount === 0 && /Fill Rack|part short|BOM first/.test(e.textContent)) e.style.visibility = "hidden"; });
  }
  window.__m3p = { rackPulse, rackIssue, glide, rackFill, stamp, sparkle, pages, empties, stepCircles };
})();
