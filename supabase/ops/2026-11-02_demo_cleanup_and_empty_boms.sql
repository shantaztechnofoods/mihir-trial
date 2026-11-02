-- One-off DATA operation, already applied to production (SHATAZ_TECHNOFOODS) on 2026-11-02.
-- Not a migration: it is specific to this database's rows. Kept for the record.
--
-- 1. Demo cleanup — only the 9 ACTIVE test machines (keyboard-mash serials, created 31 Oct–2 Nov)
--    and, via the existing ON DELETE CASCADE foreign keys, their hand-overs, pending jobs,
--    checklist answers and ratings. Rows were first copied to the RLS-locked
--    public.demo_cleanup_backup_20261102 (row_data jsonb) so they can be restored.
--    NOT touched: users, roles, settings, items/stock, audit_log, outward_log, pending_log,
--    stock_movements, and the 3 completed ("Ready") machines 68, 71, 81.
-- 2. Rack BOMs — one BOM per rack family (the 12 rack units M-10 (1)/(2) … R-20 (2) share the
--    six family BOMs by exact key, see src/utils/rackSlots.js). Existing M-10, M-15, R-20 had
--    their items cleared (backed up); M-20, R-10, R-15 created. All have zero items.
CREATE TABLE IF NOT EXISTS public.demo_cleanup_backup_20261102 (id bigserial PRIMARY KEY, source_table text NOT NULL, row_data jsonb NOT NULL, backed_up_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.demo_cleanup_backup_20261102 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_cleanup_backup_20261102 FROM anon, authenticated;
-- (backup INSERTs for machine_log, handover_events, pending_handover_items, checklist_responses,
--  department_ratings WHERE machine_id IN (67,70,72,73,74,75,79,85,86), and bom_definitions M-10/M-15/R-20)

DELETE FROM public.machine_log
 WHERE id IN (67,70,72,73,74,75,79,85,86) AND status = 'active'
   AND serial_no IN ('asdfg','viki','AAAA','ERSGS','Hhhh','RSDGDF','ASDFGHJKL','eafefe','gsgs');

UPDATE public.bom_definitions SET items = '[]'::jsonb, updated_at = now() WHERE key IN ('M-10','M-15','R-20');
INSERT INTO public.bom_definitions (key,label,color,rack_capacity,items) VALUES
 ('M-20','Kneading Machine 20kg','#0e7490',2,'[]'::jsonb),
 ('R-10','R-10','#0369a1',2,'[]'::jsonb),
 ('R-15','R-15','#a16207',2,'[]'::jsonb)
ON CONFLICT (key) DO NOTHING;
