-- ─────────────────────────────────────────────────────────────────────────────
-- 060_super_admin_delete_machine.sql — Super Admin machine deletion
--
-- One SECURITY DEFINER function, delete_machine_super_admin(machine_id, reason).
--   • Callable only by an ACTIVE user whose role_key is 'super_admin'
--     (checked against public.users, not a grantable permission). Everyone
--     else — Admin, department users, anon — gets 42501.
--   • machine_log still has NO delete policy, so a direct DELETE through the
--     API is refused for every role, Super Admin included; this function is
--     the only path.
--   • Deletes exactly one machine_log row. Its dependent rows (hand-overs,
--     pending hand-over items, checklist responses, department ratings,
--     attachment records) go with it through the existing ON DELETE CASCADE.
--     Stock, outward_log, pending_log, bom_definitions, rack configuration,
--     items and users are NOT touched. Freed rack slot = the row is gone.
--   • Writes one audit_log row BEFORE the delete in the same transaction,
--     holding the full machine snapshot and the per-table counts, so what was
--     deleted, by whom and when is permanently recorded. Any error rolls the
--     whole call back.
-- Additive: one new function. Rollback: 060_super_admin_delete_machine_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_machine_super_admin(p_machine_id bigint, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_user  record;
  v_m     record;
  v_snap  jsonb;
  v_counts jsonb;
  n_h int; n_p int; n_c int; n_r int; n_a int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, username, full_name, role_key, status INTO v_user FROM public.users WHERE id = v_uid;
  IF v_user.id IS NULL OR v_user.status IS DISTINCT FROM 'active' OR v_user.role_key IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only a Super Admin can delete a machine' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_m FROM public.machine_log WHERE id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found' USING ERRCODE = 'no_data_found'; END IF;

  SELECT count(*) INTO n_h FROM public.handover_events          WHERE machine_id = p_machine_id;
  SELECT count(*) INTO n_p FROM public.pending_handover_items   WHERE machine_id = p_machine_id;
  SELECT count(*) INTO n_c FROM public.checklist_responses      WHERE machine_id = p_machine_id;
  SELECT count(*) INTO n_r FROM public.department_ratings       WHERE machine_id = p_machine_id;
  SELECT count(*) INTO n_a FROM public.machine_attachments      WHERE machine_id = p_machine_id;
  v_counts := jsonb_build_object('handover_events', n_h, 'pending_handover_items', n_p,
                                 'checklist_responses', n_c, 'department_ratings', n_r, 'machine_attachments', n_a);
  v_snap := to_jsonb(v_m);

  INSERT INTO public.audit_log (user_id, user_name, user_role, type, module, action, ref, serial_no, old_value, details)
  VALUES (v_uid, coalesce(v_user.full_name, v_user.username, 'Super Admin'), v_user.role_key,
          'machine_deleted', 'Machine',
          format('Machine deleted by Super Admin: %s%s (stage %s)', v_m.bom_key,
                 CASE WHEN coalesce(v_m.serial_no, '') <> '' THEN ' [' || v_m.serial_no || ']' ELSE '' END, v_m.stage),
          v_m.bom_key, v_m.serial_no, v_snap,
          jsonb_build_object('machine_id', p_machine_id, 'reason', coalesce(p_reason, ''), 'linked_records_removed', v_counts));

  DELETE FROM public.machine_log WHERE id = p_machine_id;   -- cascades the linked rows listed above

  RETURN jsonb_build_object('ok', true, 'machine_id', p_machine_id, 'bom_key', v_m.bom_key,
                            'serial_no', v_m.serial_no, 'stage', v_m.stage, 'linked_records_removed', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_machine_super_admin(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_machine_super_admin(bigint, text) TO authenticated;

COMMIT;
