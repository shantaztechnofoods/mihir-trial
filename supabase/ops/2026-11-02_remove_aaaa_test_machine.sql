-- One-off DATA operation, already applied to production (SHATAZ_TECHNOFOODS) on 2026-11-02.
-- Not a migration. Removes ONLY the test machine id 87 (serial AAAA, Active Builds, Assembly).
-- Via the existing ON DELETE CASCADE keys this also removed its linked rows:
--   handover_events id 90 (Assembly -> Mechanical, pending) and checklist_responses id 58.
-- It had no pending jobs, receipts, ratings or attachments.
-- Backed up first into public.demo_cleanup_backup_20261102 (source_table = machine_log /
-- handover_events / checklist_responses, row_data = full row as jsonb) so it can be restored.
-- NOT touched: machines 68, 71, 81, rack/BOMs, stock/items, users, roles, settings,
-- audit_log (history kept), outward_log (its BOM-issue record stays with the stock ledger).
BEGIN;
INSERT INTO public.demo_cleanup_backup_20261102 (source_table,row_data)
 SELECT 'machine_log', to_jsonb(m) FROM public.machine_log m WHERE id=87 AND serial_no='AAAA' AND status='active';
INSERT INTO public.demo_cleanup_backup_20261102 (source_table,row_data)
 SELECT 'handover_events', to_jsonb(h) FROM public.handover_events h WHERE machine_id=87;
INSERT INTO public.demo_cleanup_backup_20261102 (source_table,row_data)
 SELECT 'checklist_responses', to_jsonb(c) FROM public.checklist_responses c WHERE machine_id=87;
DELETE FROM public.machine_log WHERE id=87 AND serial_no='AAAA' AND status='active' AND current_department='Assembly';
COMMIT;
