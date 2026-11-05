// UI P0 (2026-11-05) — DataTable SKELETON (not used by any page yet).
// TanStack Table v9 (headless: sort + global filter) + TanStack Virtual (only the
// visible rows are in the DOM). Admin pages only, and ONLY through LazyDataTable
// (./lazyUi.js) so ~23 KB gzip loads when such a page opens — never at login.
// Adopt one table per PR behind the same props (UI-STACK-RECOMMENDATION P3/P5);
// keep MoreRowsNote behaviour and print-all-rows until the new grid is proven.
//
//   columns: [{ accessorKey: "code", header: "Code", size: 120 }, …]  (TanStack column defs)
//   <LazyDataTable data={rows} columns={columns} filter={query} height={520} />
import { useRef, useState } from "react";
import {
  useTable, tableFeatures, rowSortingFeature, columnFilteringFeature, globalFilteringFeature,
  createSortedRowModel, createFilteredRowModel, sortFns, filterFns,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  sortFns,
  filterFns,
});

export default function DataTable({
  data = [], columns = [], filter = "", rowHeight = 40, height = 520,
  getRowId, emptyText = "No rows to show", ariaLabel = "Table",
}) {
  const [sorting, setSorting] = useState([]);
  const table = useTable({
    features, columns, data, getRowId,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
  });
  const rows = table.getRowModel().rows;
  const scrollRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (i) => rows[i].id,
    overscan: 8,
    initialRect: { width: 0, height },   // first rows render before the box is measured
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;
  const colCount = columns.length || 1;

  return (
    <div ref={scrollRef} className="wu-dt" style={{ maxHeight: height, overflow: "auto" }}>
      <table aria-label={ariaLabel} aria-rowcount={rows.length + 1} style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--paper)" }}>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sort = h.column.getIsSorted();
                const canSort = h.column.getCanSort();
                return (
                  <th key={h.id} scope="col" style={{ width: h.column.columnDef.size, textAlign: "left" }}
                    aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}>
                    {h.isPlaceholder ? null : canSort ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="wu-dt-sort">
                        <table.FlexRender header={h} />
                        <span aria-hidden="true">{sort === "asc" ? " ↑" : sort === "desc" ? " ↓" : ""}</span>
                      </button>
                    ) : <table.FlexRender header={h} />}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={colCount} style={{ padding: 16, color: "var(--ink-3)" }}>{emptyText}</td></tr>
          ) : (
            <>
              {padTop > 0 && <tr aria-hidden="true"><td colSpan={colCount} style={{ height: padTop, padding: 0 }} /></tr>}
              {items.map((vi) => {
                const row = rows[vi.index];
                return (
                  <tr key={row.id} data-index={vi.index} ref={virtualizer.measureElement} aria-rowindex={vi.index + 2}>
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} style={{ width: cell.column.columnDef.size }}><table.FlexRender cell={cell} /></td>
                    ))}
                  </tr>
                );
              })}
              {padBottom > 0 && <tr aria-hidden="true"><td colSpan={colCount} style={{ height: padBottom, padding: 0 }} /></tr>}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
