// Machine Tracker UX pack (2026-11-06) — display pieces. VISUAL ONLY.
//
//   NextStepButton  the one primary action of a card (no emoji; icon + words)
//   NearLimitStrip  calm, dismissible "time almost up" strip for heads
//   MyWorkPanel     "My work today": own machines first (phone), and for a
//                   department head the summary line, urgent-first list,
//                   "sent forward today" footer and the All departments toggle
//
// Every button here calls a function MachinePage passes in, which opens the
// SAME modal the existing buttons open — no handler, permission or data
// change lives in this file. Styles: mtUx section of src/world-ui.css.
import React, { useState } from "react";
import { Check, ClipboardList, ArrowRight, Play, Timer, X, Wrench, ChevronDown, CircleCheck, Send, Clock, CirclePause } from "lucide-react";
import { BomPhotoThumb } from "../bom/index.js";
import { nearLimitText, summaryText, todayParts, todayText } from "./mtUx.js";

const STEP_ICON = { accept: Check, checklist: ClipboardList, finish: ArrowRight, resume: Play };

export function NextStepButton({ step, onClick, disabled = false, className = "", ...rest }) {
  if (!step) return null;
  const Icon = STEP_ICON[step.kind] || ArrowRight;
  return (
    <button data-needs-net type="button" data-next-step={step.kind} disabled={disabled} onClick={onClick}
            className={`mtx-next mtx-next-${step.kind} ${className}`} {...rest}>
      <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
      <span>{step.label}</span>
    </button>
  );
}

export function NearLimitStrip({ rows, onDismiss, onOpen }) {
  const [open, setOpen] = useState(false);
  if (!rows || !rows.length) return null;
  const first = rows[0];
  const more = rows.length - 1;
  return (
    <div className="mtx-strip" role="status" data-near-limit data-near-limit-count={rows.length}>
      <div className="mtx-strip-row">
        <Timer size={16} strokeWidth={2.2} aria-hidden="true" className="mtx-strip-ic" />
        <button type="button" className="mtx-strip-text" data-near-limit-open onClick={() => onOpen && onOpen(first.m)}>
          {nearLimitText(first)}
        </button>
        {more > 0 && (
          <button type="button" className="mtx-strip-more" data-near-limit-more aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            +{more} more<ChevronDown size={14} aria-hidden="true" className={open ? "is-open" : ""} />
          </button>
        )}
        <button type="button" className="mtx-strip-x" data-near-limit-dismiss aria-label="Dismiss" title="Dismiss"
                onClick={() => onDismiss && onDismiss(rows.map((r) => r.key))}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {open && more > 0 && (
        <ul className="mtx-strip-list">
          {rows.slice(1).map((r) => (
            <li key={r.key}><button type="button" onClick={() => onOpen && onOpen(r.m)}>{nearLimitText(r)}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TONE_WORD = { bad: "is-bad", wait: "is-wait", hold: "is-bad", ok: "is-ok" };

// rows: [{ key, m, title, sub, status, tone, step, run, photoUrl }]
export function MyWorkPanel({ rows, isHead, depts, summary, sentToday, allDepts, onToggle, showToggle, phoneOnly, maxCards = 6, today = null }) {
  const list = rows || [];
  if (!isHead && !list.length) return null;
  const shown = list.slice(0, maxCards);
  const rest = list.length - shown.length;
  return (
    <section className={`mtx-mywork${phoneOnly ? " mtx-phone-only" : ""}`} data-mywork data-mywork-head={isHead ? "1" : undefined}
             aria-label={isHead ? "My work today" : "Your machines"}>
      <header className="mtx-mywork-head">
        <div className="min-w-0">
          <h2 className="mtx-mywork-title">{isHead ? "My work today" : "Your machines"}</h2>
          <p className="mtx-mywork-sum" data-mywork-summary>
            {(depts || []).join(", ")}{depts && depts.length ? " · " : ""}{summaryText(summary)}
          </p>
          {today}
        </div>
        {showToggle && (
          <div className="mtx-seg" role="group" aria-label="Which departments">
            <button type="button" aria-pressed={!allDepts} data-mywork-scope="mine" onClick={() => onToggle && onToggle(false)}>My department</button>
            <button type="button" aria-pressed={!!allDepts} data-mywork-scope="all" onClick={() => onToggle && onToggle(true)}>All departments</button>
          </div>
        )}
      </header>
      {!allDepts && (
        <>
          {list.length === 0 && <div className="mtx-empty">Nothing needs your department right now.</div>}
          <div className="mtx-cards">
            {shown.map((r, i) => (
              <article key={r.key} className={`mtx-card${i === 0 && isHead ? " is-first" : ""}`} data-mywork-card={r.m.id} style={{ "--i": i }}>
                <div className="mtx-card-top">
                  <BomPhotoThumb url={r.photoUrl} size={56} className="mtx-photo"
                                 fallback={<span className="mtx-photo mtx-photo-ph" aria-hidden="true"><Wrench size={22} strokeWidth={1.7} /></span>} />
                  <div className="min-w-0 flex-1">
                    <div className="mtx-card-title">{r.title}</div>
                    {r.sub && <div className="mtx-card-sub">{r.sub}</div>}
                    <span className={`mtx-status ${TONE_WORD[r.tone] || ""}`} data-mywork-status>{r.status}</span>
                  </div>
                </div>
                {r.step && <NextStepButton step={r.step} onClick={r.run} data-mywork-next={r.m.id} />}
              </article>
            ))}
          </div>
          {rest > 0 && <div className="mtx-more">{rest} more below</div>}
          {isHead && (
            <footer className="mtx-foot" data-mywork-sent={sentToday}>
              {sentToday > 0
                ? <><Check size={15} strokeWidth={2.4} aria-hidden="true" />Today you sent {sentToday} machine{sentToday === 1 ? "" : "s"} forward</>
                : "No machine sent forward yet today"}
            </footer>
          )}
        </>
      )}
    </section>
  );
}

// 2026-11-06 (worker-ease) — "Today · 3 accepted · 2 sent forward · 1 late ·
// 1 on hold". Calm, one line on desktop; on a phone it wraps between items,
// never inside a word. Each count = icon + number + word (never colour alone).
const TODAY_ICON = { accepted: CircleCheck, sent: Send, late: Clock, held: CirclePause };
export function TodayLine({ counts, omit, merged = false, className = "" }) {
  if (!counts) return null;
  const parts = todayParts(counts, omit);
  return (
    <p className={`mtx-today${merged ? " is-merged" : ""} ${className}`} data-today-line={merged ? "merged" : "top"}
       role="status" aria-label={todayText(counts, omit)}>
      <span className="mtx-today-lead" aria-hidden="true">Today</span>
      {parts.map((p) => {
        const Icon = TODAY_ICON[p.key];
        return (
          <span key={p.key} className={`mtx-today-item is-${p.tone}${p.n ? "" : " is-zero"}`} data-today-part={p.key} data-n={p.n} aria-hidden="true">
            <Icon size={14} strokeWidth={2.2} aria-hidden="true" /><b>{p.n}</b> {p.word}
          </span>
        );
      })}
    </p>
  );
}
