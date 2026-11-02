-- ════════════════════════════════════════════════════════════════════════════
-- 058 — Department-level authorization (strict department-wise access)
-- ════════════════════════════════════════════════════════════════════════════
-- Until now the database checked WHAT a user may do (Accept, Finish & Transfer…)
-- but never WHERE: any user holding a permission could act on, and read, every
-- department's machines, hand-overs and jobs. The department is now taken from
-- the caller's own users row (auth.uid()) — never from anything the client sends.
--
-- Unscoped (see all departments): super_admin, role 'Admin', and any role that
-- holds machines.updateStage / configDept / release (admin-level and the
-- Production Head). Everyone else sees and acts only inside users.departments;
-- a floor user with NO department gets nothing.
-- "BOM Issued" (rack sets) belongs to Assembly, as in the app.
--
--  * SELECT limited to the user's departments: machine_log, handover_events,
--    pending_handover_items (+ receipts), checklist_responses, department_ratings,
--    machine_attachments; audit_log limited to own entries unless unscoped.
--  * Accept needs the TO department, Finish & Transfer the FROM department,
--    Part Received / Work completed the job's department (or the machine's).
--  * machine_log updates only for machines in the user's department (or being
--    accepted into it).
--  * users: only a super admin creates, edits (role, status, department,
--    overrides) and deletes accounts; everyone can edit their own name/mobile.
-- Additive: no rows touched. Rollback: 058_department_rls_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.my_departments() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT departments FROM public.users WHERE id = auth.uid() AND status = 'active'), '{}'::text[]);
$$;

CREATE OR REPLACE FUNCTION public.dept_unscoped() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND status = 'active' AND role_key IN ('super_admin', 'Admin'))
      OR public.has_permission('machines', 'updateStage')
      OR public.has_permission('machines', 'configDept')
      OR public.has_permission('machines', 'release');
$$;

CREATE OR REPLACE FUNCTION public.eff_dept(d text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN d = 'BOM Issued' THEN 'Assembly' ELSE d END; $$;

CREATE OR REPLACE FUNCTION public.in_dept(d text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.dept_unscoped() OR (d IS NOT NULL AND public.eff_dept(d) = ANY (public.my_departments()));
$$;

-- Machine is relevant to the caller: in their department now, handed to/from
-- it, or carrying a job assigned to it.
CREATE OR REPLACE FUNCTION public.machine_in_scope(p_machine_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.dept_unscoped()
      OR EXISTS (SELECT 1 FROM public.machine_log m WHERE m.id = p_machine_id AND public.in_dept(m.current_department))
      OR EXISTS (SELECT 1 FROM public.handover_events h WHERE h.machine_id = p_machine_id AND (public.in_dept(h.from_department) OR public.in_dept(h.to_department)))
      OR EXISTS (SELECT 1 FROM public.pending_handover_items p WHERE p.machine_id = p_machine_id AND public.in_dept(p.assigned_department));
$$;

-- May the caller change this machine row? Its department now, or the one it is being accepted into.
CREATE OR REPLACE FUNCTION public.machine_can_act(p_current text, p_pending_handover bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.in_dept(p_current)
      OR EXISTS (SELECT 1 FROM public.handover_events h WHERE h.id = p_pending_handover AND public.in_dept(h.to_department));
$$;

-- May the caller act on (receive / complete) a pending job? Assigned to their department,
-- the machine is in it, or a Stores job for a stock-inward user (same rule as receive_pending_part).
CREATE OR REPLACE FUNCTION public.pending_can_act(p_machine_id bigint, p_assigned text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.in_dept(p_assigned)
      OR EXISTS (SELECT 1 FROM public.machine_log m WHERE m.id = p_machine_id AND public.in_dept(m.current_department))
      OR (COALESCE(p_assigned, '') = 'Stores' AND public.has_permission('inward', 'submit'));
$$;
REVOKE ALL ON FUNCTION public.my_departments(), public.dept_unscoped(), public.in_dept(text), public.machine_in_scope(bigint),
  public.machine_can_act(text, bigint), public.pending_can_act(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_departments(), public.dept_unscoped(), public.in_dept(text), public.machine_in_scope(bigint),
  public.machine_can_act(text, bigint), public.pending_can_act(bigint, text), public.eff_dept(text) TO authenticated, service_role;

-- ── machine_log ──
DROP POLICY IF EXISTS machine_select ON public.machine_log;
CREATE POLICY machine_select ON public.machine_log FOR SELECT TO authenticated
  USING (public.machine_in_scope(id));
DROP POLICY IF EXISTS machine_update ON public.machine_log;
CREATE POLICY machine_update ON public.machine_log FOR UPDATE
  USING ((has_permission('machines','updateStage') OR has_permission('machines','finishTransfer')
          OR has_permission('machines','accept') OR has_permission('machines','release'))
         AND (public.dept_unscoped() OR public.machine_can_act(current_department, pending_handover_id)))
  WITH CHECK ((has_permission('machines','updateStage') OR has_permission('machines','finishTransfer')
          OR has_permission('machines','accept') OR has_permission('machines','release'))
         AND (public.dept_unscoped() OR public.in_dept(current_department)));

-- ── handover_events ──
DROP POLICY IF EXISTS handover_events_select_authenticated ON public.handover_events;
CREATE POLICY handover_events_select_authenticated ON public.handover_events FOR SELECT TO authenticated
  USING (public.in_dept(from_department) OR public.in_dept(to_department));
DROP POLICY IF EXISTS handover_events_insert_sender ON public.handover_events;
CREATE POLICY handover_events_insert_sender ON public.handover_events FOR INSERT TO authenticated
  WITH CHECK (sent_by = auth.uid() AND has_permission('machines','finishTransfer') AND public.in_dept(from_department));
DROP POLICY IF EXISTS handover_events_accept ON public.handover_events;
CREATE POLICY handover_events_accept ON public.handover_events FOR UPDATE TO authenticated
  USING (status = 'pending'
         AND (has_permission('machines','accept') OR has_permission('machines','finishTransfer'))
         AND (public.in_dept(to_department) OR public.in_dept(from_department)))
  WITH CHECK (
       (status = 'accepted' AND accepted_by = auth.uid() AND has_permission('machines','accept')
        AND public.in_dept(to_department)
        AND (release_required IS NOT TRUE OR released_at IS NOT NULL))
    OR (status = 'cancelled' AND sent_by = auth.uid() AND has_permission('machines','finishTransfer')
        AND public.in_dept(from_department))
  );

-- ── pending jobs ──
DROP POLICY IF EXISTS pending_handover_items_select ON public.pending_handover_items;
CREATE POLICY pending_handover_items_select ON public.pending_handover_items FOR SELECT TO authenticated
  USING (public.dept_unscoped() OR raised_by = auth.uid()
         OR public.in_dept(assigned_department) OR public.in_dept(raised_in_department)
         OR public.pending_can_act(machine_id, assigned_department));
DROP POLICY IF EXISTS pending_handover_items_insert ON public.pending_handover_items;
CREATE POLICY pending_handover_items_insert ON public.pending_handover_items FOR INSERT
  WITH CHECK (raised_by = auth.uid() AND has_permission('machines','accept') AND public.machine_in_scope(machine_id));
DROP POLICY IF EXISTS pending_handover_items_receive ON public.pending_handover_items;
CREATE POLICY pending_handover_items_receive ON public.pending_handover_items FOR UPDATE
  USING (status = 'open' AND received_at IS NULL AND public.pending_can_act(machine_id, assigned_department))
  WITH CHECK (status = 'open' AND received_at IS NOT NULL AND received_by = auth.uid() AND has_permission('machines','finishTransfer'));
DROP POLICY IF EXISTS pending_handover_items_resolve ON public.pending_handover_items;
CREATE POLICY pending_handover_items_resolve ON public.pending_handover_items FOR UPDATE
  USING (status = 'open' AND public.pending_can_act(machine_id, assigned_department))
  WITH CHECK (status = 'resolved' AND resolved_by = auth.uid() AND has_permission('machines','finishTransfer'));
DROP POLICY IF EXISTS pending_item_receipts_select ON public.pending_item_receipts;
CREATE POLICY pending_item_receipts_select ON public.pending_item_receipts FOR SELECT TO authenticated
  USING (public.dept_unscoped() OR EXISTS (SELECT 1 FROM public.pending_handover_items p WHERE p.id = pending_item_id));

-- ── checklists, ratings, attachments ──
DROP POLICY IF EXISTS checklist_responses_select ON public.checklist_responses;
CREATE POLICY checklist_responses_select ON public.checklist_responses FOR SELECT TO authenticated USING (public.machine_in_scope(machine_id));
DROP POLICY IF EXISTS checklist_responses_insert ON public.checklist_responses;
CREATE POLICY checklist_responses_insert ON public.checklist_responses FOR INSERT
  WITH CHECK (submitted_by = auth.uid()
    AND (has_permission('machines','finishTransfer') OR has_permission('machines','accept') OR has_permission('machines','updateStage'))
    AND public.machine_in_scope(machine_id));
DROP POLICY IF EXISTS department_ratings_select ON public.department_ratings;
CREATE POLICY department_ratings_select ON public.department_ratings FOR SELECT TO authenticated USING (public.machine_in_scope(machine_id));
DROP POLICY IF EXISTS department_ratings_insert ON public.department_ratings;
CREATE POLICY department_ratings_insert ON public.department_ratings FOR INSERT
  WITH CHECK (has_permission('machines','accept') AND public.machine_in_scope(machine_id));
DROP POLICY IF EXISTS machine_attachments_select ON public.machine_attachments;
CREATE POLICY machine_attachments_select ON public.machine_attachments FOR SELECT TO authenticated USING (public.machine_in_scope(machine_id));
DROP POLICY IF EXISTS machine_attachments_insert ON public.machine_attachments;
CREATE POLICY machine_attachments_insert ON public.machine_attachments FOR INSERT
  WITH CHECK (uploaded_by = auth.uid() AND has_permission('machines','finishTransfer') AND public.machine_in_scope(machine_id));

-- ── audit log: own entries unless unscoped ──
DROP POLICY IF EXISTS audit_select ON public.audit_log;
CREATE POLICY audit_select ON public.audit_log FOR SELECT TO authenticated
  USING (public.dept_unscoped() OR user_id = auth.uid());

-- ── users: only a super admin manages accounts and departments ──
DROP POLICY IF EXISTS users_insert ON public.users;
CREATE POLICY users_insert ON public.users FOR INSERT WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS users_delete ON public.users;
CREATE POLICY users_delete ON public.users FOR DELETE USING (is_super_admin());
DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users FOR UPDATE USING (is_super_admin() OR id = auth.uid()) WITH CHECK (is_super_admin() OR id = auth.uid());

-- ── Part Received: no "no-department = unscoped" loophole ──
CREATE OR REPLACE FUNCTION public.receive_pending_part(
  p_item_id      bigint,
  p_qty          numeric,
  p_notes        text  DEFAULT NULL,
  p_verification jsonb DEFAULT NULL,
  p_department   text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_name      text;
  v_job       public.pending_handover_items%ROWTYPE;
  v_remaining numeric;
  v_new_recv  numeric;
  v_new_rem   numeric;
  v_full      boolean;
  v_rid       bigint;
  v_stock     jsonb;
  v_inwarded  boolean := false;
  v_after     numeric;
  v_now       timestamptz := now();
  v_serials   jsonb;
  v_dup       text;
  v_role      text;
  v_depts     text[];
  v_mdept     text;
  v_ok        boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Not allowed to record a receipt' USING ERRCODE = '42501';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Enter the quantity that was actually received' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.pending_handover_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending job not found' USING ERRCODE = 'P0002'; END IF;
  -- Who may receive (migration 055): an Admin / super admin for any job; any
  -- other user needs Finish & Transfer AND the job to belong to one of their
  -- departments (assigned to it, or the machine is in it now); a Stores
  -- job may also be received by a user who holds the stock-inward permission.
  SELECT role_key, COALESCE(departments, '{}') INTO v_role, v_depts FROM public.users WHERE id = v_uid;
  IF v_role IN ('super_admin', 'Admin') THEN
    v_ok := true;
  ELSE
    SELECT current_department INTO v_mdept FROM public.machine_log WHERE id = v_job.machine_id;
    v_ok := (public.has_permission('machines', 'finishTransfer')
             AND (public.dept_unscoped()   -- 058: only admin-level / release roles are unscoped; a floor user with no department gets nothing
                  OR public.eff_dept(COALESCE(v_job.assigned_department, '')) = ANY (v_depts) OR public.eff_dept(COALESCE(v_mdept, '')) = ANY (v_depts)))
         OR (COALESCE(v_job.assigned_department, '') = 'Stores' AND public.has_permission('inward', 'submit'));
  END IF;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'You can only receive parts for your own department''s jobs' USING ERRCODE = '42501';
  END IF;
  IF v_job.status <> 'open' THEN
    RAISE EXCEPTION 'This pending job is already completed' USING ERRCODE = '42501';
  END IF;
  IF v_job.received_at IS NOT NULL THEN
    RAISE EXCEPTION 'This part is already fully received' USING ERRCODE = '42501';
  END IF;

  IF v_job.qty IS NOT NULL THEN
    v_remaining := GREATEST(v_job.qty - v_job.received_qty, 0);
    IF p_qty > v_remaining THEN
      RAISE EXCEPTION 'Only % is still pending — you entered %', v_remaining, p_qty USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Verification: a critical job cannot be received without it; serials must
  -- match the quantity, be distinct and never repeat an earlier receipt.
  IF v_job.critical AND (p_verification IS NULL OR p_verification = 'null'::jsonb) THEN
    RAISE EXCEPTION 'A critical item needs its verification before it can be received' USING ERRCODE = '22023';
  END IF;
  v_serials := CASE WHEN jsonb_typeof(p_verification -> 'serials') = 'array' THEN p_verification -> 'serials' ELSE NULL END;
  IF p_verification ->> 'kind' = 'serial' THEN
    IF v_serials IS NULL OR jsonb_array_length(v_serials) <> p_qty THEN
      RAISE EXCEPTION 'Enter exactly % serial number(s) for this receipt', p_qty USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_serials IS NOT NULL AND jsonb_array_length(v_serials) > 0 THEN
    IF (SELECT count(DISTINCT lower(btrim(s))) FROM jsonb_array_elements_text(v_serials) s)
       <> jsonb_array_length(v_serials) THEN
      RAISE EXCEPTION 'Each unit needs a different serial number' USING ERRCODE = '22023';
    END IF;
    SELECT s INTO v_dup
      FROM jsonb_array_elements_text(v_serials) s
     WHERE EXISTS (
       SELECT 1 FROM public.pending_item_receipts r,
              jsonb_array_elements_text(COALESCE(r.verification -> 'serials', '[]'::jsonb)) rs
        WHERE lower(btrim(rs)) = lower(btrim(s)))
     LIMIT 1;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'Serial "%" was already recorded on an earlier receipt', v_dup USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT COALESCE(full_name, username) INTO v_name FROM public.users WHERE id = v_uid;
  v_new_recv := v_job.received_qty + p_qty;
  v_new_rem  := CASE WHEN v_job.qty IS NULL THEN NULL ELSE GREATEST(v_job.qty - v_new_recv, 0) END;
  v_full     := v_job.qty IS NULL OR v_new_rem <= 0;
  v_rid      := nextval(pg_get_serial_sequence('public.pending_item_receipts', 'id'));

  -- Stock: only a part that is in the Item Master has a stock row.
  IF v_job.item_code IS NOT NULL AND btrim(v_job.item_code) <> ''
     AND EXISTS (SELECT 1 FROM public.items WHERE code = v_job.item_code) THEN
    v_stock := public.record_stock_movement(
      v_job.item_code, 'purchase_in', p_qty, 'pending_receipt', v_rid::text,
      'Pending part received — job #' || v_job.id || COALESCE(' · ' || NULLIF(btrim(p_notes), ''), ''),
      v_uid, v_name);
    v_inwarded := true;
    v_after := (v_stock ->> 'after_stock')::numeric;
  END IF;

  INSERT INTO public.pending_item_receipts
    (id, pending_item_id, machine_id, item_code, item_name, qty_received, remaining_qty, received_at,
     received_by, received_by_name, received_in_department, notes, verification, stock_inwarded, stock_after)
  VALUES
    (v_rid, v_job.id, v_job.machine_id, v_job.item_code, v_job.item_name, p_qty, v_new_rem, v_now,
     v_uid, v_name, NULLIF(btrim(COALESCE(p_department, '')), ''), NULLIF(btrim(COALESCE(p_notes, '')), ''),
     p_verification, v_inwarded, v_after);

  IF v_full THEN
    UPDATE public.pending_handover_items
       SET received_qty = v_new_recv, received_at = v_now, received_by = v_uid,
           received_notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
           received_in_department = NULLIF(btrim(COALESCE(p_department, '')), '')
     WHERE id = v_job.id;
  ELSE
    UPDATE public.pending_handover_items SET received_qty = v_new_recv WHERE id = v_job.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'receipt_id', v_rid, 'qty_received', p_qty,
    'received_qty', v_new_recv, 'remaining_qty', v_new_rem, 'fully_received', v_full,
    'stock_inwarded', v_inwarded, 'stock_after', v_after, 'received_at', v_now);
END;
$fn$;

COMMIT;
