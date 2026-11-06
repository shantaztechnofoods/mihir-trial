// src/modules/reports/reportFlow.jsx — 2026-11-06 (reports v4)
// The visual pieces the owner approved for the Company and Customer machine
// reports: letterhead with the real logo, machine photo frame, verdict card,
// "at a glance" tiles, the journey ribbon (Rack → … → Ready), time-in-department
// bars, numbered journey steps on a rail, From → To chips and the pending-job
// mini flow (Raised ▸ Followed up ▸ Closed). Every colour also carries a word
// and an icon. Pure presentation: nothing here reads or writes data.
import React from "react";
import "./reportV4.css";
import { BRAND_LOGO_DATA_URI } from "../../utils/brandLogo.js";
import { RPT_LEGAL_NAME, rptContactLine } from "../../shared/printFormat.js";

const P = {
  check: "M4 8.5l2.6 2.6L12 5.6",
  warn: "M8 2.5l6 10.5H2zM8 6.5v3M8 11.3v.2",
  hold: "M6 5v6M10 5v6",
  clock: "M8 4.5V8l2.4 1.6",
  part: "M2.5 5.2L8 2.5l5.5 2.7v5.6L8 13.5l-5.5-2.7zM2.5 5.2L8 8l5.5-2.8M8 8v5.5",
  comment: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z",
  list: "M5.5 4.5h7M5.5 8h7M5.5 11.5h7M3 4.5h.2M3 8h.2M3 11.5h.2",
  arrow: "M3 8h9M9 5l3 3-3 3",
  in: "M13 8H4M7 5L4 8l3 3",
  flag: "M4 13.5V2.5M4 3h7.5l-1.8 2.7L11.5 8.5H4",
  lock: "M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 014 0v2",
  pen: "M3 13l1-3.5L11 2.5l2.5 2.5-7 7zM9.5 4l2.5 2.5",
  x: "M5 5l6 6M11 5l-6 6",
  photo: "M2.5 4.5h11v8h-11zM5.5 4.5l1-1.8h3l1 1.8M8 10.8a2 2 0 100-4 2 2 0 000 4z",
};
const ROUND = new Set(["check", "x", "clock", "hold"]);
export function R4Icon({ name, cls = "" }) {
  const d = P[name] || P.list;
  return (
    <svg className={`r4-ic ${cls}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ROUND.has(name) && <circle cx="8" cy="8" r="6.6" />}
      <path d={d} />
    </svg>
  );
}

// tone: ok | warn | bad | blue | mute — always with a word (and usually an icon).
export const R4Pill = ({ tone = "mute", icon, children, attr = {} }) => (
  <span className={`r4-pill r4-p-${tone}`} {...attr}>{icon ? <R4Icon name={icon} /> : null}{children}</span>
);

// "Assembly → Mechanical" as one chip; the text stays one string for search and tests.
export const R4FromTo = ({ from, to }) => (
  <span className="r4-ft"><R4Icon name="arrow" />{`${from || "—"} → ${to || "—"}`}</span>
);

// Letterhead + hero: real logo, legal name, document meta; machine photo frame,
// kind line, machine name, identity line, verdict card.
export function R4Header({ company = {}, internal = false, refText = "", dateText = "", kindLine = "", kindAttr = {}, machineName = "", idParts = [], photoUrl = "", photoAlt = "",
  verdict = { tone: "ok", word: "", sub: "" }, verdictAttr = {}, verdictExtra = null, attr = {} }) {
  const name = company.name || RPT_LEGAL_NAME;
  const contact = rptContactLine({ gst: company.gst, phone: company.phone, email: company.email, website: company.website });
  return (
    <div className="r4-head" {...attr}>
      <div className="r4-lh" data-report-letterhead>
        <div className="r4-brand">
          <img src={company.logo || BRAND_LOGO_DATA_URI} alt="SHANTAZ" className="r4-logo" />
          <div className="min-w-0">
            <div className="r4-brand-name">{name}</div>
            {company.address ? <div className="r4-brand-sub">{company.address}</div> : null}
            {contact ? <div className="r4-brand-sub">{contact}</div> : null}
          </div>
        </div>
        <div className="r4-docmeta">
          {internal ? <div className="r4-conf"><R4Icon name="lock" />Internal report</div> : null}
          {refText ? <div>Ref <b className="r4-mono">{refText}</b></div> : null}
          {dateText ? <div>Issued <b>{dateText}</b></div> : null}
        </div>
      </div>
      <div className="r4-hero">
        <div className={`r4-photo${photoUrl ? "" : " is-empty"}`}>
          {photoUrl ? <img src={photoUrl} alt={photoAlt} data-report-photo />
            : <div className="r4-photo-ph"><R4Icon name="photo" cls="r4-ic-lg" /><span>No machine photo on the BOM yet</span></div>}
        </div>
        <div className="min-w-0">
          <div className="r4-kind" {...kindAttr}>{kindLine}</div>
          <h1 className="r4-title">{machineName}</h1>
          <div className="r4-idline">{idParts.filter(Boolean).map((p, i) => <React.Fragment key={i}>{i ? <span className="r4-dotsep"> · </span> : null}{p}</React.Fragment>)}</div>
        </div>
        <div className={`r4-verdict is-${verdict.tone}`}>
          <div className="r4-v-word"><R4Icon name={verdict.tone === "ok" ? "check" : verdict.tone === "bad" ? "warn" : "clock"} cls="r4-ic-lg" /><span {...verdictAttr}>{verdict.word}</span></div>
          {verdict.sub ? <div className="r4-v-sub">{verdict.sub}</div> : null}
          {verdictExtra}
        </div>
      </div>
    </div>
  );
}

// tiles: [{ v, small, k, tone, icon, s, attr }]
export const R4Glance = ({ tiles = [], cols = 4, attr = {} }) => (
  <div className={`r4-glance cols-${cols}`} {...attr}>
    {tiles.map((t) => (
      <div key={t.k} className="r4-g">
        <div className="r4-g-v"><span {...(t.attr || {})}>{t.v}</span>{t.small ? <small> {t.small}</small> : null}</div>
        <div className="r4-g-k">{t.k}</div>
        {t.s ? <div className={`r4-g-s r4-t-${t.tone || "mute"}`}>{t.icon ? <R4Icon name={t.icon} /> : null}{t.s}</div> : null}
      </div>
    ))}
  </div>
);

// steps: [{ key, mark, label, dates, state: done|current|pending }]
export const R4Ribbon = ({ steps = [] }) => (
  <div className="r4-ribbon" data-report-ribbon>
    {steps.map((s, i) => (
      <React.Fragment key={s.key}>
        {i > 0 && <div className={`r4-rb-arrow ${steps[i - 1].state === "done" ? "is-done" : ""}`} aria-hidden="true"><i /></div>}
        <div className={`r4-rb-step is-${s.state}`}>
          <div className={`r4-rb-node ${s.flag ? "is-flag" : ""}`}>{s.flag ? <R4Icon name="flag" /> : s.mark}</div>
          <div className="r4-rb-label">{s.label}</div>
          <div className="r4-rb-dates">{s.dates || (s.state === "current" ? "In progress" : s.state === "pending" ? "Not started" : "—")}</div>
        </div>
      </React.Fragment>
    ))}
  </div>
);

// One department time bar: actual against target, the part over target in amber.
export function R4Bar({ actual = 0, target = 0, scale = 0 }) {
  const a = Math.max(0, Number(actual) || 0); const t = Math.max(0, Number(target) || 0);
  const max = Math.max(scale, a, t, 1);
  const w = Math.min(100, (a / max) * 100); const cut = a > t && t > 0 ? (t / a) * 100 : 100;
  return (
    <div className="r4-bar" aria-hidden="true">
      <i className={a > t && t > 0 ? "is-over" : ""} style={{ width: `${w}%`, "--cut": `${cut}%` }} />
      {t > 0 ? <b style={{ left: `${Math.min(100, (t / max) * 100)}%` }} /> : null}
    </div>
  );
}

export const R4Sec = ({ n, title, count, intro, extra, children, cls = "", attr = {} }) => (
  <section className={`mr-sec r4-sec ${cls}`} {...attr}>
    <h3 className="mr-h r4-sec-h"><span className="mr-num r4-n">{n}</span><span className="r4-sec-t">{title}</span>{(count != null || extra) && <span className="r4-c">{extra}{count != null ? <span className="mr-count">{count}</span> : null}</span>}</h3>
    {intro ? <p className="r4-intro">{intro}</p> : null}
    {children}
  </section>
);

// A step on the journey rail. node: { kind: "dept"|"dot", mark, tone, flag }
export function R4Step({ time = "", date = "", node = {}, first = false, last = false, head = false, children, attr = {} }) {
  return (
    <div className={`r4-st${first ? " is-first" : ""}${last ? " is-last" : ""}${head ? " is-head" : ""}`} {...attr}>
      <div className="r4-st-time">{date ? <b>{date}</b> : null}{time}</div>
      <div className="r4-rail">
        {node.kind === "dept"
          ? <div className={`r4-node is-${node.tone || "done"}`}>{node.flag ? <R4Icon name="flag" /> : node.mark}</div>
          : <div className={`r4-dot is-${node.tone || "blue"}`}>{node.mark}</div>}
      </div>
      <div className="r4-st-body">{children}</div>
    </div>
  );
}

// An event title line: icon chip with its word, then the text.
export const R4Ev = ({ tone = "blue", icon = "list", word, children, sub }) => (
  <div className="r4-ev">
    <div className="r4-ev-t"><R4Pill tone={tone} icon={icon}>{word}</R4Pill>{children}{sub ? <span className="r4-ev-sub r4-ev-inline">{sub}</span> : null}</div>
  </div>
);

// Small signature chip in the journey (≤ 84 × 28 css px).
export const R4SigChip = ({ src, name, line }) => (src ? (
  <div className="r4-sig">
    <img src={src} alt={`Signature: ${name || line || "signed"}`} />
    <span><b>{name || "Name not recorded"}</b>{line}</span>
  </div>
) : null);

// A checklist as a ticked grid. points: [{ label, ok, note, state }]
export function R4Checklist({ title, meta = "", score = "", scoreTone = "ok", points = [], attr = {}, cols = 3 }) {
  return (
    <div className={`r4-cl cols-${cols}`} {...attr}>
      <div className="r4-cl-h"><span className="min-w-0"><R4Icon name="list" /> <b>{title}</b>{meta ? <span className="r4-mute"> · {meta}</span> : null}</span>{score ? <R4Pill tone={scoreTone} icon={scoreTone === "ok" ? "check" : "x"}>{score}</R4Pill> : null}</div>
      <ul>
        {points.map((p, i) => (
          <li key={i} className={p.ok ? "" : "is-no"} {...(p.attr || {})}>
            <span className={`r4-tick ${p.ok ? "is-ok" : "is-no"}`} aria-label={p.ok ? "OK" : "Not OK"}>{p.ok ? "✓" : "✗"}</span>
            <span className="min-w-0">{p.label}{p.note ? <span className="r4-cl-note"> — {p.note}</span> : null}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Pending job mini flow: J-n, title, tags, then Raised ▸ (Followed up) ▸ Closed.
export function R4JobTrace({ id, title, tags = null, status, statusTone, steps = [], attr = {} }) {
  return (
    <div className="r4-job" {...attr}>
      <div className="r4-job-h"><span className="r4-job-id">{id}</span><span className="r4-job-ttl">{title}</span>{tags}<R4Pill tone={statusTone} icon={statusTone === "ok" ? "check" : "clock"}>{status}</R4Pill></div>
      <div className={`r4-trace n-${steps.length}`}>
        {steps.map((s, i) => (
          <div key={i} className={`r4-tr is-${s.tone || "blue"}`}>
            <div className={`r4-dot is-${s.tone || "blue"}`} />
            <div className="r4-tr-lbl">{i + 1}. {s.label}</div>
            {s.meta ? <div className="r4-tr-m">{s.meta}</div> : null}
            {s.text ? <div className="r4-tr-x">{s.text}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// Short date range for the ribbon: "28–29 Oct", "31 Oct–01 Nov", "01 Nov".
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
const toD = (v) => { if (v == null || v === "") return null; const t = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(t) ? new Date(t) : null; };
export const r4Day = (v) => { const d = toD(v); return d ? `${p2(d.getDate())} ${MON[d.getMonth()]}` : ""; };
export const r4Time = (v) => { const d = toD(v); if (!d || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) return ""; return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export function r4Range(a, b) {
  const x = toD(a); const y = toD(b);
  if (!x && !y) return "";
  if (!x || !y) return r4Day(x || y);
  if (x.toDateString() === y.toDateString()) return r4Day(x);
  if (x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear()) return `${p2(x.getDate())}–${r4Day(y)}`;
  return `${r4Day(x)}–${r4Day(y)}`;
}
