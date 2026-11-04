// 2026-11-04 (fix/perf-1) — text on the sentinel row of a sliced list
// (see useProgressiveCount): "Loading N more… Show all T". The button draws
// every row at once so Ctrl+F / reading the full list never misses anything.
export default function MoreRowsNote({ rows }) {
  const total = rows.shown + rows.more;
  return (
    <>
      Loading {rows.more} more…{" "}
      <button
        type="button"
        data-show-all-rows
        onClick={rows.showAll}
        className="ml-1 underline font-semibold"
        style={{ color: "inherit", minHeight: 32, padding: "4px 8px" }}
      >
        Show all {total}
      </button>
    </>
  );
}
