-- ════════════════════════════════════════════════════════════════════════════
-- 065 — Stores may READ every machine (read-only Machine Tracker overview)
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 058 scoped machine visibility to the caller's departments. A
-- Store Manager / store keeper normally has no department, so live they read
-- NO machine rows and the Machine Tracker showed only "No department
-- assigned". Stores needs to see every machine — its stage, department, rack
-- and the parts it is waiting for — to prepare them.
--
-- A "store machine reader" is an active user who may open the Machine Tracker
-- page (can_view_page('machines')) AND either has the role 'Store Manager' or
-- holds the stock-inward permission (inward.submit — the same Stores marker
-- 058's pending_can_act / receive_pending_part already use).
--
--  * ADDS two permissive SELECT policies (OR-ed with the 058 policies):
--      machine_log            — every machine row
--      pending_handover_items — every pending job (the "parts waiting")
--    pending_item_receipts follows automatically (its 058 policy checks that
--    the parent job is visible).
--  * NO INSERT / UPDATE / DELETE policy is added or changed, and the 058
--    helpers (machine_in_scope, machine_can_act, pending_can_act, in_dept)
--    are untouched — so every write rule (Finish & Transfer, Accept, Part
--    Received, checklists, attachments, ratings) stays department-scoped.
-- Additive: no rows touched. Rollback: 065_store_machine_read_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.store_machine_reader() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_page('machines')
     AND (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND status = 'active' AND role_key = 'Store Manager')
          OR public.has_permission('inward', 'submit'));
$$;
REVOKE ALL ON FUNCTION public.store_machine_reader() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_machine_reader() TO authenticated, service_role;

DROP POLICY IF EXISTS machine_select_stores ON public.machine_log;
CREATE POLICY machine_select_stores ON public.machine_log FOR SELECT TO authenticated
  USING (public.store_machine_reader());

DROP POLICY IF EXISTS pending_handover_items_select_stores ON public.pending_handover_items;
CREATE POLICY pending_handover_items_select_stores ON public.pending_handover_items FOR SELECT TO authenticated
  USING (public.store_machine_reader());

COMMIT;
