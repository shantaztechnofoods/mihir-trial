// 2026-11-04 (fix/perf-2) — a search box that shows every key at once but tells
// the page only when typing pauses (default 200 ms). Before, every key re-ran the
// page's filters over thousands of rows, so typing lagged on big lists.
// - Clearing the box, pressing Enter or leaving the box sends the text at once.
// - If the page changes the value itself (Clear filters / Reset), the box follows.
// Drop-in for <input value onChange>: `onChange` receives the TEXT (not the event).
import React, { forwardRef, useEffect, useRef, useState } from "react";

const DebouncedSearchInput = forwardRef(function DebouncedSearchInput(
  { value = "", onChange, delay = 200, onKeyDown, onBlur, ...rest }, ref,
) {
  const [text, setText] = useState(value ?? "");
  const sent = useRef(value ?? "");          // last text the page knows about
  const timer = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The page reset or changed the value itself → show that, drop any pending send.
  useEffect(() => {
    const v = value ?? "";
    if (v !== sent.current) { sent.current = v; clearTimeout(timer.current); setText(v); }
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const flush = (v) => {
    clearTimeout(timer.current);
    if (v !== sent.current) { sent.current = v; onChangeRef.current?.(v); }
  };

  return (
    <input
      {...rest}
      ref={ref}
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        clearTimeout(timer.current);
        if (v === "") flush(v);
        else timer.current = setTimeout(() => flush(v), delay);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") flush(e.currentTarget.value); onKeyDown?.(e); }}
      onBlur={(e) => { flush(e.currentTarget.value); onBlur?.(e); }}
    />
  );
});

export default DebouncedSearchInput;
