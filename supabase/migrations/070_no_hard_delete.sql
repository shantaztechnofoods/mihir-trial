-- ─────────────────────────────────────────────────────────────────────────────
-- 070_no_hard_delete.sql — nothing in the ERP may ever disappear
--
-- 2026-11-05: on ERP LIVE the "Clear Demo Data" button hard-deleted all six
-- bom_definitions rows; checklist_templates.bom_key (ON DELETE SET NULL)
-- silently unlinked 36 BOM checklists, and an item row was deleted too. The
-- app now ARCHIVES master data instead (BOM → retired_at, item →
-- is_active=false, vendor → archived marker, checklist → active=false). This
-- migration makes the database refuse a real DELETE as well, so no client,
-- old browser tab or mistaken script can remove these rows again.
--
--   1. forbid_hard_delete(): BEFORE DELETE (per row) and BEFORE TRUNCATE
--      triggers on bom_definitions, items, vendors, checklist_templates,
--      item_history, machine_log, handover_events, pending_handover_items and
--      checklist_responses → RAISE 'Deleting is not allowed — archive instead'.
--      Escape hatch for a deliberate emergency admin script ONLY:
--        BEGIN; SELECT set_config('app.allow_hard_delete','on', true); DELETE …; COMMIT;
--      (transaction-local; PostgREST clients cannot set it.)
--      audit_log and stock_movements already have unconditional no-delete
--      triggers (004 / 012); they stay as they are (stricter, no escape hatch).
--   2. checklist_templates.bom_key FK: ON DELETE SET NULL → ON DELETE RESTRICT
--      (same name, ON UPDATE CASCADE kept so BOM rename still carries it).
--   3. delete_machine_super_admin() (060) and rack_remove_machine() (053) are
--      the two sanctioned machine removals (Super Admin delete; Remove From
--      Rack = undo a wrong BOM issue, stock returned). They keep working: each
--      first writes the FULL snapshot of every row it removes (machine and all
--      linked rows / outward + pending rows) into audit_log, then opens the
--      escape hatch for its own DELETE only. Archiving machines instead would
--      need every rack / serial guard, Machine Tracker list and report to skip
--      archived rows (frozen Machine Tracker) — not done here.
--
-- Additive: one function, triggers, one FK re-created with the same name, two
-- functions re-created with identical behaviour + a snapshot. No data change.
-- Rollback: 070_no_hard_delete_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- ── 1. The guard ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.forbid_hard_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN
    RETURN OLD;   -- deliberate emergency script (transaction-local setting)
  END IF;
  RAISE EXCEPTION 'Deleting is not allowed — archive instead'
    USING ERRCODE = 'check_violation',
          DETAIL  = format('%s on %s is blocked (migration 070).', TG_OP, TG_TABLE_NAME),
          HINT    = 'Archive / switch off the record in the app; it can be restored from Archived.';
END
$$;
COMMENT ON FUNCTION public.forbid_hard_delete() IS
  'Migration 070: refuses DELETE/TRUNCATE on master + history tables unless app.allow_hard_delete=on (transaction-local, emergency scripts only).';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_definitions','items','vendors','checklist_templates','item_history',
                           'machine_log','handover_events','pending_handover_items','checklist_responses'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '070: table public.% not found — skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_hard_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.forbid_hard_delete()',
                   t || '_no_hard_delete', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_hard_delete()',
                   t || '_no_truncate', t);
  END LOOP;
END
$$;

-- ── 2. checklist_templates.bom_key: SET NULL → RESTRICT ─────────────────────
-- One ALTER TABLE statement, so the table is never without the FK. NOT VALID +
-- VALIDATE keeps the lock short; every existing bom_key already points at a
-- bom_definitions row (or is NULL), which the old FK guaranteed.
ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_bom_key_fkey,
  ADD  CONSTRAINT checklist_templates_bom_key_fkey FOREIGN KEY (bom_key)
       REFERENCES public.bom_definitions(key) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.checklist_templates VALIDATE CONSTRAINT checklist_templates_bom_key_fkey;

-- ── 3a. delete_machine_super_admin (060) — snapshot everything, then delete ─
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
  v_linked jsonb;
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
  -- 070: the full rows of everything the cascade removes, so the machine can
  -- be rebuilt from the audit trail.
  v_linked := jsonb_build_object(
    'handover_events',        (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.handover_events x        WHERE x.machine_id = p_machine_id),
    'pending_handover_items', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.pending_handover_items x WHERE x.machine_id = p_machine_id),
    'checklist_responses',    (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.checklist_responses x    WHERE x.machine_id = p_machine_id),
    'department_ratings',     (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.department_ratings x     WHERE x.machine_id = p_machine_id),
    'machine_attachments',    (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.machine_attachments x    WHERE x.machine_id = p_machine_id));

  INSERT INTO public.audit_log (user_id, user_name, user_role, type, module, action, ref, serial_no, old_value, details)
  VALUES (v_uid, coalesce(v_user.full_name, v_user.username, 'Super Admin'), v_user.role_key,
          'machine_deleted', 'Machine',
          format('Machine deleted by Super Admin: %s%s (stage %s)', v_m.bom_key,
                 CASE WHEN coalesce(v_m.serial_no, '') <> '' THEN ' [' || v_m.serial_no || ']' ELSE '' END, v_m.stage),
          v_m.bom_key, v_m.serial_no, v_snap,
          jsonb_build_object('machine_id', p_machine_id, 'reason', coalesce(p_reason, ''), 'linked_records_removed', v_counts,
                             'linked_rows_snapshot', v_linked));

  PERFORM set_config('app.allow_hard_delete', 'on', true);
  DELETE FROM public.machine_log WHERE id = p_machine_id;   -- cascades the linked rows listed above
  PERFORM set_config('app.allow_hard_delete', 'off', true);

  RETURN jsonb_build_object('ok', true, 'machine_id', p_machine_id, 'bom_key', v_m.bom_key,
                            'serial_no', v_m.serial_no, 'stage', v_m.stage, 'linked_records_removed', v_counts);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_machine_super_admin(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_machine_super_admin(bigint, text) TO authenticated;

-- ── 3b. rack_remove_machine (053) — snapshot, then the same removal ─────────
CREATE OR REPLACE FUNCTION public.rack_remove_machine(p_machine_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_name       text;
  v_role       text;
  v_m          public.machine_log%ROWTYPE;
  v_ref        text;
  v_out_ids    bigint[];
  v_issue_ids  bigint[];
  v_pend_ids   bigint[];
  v_returned   jsonb := '[]'::jsonb;
  v_already    boolean := false;
  r            record;
  li           jsonb;
  v_qty        numeric;
  v_res        jsonb;
BEGIN
  IF NOT (public.is_super_admin() OR public.has_permission('outward', 'delete')) THEN
    RAISE EXCEPTION 'You do not have permission to remove a set from the rack (Outward → Delete)' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(full_name, username), role_key INTO v_name, v_role FROM public.users WHERE id = v_uid;

  SELECT * INTO v_m FROM public.machine_log WHERE id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN
    -- A retry after a success: the machine is gone and the stock was already
    -- returned. Report that; change nothing.
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_type = 'rack_remove' AND reference_id = p_machine_id::text) THEN
      RETURN jsonb_build_object('ok', true, 'machine_id', p_machine_id, 'already_removed', true,
                                'returned', '[]'::jsonb, 'outward_ids', '[]'::jsonb, 'pending_ids', '[]'::jsonb);
    END IF;
    RAISE EXCEPTION 'Machine not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_m.stage <> 'BOM Issued' THEN
    RAISE EXCEPTION 'Cannot remove — machine is in %, not on the rack', v_m.stage USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.handover_events WHERE machine_id = p_machine_id) THEN
    RAISE EXCEPTION 'Cannot remove — this machine already has hand-over history' USING ERRCODE = 'check_violation';
  END IF;

  -- This machine's own BOM outwards: the issue row plus any later issue to
  -- the same BOM + serial (pending parts issued to it on the rack).
  SELECT COALESCE(array_agg(o.id ORDER BY o.id), '{}') INTO v_out_ids
    FROM public.outward_log o
   WHERE (v_m.issue_id IS NOT NULL AND o.id = v_m.issue_id)
      OR (o.type = 'bom'
          AND NULLIF(lower(trim(COALESCE(v_m.serial_no, ''))), '') IS NOT NULL
          AND lower(trim(COALESCE(o.serial_no, ''))) = lower(trim(v_m.serial_no))
          AND upper(trim(o.ref)) = upper(trim(v_m.bom_key)));
  SELECT COALESCE(array_agg(DISTINCT o.issue_id), '{}') INTO v_issue_ids
    FROM public.outward_log o WHERE o.id = ANY(v_out_ids) AND o.issue_id IS NOT NULL;

  v_already := EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_type = 'rack_remove' AND reference_id = p_machine_id::text);
  v_ref := 'Rack remove: ' || v_m.bom_key || CASE WHEN COALESCE(v_m.serial_no, '') <> '' THEN ' [' || v_m.serial_no || ']' ELSE '' END;

  IF NOT v_already THEN
    FOR r IN SELECT o.id, o.items FROM public.outward_log o WHERE o.id = ANY(v_out_ids) ORDER BY o.id LOOP
      FOR li IN SELECT value FROM jsonb_array_elements(COALESCE(r.items, '[]'::jsonb)) LOOP
        v_qty := COALESCE(NULLIF(li ->> 'issueQty', '')::numeric, 0);
        IF v_qty > 0 AND COALESCE(li ->> 'code', '') <> '' THEN
          -- Any failure here (item missing, etc.) aborts the whole call.
          v_res := public.record_stock_movement(li ->> 'code', 'return_in', v_qty, 'rack_remove', p_machine_id::text, v_ref, v_uid, v_name);
          v_returned := v_returned || jsonb_build_object('code', li ->> 'code', 'qty', v_qty, 'after_stock', v_res -> 'after_stock');
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO v_pend_ids FROM public.pending_log WHERE issue_id = ANY(v_issue_ids);

  -- 070: keep a full copy of every row this call removes.
  INSERT INTO public.audit_log (user_id, user_name, user_role, type, module, action, ref, serial_no, old_value, details)
  VALUES (v_uid, coalesce(v_name, 'System'), v_role, 'machine_rack_remove_snapshot', 'Machine',
          'Rack remove snapshot: ' || v_m.bom_key || CASE WHEN COALESCE(v_m.serial_no, '') <> '' THEN ' [' || v_m.serial_no || ']' ELSE '' END,
          v_m.bom_key, v_m.serial_no, to_jsonb(v_m),
          jsonb_build_object('machine_id', p_machine_id, 'returned', v_returned,
            'outward_rows', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]'::jsonb) FROM public.outward_log o WHERE o.id = ANY(v_out_ids)),
            'pending_rows', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb) FROM public.pending_log p WHERE p.id = ANY(v_pend_ids)),
            'linked_rows',  jsonb_build_object(
               'pending_handover_items', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.pending_handover_items x WHERE x.machine_id = p_machine_id),
               'checklist_responses',    (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.checklist_responses x    WHERE x.machine_id = p_machine_id),
               'machine_attachments',    (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.machine_attachments x    WHERE x.machine_id = p_machine_id))));

  DELETE FROM public.pending_log WHERE id = ANY(v_pend_ids);
  DELETE FROM public.outward_log WHERE id = ANY(v_out_ids);
  PERFORM set_config('app.allow_hard_delete', 'on', true);
  DELETE FROM public.machine_log WHERE id = p_machine_id;
  PERFORM set_config('app.allow_hard_delete', 'off', true);

  RETURN jsonb_build_object(
    'ok', true, 'machine_id', p_machine_id, 'already_removed', v_already,
    'returned', v_returned,
    'outward_ids', to_jsonb(v_out_ids),
    'pending_ids', to_jsonb(v_pend_ids));
END
$$;
REVOKE ALL ON FUNCTION public.rack_remove_machine(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rack_remove_machine(bigint) TO authenticated, service_role;

COMMIT;
