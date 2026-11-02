-- ─────────────────────────────────────────────────────────────────────────────
-- 053_go_live_security.sql — Machine Tracker go-live hardening (2026-11-01)
--
-- Closes the findings of the 2026-11-01 go-live audit without touching any
-- business data. Everything here is additive or a tightened policy; no rows
-- are deleted or rewritten. Rollback: 053_go_live_security_rollback.sql
--
--  1. Roles: a 'no_access' system role (new sign-ups land there, disabled) and
--     the 'Production Head' role the client already knows (release only).
--  2. New Auth sign-ups never get Admin: handle_new_auth_user() → no_access +
--     disabled. Admin-created users are upgraded afterwards by the
--     admin-create-user Edge Function (service role), exactly as today.
--  3. users: self-edit limited to full_name / mobile; nobody but a super admin
--     can grant super_admin; a user can never change their own role, status,
--     overrides or departments.
--  4. machine_log: department staff (finishTransfer / accept / release) may
--     update the machine — but only the workflow columns. Machine identity
--     (bom_key, serial_no, issue_id, created_*) stays admin-only. History is
--     merged, never overwritten: entries missing from an incoming array are
--     kept, new ones appended.
--  5. handover_events: accept / cancel / release require the matching
--     permission and an active account; finalised rows are immutable; the
--     columns each transition may touch are enforced; a machine can have only
--     one open hand-over (unique partial index); accept is refused while a
--     rack release is still pending.
--  6. Reads of Machine Tracker tables and the attachments bucket require an
--     active account (disabled users see nothing).
--  7. record_stock_movement: callable only by an active user or the service
--     role; the recorded user is the caller. Anonymous key revoked.
--  8. admin_cleanup_machines: EXECUTE revoked from everyone (Data Cleanup is
--     switched off). The function and the audit trail stay.
--  9. v_dept_roster: no longer readable with the anonymous key.
-- 10. settings: the org record is readable only by super admins; everyone
--     else reads it through get_org_settings(), which strips API keys.
-- 11. Realtime: handover_events, pending_handover_items, checklist_responses,
--     department_ratings and machine_attachments join the publication.
-- 12. rack_remove_machine(): atomic, idempotent Remove From Rack (stock return
--     + outward/pending/machine delete in one transaction; a retry or a
--     reload can never credit stock twice).
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- Shared helper: true for the service role / dashboard owner, where RLS is
-- bypassed anyway; lets the guards below stay out of the way of migrations,
-- Edge Functions and the SQL editor.
-- NOTE: current_user is useless here — inside a SECURITY DEFINER function it
-- is the function owner. The API always connects as 'authenticator' and
-- carries a JWT; the SQL editor and migrations carry no JWT subject.
CREATE OR REPLACE FUNCTION public.is_service_caller() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      OR (session_user <> 'authenticator'
          AND COALESCE(current_setting('request.jwt.claim.sub', true), '') = '');
$$;
REVOKE ALL ON FUNCTION public.is_service_caller() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_service_caller() TO authenticated, anon, service_role;

-- ── 1. Roles ────────────────────────────────────────────────────────────────
INSERT INTO public.roles (key, label, icon, color, badge, pages, actions, is_system)
VALUES ('no_access', 'No Access', '⛔', '#64748b', 'No Access', '[]'::jsonb,
        '{"inventory":{"add":false,"edit":false,"delete":false,"adjust":false},
          "pipeline":{"create":false,"approve":false,"reject":false,"ordered":false,"receive":false,"delete":false},
          "outward":{"bom":false,"manual":false,"editBOM":false},
          "machines":{"updateStage":false,"finishTransfer":false,"accept":false,"configDept":false,"release":false},
          "vendors":{"add":false,"edit":false,"delete":false},
          "inward":{"submit":false},
          "pending":{"fulfill":false,"clear":false},
          "users":{"view":false,"create":false,"edit":false,"delete":false},
          "roles":{"view":false,"create":false,"edit":false,"delete":false}}'::jsonb, true)
ON CONFLICT (key) DO NOTHING;

-- Mirrors DEFAULT_ROLES["Production Head"] in src/auth/authStore.js: sees the
-- line, decides the rack release, cannot sign for a department.
INSERT INTO public.roles (key, label, icon, color, badge, pages, actions, is_system)
VALUES ('Production Head', 'Production Head', '🏭', '#4338ca', 'Production Head',
        '["dashboard","machines","history","reports"]'::jsonb,
        '{"inventory":{"add":false,"edit":false,"delete":false,"adjust":false},
          "pipeline":{"create":false,"approve":false,"reject":false,"ordered":false,"receive":false,"delete":false},
          "outward":{"bom":false,"manual":false,"editBOM":false},
          "machines":{"updateStage":false,"finishTransfer":false,"accept":false,"configDept":false,"release":true},
          "vendors":{"add":false,"edit":false,"delete":false},
          "inward":{"submit":false},
          "pending":{"fulfill":false,"clear":false},
          "users":{"view":false,"create":false,"edit":false,"delete":false},
          "roles":{"view":false,"create":false,"edit":false,"delete":false}}'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

-- ── 2. New sign-ups get nothing ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $func$
DECLARE
  v_base_username  text;
  v_username       text;
  v_attempt        int := 0;
BEGIN
  v_base_username := COALESCE(NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
                              'user_' || substring(NEW.id::text, 1, 8));
  v_username := v_base_username;
  WHILE EXISTS (SELECT 1 FROM public.users WHERE username = v_username) AND v_attempt < 5 LOOP
    v_attempt := v_attempt + 1;
    v_username := v_base_username || '_' || substring(md5(random()::text || NEW.id::text), 1, 4);
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
    v_username := v_base_username || '_' || substring(NEW.id::text, 1, 8);
  END IF;

  -- 2026-11-01: every new Auth account starts with NO access and DISABLED.
  -- Only the admin-create-user Edge Function (service role) upgrades it.
  BEGIN
    INSERT INTO public.users (id, username, full_name, role_key, status)
    VALUES (NEW.id, v_username, COALESCE(NEW.raw_user_meta_data ->> 'full_name', v_username), 'no_access', 'disabled')
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_auth_user: profile insert failed for id=% — % (SQLSTATE: %)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END
$func$;

-- ── 3. users: who may change what ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.users_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF public.is_service_caller() OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- Nobody below super admin can hand out super_admin, or touch a super
  -- admin's account at all.
  IF NEW.role_key = 'super_admin' AND OLD.role_key IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only a super admin can grant the super admin role' USING ERRCODE = '42501';
  END IF;
  IF OLD.role_key = 'super_admin' THEN
    RAISE EXCEPTION 'Only a super admin can modify a super admin account' USING ERRCODE = '42501';
  END IF;

  -- Nobody can change their own role, status, overrides or departments.
  IF NEW.id = v_uid AND (
       NEW.role_key    IS DISTINCT FROM OLD.role_key    OR
       NEW.status      IS DISTINCT FROM OLD.status      OR
       NEW.overrides   IS DISTINCT FROM OLD.overrides   OR
       NEW.departments IS DISTINCT FROM OLD.departments OR
       NEW.username    IS DISTINCT FROM OLD.username    OR
       NEW.id          IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'You cannot change your own role, status, permissions or department' USING ERRCODE = '42501';
  END IF;

  -- Without users.edit the only editable fields are the profile ones.
  IF NOT public.has_permission('users', 'edit') THEN
    IF NEW.id <> v_uid THEN
      RAISE EXCEPTION 'No permission to edit other users' USING ERRCODE = '42501';
    END IF;
    IF NEW.role_key    IS DISTINCT FROM OLD.role_key    OR
       NEW.status      IS DISTINCT FROM OLD.status      OR
       NEW.overrides   IS DISTINCT FROM OLD.overrides   OR
       NEW.departments IS DISTINCT FROM OLD.departments OR
       NEW.username    IS DISTINCT FROM OLD.username    OR
       NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Only your name and mobile number can be changed here' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.users_update_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS users_update_guard ON public.users;
CREATE TRIGGER users_update_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_update_guard();

-- ── 4. machine_log: staff may move machines, not rewrite them ───────────────
DROP POLICY IF EXISTS machine_update ON public.machine_log;
CREATE POLICY machine_update ON public.machine_log FOR UPDATE
  USING (has_permission('machines','updateStage')
      OR has_permission('machines','finishTransfer')
      OR has_permission('machines','accept')
      OR has_permission('machines','release'))
  WITH CHECK (has_permission('machines','updateStage')
      OR has_permission('machines','finishTransfer')
      OR has_permission('machines','accept')
      OR has_permission('machines','release'));

CREATE OR REPLACE FUNCTION public.machine_log_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_incoming jsonb;
  v_entry    jsonb;
BEGIN
  -- History is append-only and merge-safe for everyone: two devices sending
  -- their own copy of the array both keep their entry, and nothing is lost.
  IF NEW.history IS DISTINCT FROM OLD.history THEN
    v_incoming := COALESCE(NEW.history, '[]'::jsonb);
    IF jsonb_typeof(v_incoming) <> 'array' THEN v_incoming := '[]'::jsonb; END IF;
    NEW.history := COALESCE(OLD.history, '[]'::jsonb);
    IF jsonb_typeof(NEW.history) <> 'array' THEN NEW.history := '[]'::jsonb; END IF;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_incoming) LOOP
      IF NOT (NEW.history @> jsonb_build_array(v_entry)) THEN
        NEW.history := NEW.history || jsonb_build_array(v_entry);
      END IF;
    END LOOP;
  END IF;

  IF public.is_service_caller() OR public.has_permission('machines', 'updateStage') THEN
    RETURN NEW;
  END IF;

  -- Department staff: workflow columns only.
  IF NEW.id           IS DISTINCT FROM OLD.id           OR
     NEW.issue_id     IS DISTINCT FROM OLD.issue_id     OR
     NEW.bom_key      IS DISTINCT FROM OLD.bom_key      OR
     NEW.bom_label    IS DISTINCT FROM OLD.bom_label    OR
     NEW.serial_no    IS DISTINCT FROM OLD.serial_no    OR
     NEW.created_date IS DISTINCT FROM OLD.created_date OR
     NEW.created_at   IS DISTINCT FROM OLD.created_at   OR
     NEW.created_by   IS DISTINCT FROM OLD.created_by   OR
     NEW.dept_durations IS DISTINCT FROM OLD.dept_durations THEN
    RAISE EXCEPTION 'Only an admin can change machine identity (BOM, serial, issue, durations)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.machine_log_update_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS machine_log_update_guard ON public.machine_log;
CREATE TRIGGER machine_log_update_guard
  BEFORE UPDATE ON public.machine_log
  FOR EACH ROW EXECUTE FUNCTION public.machine_log_update_guard();

-- ── 5. handover_events ──────────────────────────────────────────────────────
-- One open hand-over per machine, enforced where it counts.
CREATE UNIQUE INDEX IF NOT EXISTS handover_events_one_open_per_machine
  ON public.handover_events (machine_id) WHERE (status = 'pending');

DROP POLICY IF EXISTS handover_events_select_authenticated ON public.handover_events;
CREATE POLICY handover_events_select_authenticated ON public.handover_events
  FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS handover_events_insert_sender ON public.handover_events;
CREATE POLICY handover_events_insert_sender ON public.handover_events
  FOR INSERT TO authenticated
  WITH CHECK (sent_by = auth.uid() AND has_permission('machines','finishTransfer'));

DROP POLICY IF EXISTS handover_events_accept ON public.handover_events;
CREATE POLICY handover_events_accept ON public.handover_events
  FOR UPDATE TO authenticated
  USING (status = 'pending'
         AND (has_permission('machines','accept') OR has_permission('machines','finishTransfer')))
  WITH CHECK (
       (status = 'accepted' AND accepted_by = auth.uid() AND has_permission('machines','accept')
        AND (release_required IS NOT TRUE OR released_at IS NOT NULL))
    OR (status = 'cancelled' AND sent_by = auth.uid() AND has_permission('machines','finishTransfer'))
  );

DROP POLICY IF EXISTS handover_events_release ON public.handover_events;
CREATE POLICY handover_events_release ON public.handover_events
  FOR UPDATE TO authenticated
  USING (status = 'pending' AND release_required = true AND released_at IS NULL
         AND (has_permission('machines','release') OR has_permission('machines','configDept')))
  WITH CHECK (status = 'pending' AND release_required = true AND released_at IS NOT NULL
         AND released_by = auth.uid()
         AND (has_permission('machines','release') OR has_permission('machines','configDept')));

-- Column guard: each transition may touch only its own columns; finalised
-- rows never change again.
CREATE OR REPLACE FUNCTION public.handover_events_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed text[];
  v_allowed text[];
  v_kind    text;
  r         record;
BEGIN
  IF public.is_service_caller() THEN RETURN NEW; END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'A finalised hand-over cannot be modified' USING ERRCODE = '42501';
  END IF;

  -- Generated columns (overrun_minutes) are NULL in NEW inside a BEFORE
  -- trigger; they are recomputed by Postgres and must not count as changes.
  SELECT array_agg(key) INTO v_changed
    FROM jsonb_each(to_jsonb(NEW)) n
   WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
     AND n.key NOT IN (SELECT a.attname::text FROM pg_attribute a
                        WHERE a.attrelid = 'public.handover_events'::regclass AND a.attgenerated <> '');
  v_changed := COALESCE(v_changed, '{}');

  IF NEW.status = 'accepted' THEN
    v_kind := 'accept';
    v_allowed := ARRAY['status','accepted_by','accepted_by_signature_id','accepted_at','accepted_by_team_snapshot'];
  ELSIF NEW.status = 'cancelled' THEN
    v_kind := 'cancel';
    v_allowed := ARRAY['status','cancelled_at','cancellation_reason'];
  ELSIF NEW.status = 'pending' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL THEN
    v_kind := 'release';
    v_allowed := ARRAY['released_at','released_by'];
  ELSE
    RAISE EXCEPTION 'Hand-over records can only be accepted, cancelled or released' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_changed <@ v_allowed) THEN
    RAISE EXCEPTION 'A hand-over % may not change: %', v_kind,
      array_to_string(ARRAY(SELECT unnest(v_changed) EXCEPT SELECT unnest(v_allowed)), ', ')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.handover_events_update_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS handover_events_update_guard ON public.handover_events;
CREATE TRIGGER handover_events_update_guard
  BEFORE UPDATE ON public.handover_events
  FOR EACH ROW EXECUTE FUNCTION public.handover_events_update_guard();

-- ── 6. Reads need an active account ─────────────────────────────────────────
DROP POLICY IF EXISTS pending_handover_items_select ON public.pending_handover_items;
CREATE POLICY pending_handover_items_select ON public.pending_handover_items
  FOR SELECT TO authenticated USING (is_active_user());
DROP POLICY IF EXISTS checklist_responses_select ON public.checklist_responses;
CREATE POLICY checklist_responses_select ON public.checklist_responses
  FOR SELECT TO authenticated USING (is_active_user());
DROP POLICY IF EXISTS department_ratings_select ON public.department_ratings;
CREATE POLICY department_ratings_select ON public.department_ratings
  FOR SELECT TO authenticated USING (is_active_user());
DROP POLICY IF EXISTS machine_attachments_select ON public.machine_attachments;
CREATE POLICY machine_attachments_select ON public.machine_attachments
  FOR SELECT TO authenticated USING (is_active_user());
DROP POLICY IF EXISTS machine_attachments_auth_read ON storage.objects;
CREATE POLICY machine_attachments_auth_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'machine-attachments' AND is_active_user());

-- ── 7. record_stock_movement: active callers only, caller is the user ───────
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_item_code      text,
  p_movement_type  text,
  p_qty            numeric,
  p_reference_type text DEFAULT NULL,
  p_reference_id   text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_user_id        uuid DEFAULT NULL,
  p_user_name      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_item      public.items%ROWTYPE;
  v_before    numeric;
  v_after     numeric;
  v_min       numeric;
  v_status    text;
  v_trend     jsonb;
  v_uid       uuid := auth.uid();
  v_name      text;
BEGIN
  -- 2026-11-01: the anonymous key could call this. Now only an active user
  -- (or the service role) may, and the ledger records the real caller.
  IF NOT public.is_service_caller() THEN
    IF v_uid IS NULL OR NOT public.is_active_user() THEN
      RAISE EXCEPTION 'Not allowed to record stock movements' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(full_name, username) INTO v_name FROM public.users WHERE id = v_uid;
    p_user_id   := v_uid;
    p_user_name := COALESCE(v_name, p_user_name);
  END IF;

  IF p_movement_type NOT IN (
    'purchase_in','production_issue','production_output',
    'manual_adjustment','sales_out','return_in','return_out'
  ) THEN
    RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type USING ERRCODE = 'check_violation';
  END IF;
  IF p_qty IS NULL OR p_qty = 0 THEN
    RAISE EXCEPTION 'Movement qty must be a non-zero number' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_item FROM public.items WHERE code = p_item_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found: %', p_item_code USING ERRCODE = 'no_data_found';
  END IF;

  v_before := COALESCE(v_item.stock, 0);
  v_after  := v_before + p_qty;
  v_min    := COALESCE(v_item.min_stock, 0);
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for % — on hand %, requested change %, would result in %',
      p_item_code, v_before, p_qty, v_after USING ERRCODE = 'check_violation';
  END IF;

  v_status := CASE
    WHEN v_after <= 0 THEN 'critical'
    WHEN v_after <= v_min AND v_after / GREATEST(1, v_min) < 0.15 THEN 'critical'
    WHEN v_after <= v_min THEN 'warning'
    ELSE 'safe'
  END;

  v_trend := COALESCE(v_item.trend, '[]'::jsonb) || jsonb_build_array(v_after);
  IF jsonb_array_length(v_trend) > 5 THEN
    v_trend := (
      SELECT jsonb_agg(val ORDER BY ord)
      FROM jsonb_array_elements(v_trend) WITH ORDINALITY AS t(val, ord)
      WHERE ord > jsonb_array_length(v_trend) - 5
    );
  END IF;

  UPDATE public.items SET stock = v_after, status = v_status, trend = v_trend WHERE id = v_item.id;

  INSERT INTO public.stock_movements
    (item_id, item_code, item_name, movement_type, qty, before_stock, after_stock,
     reference_type, reference_id, notes, created_by, created_by_name)
  VALUES
    (v_item.id, v_item.code, v_item.name, p_movement_type, p_qty, v_before, v_after,
     p_reference_type, p_reference_id, p_notes, p_user_id, p_user_name);

  INSERT INTO public.item_history
    (item_id, item_code, item_name, category, event_type, quantity_change,
     stock_before, stock_after, reference_number, notes, created_by, created_by_name)
  VALUES
    (v_item.id, v_item.code, v_item.name, v_item.category, p_movement_type, p_qty,
     v_before, v_after, p_reference_id, p_notes, p_user_id, p_user_name);

  RETURN jsonb_build_object(
    'success', true, 'item_code', v_item.code, 'movement_type', p_movement_type,
    'before_stock', v_before, 'after_stock', v_after, 'status', v_status,
    'reserved_stock', COALESCE(v_item.reserved_stock, 0),
    'available_stock', v_after - COALESCE(v_item.reserved_stock, 0)
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.record_stock_movement(text, text, numeric, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movement(text, text, numeric, text, text, text, uuid, text) TO authenticated, service_role;

-- ── 8. Data Cleanup switched off ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_cleanup_machines(bigint[], boolean, bigint[]) FROM PUBLIC, anon, authenticated;

-- ── 9. Roster not readable anonymously ──────────────────────────────────────
REVOKE ALL ON public.v_dept_roster FROM anon, PUBLIC;
GRANT SELECT ON public.v_dept_roster TO authenticated, service_role;

-- ── 10. settings: keys stay on the server ───────────────────────────────────
DROP POLICY IF EXISTS settings_select ON public.settings;
CREATE POLICY settings_select ON public.settings FOR SELECT USING (is_super_admin());

CREATE OR REPLACE FUNCTION public.get_org_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT value INTO v FROM public.settings WHERE key = 'org';
  IF v IS NULL THEN RETURN NULL; END IF;
  IF public.is_super_admin() THEN RETURN v; END IF;
  RETURN v - ARRAY['waApiKey','waAnthropicKey','waGeminiKey','waPhoneId','waWabaId','waPluginId','waAgentTraining','waHiddenChats'];
END
$$;
REVOKE ALL ON FUNCTION public.get_org_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_settings() TO authenticated, service_role;

-- ── 11. Realtime ────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['handover_events','pending_handover_items','checklist_responses','department_ratings','machine_attachments'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── 12. Remove From Rack: one transaction, never twice ──────────────────────
CREATE OR REPLACE FUNCTION public.rack_remove_machine(p_machine_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_name       text;
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
  SELECT COALESCE(full_name, username) INTO v_name FROM public.users WHERE id = v_uid;

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
  DELETE FROM public.pending_log WHERE id = ANY(v_pend_ids);
  DELETE FROM public.outward_log WHERE id = ANY(v_out_ids);
  DELETE FROM public.machine_log WHERE id = p_machine_id;

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
