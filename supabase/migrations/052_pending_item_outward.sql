-- ════════════════════════════════════════════════════════════════════════════
-- 052 — Pending items added during BOM Outward
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why: the floor needs to record, at BOM Outward, a part that is owed on a
-- machine but is NOT a BOM line — something ordered separately, a loose part
-- promised later, or an item that is not in the Item Master at all. It is
-- tracked on the machine's serial like every other pending job, moves with it
-- across departments and stays visible until it is completed.
--
-- What this adds (all nullable / defaulted, no backfill, no behaviour change):
--   critical        Critical or Normal, as the operator classified it. The
--                   BOM critical-item workflow (Item Master `critical` flag,
--                   verification popup, stock gate) is untouched — this is a
--                   label on the pending job, not a second critical system.
--   part_serial_no  Optional serial of the part itself. The machine's serial
--                   is already carried by machine_id → machine_log.serial_no.
--   source          Where the job came from: 'bom_outward' for one added at
--                   Outward, 'not_issued' for a critical BOM line left
--                   unissued, null for everything raised before this.
--
-- No stock is moved and no Item Master row is created for these items: a
-- manually named part exists only as text on the job.
--
-- Additive. Rollback: 052_pending_item_outward_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.pending_handover_items
  ADD COLUMN IF NOT EXISTS critical       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS part_serial_no text,
  ADD COLUMN IF NOT EXISTS source         text;

COMMENT ON COLUMN public.pending_handover_items.critical       IS 'Operator classification of this pending job: critical or normal. Independent of the Item Master critical flag and of the BOM critical-item gate.';
COMMENT ON COLUMN public.pending_handover_items.part_serial_no IS 'Optional serial number of the pending part itself. The machine serial comes from machine_log via machine_id.';
COMMENT ON COLUMN public.pending_handover_items.source         IS 'Origin of the job: bom_outward | not_issued | null (raised at a handover, pre-052).';

-- Outstanding critical items, machine by machine — the Pending Jobs view.
CREATE INDEX IF NOT EXISTS pending_handover_items_open_critical_idx
  ON public.pending_handover_items (machine_id, critical)
  WHERE status = 'open';

COMMIT;
