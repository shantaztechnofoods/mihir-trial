-- ════════════════════════════════════════════════════════════════════════════
-- 063 — Atomic machine history append + compare-and-set stage update
-- ════════════════════════════════════════════════════════════════════════════
-- The app used to send a machine's WHOLE history array on every change. Two
-- people changing the same machine at the same moment (e.g. Hold + a stage
-- change) each sent their own copy; the 053 merge trigger saves most of those,
-- but a stage update still overwrote the row without checking what it was.
--
-- machine_append_history(machine, entries, updates, expected_stage, audit):
--   * appends the given entries in ONE statement (history = history || entries)
--     under a row lock — two concurrent appends both survive;
--   * optionally updates a fixed list of workflow columns (never identity);
--   * when p_expected_stage is given and the machine is no longer at that
--     stage, changes NOTHING and returns {ok:false, stale:true, machine:<row>}
--     so the app can refresh and tell the user;
--   * optional p_audit writes the audit_log row in the same transaction.
-- Authorization mirrors the machine_update RLS policy (058): an active user
-- holding updateStage / finishTransfer / accept / release, and acting inside
-- their own department (or unscoped). The 053 / 055 triggers still run.
--
-- Flows that rewrite history (sender-undo, admin pull-back) keep their
-- current path. Additive: no table, policy or row is changed.
-- Rollback: 063_machine_history_append_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.machine_append_history(
  p_machine_id     bigint,
  p_entries        jsonb DEFAULT '[]'::jsonb,
  p_updates        jsonb DEFAULT '{}'::jsonb,
  p_expected_stage text  DEFAULT NULL,
  p_audit          jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_user    public.users%ROWTYPE;
  v_m       public.machine_log%ROWTYPE;
  v_new     public.machine_log%ROWTYPE;
  v_entries jsonb := COALESCE(p_entries, '[]'::jsonb);
  v_upd     jsonb := COALESCE(p_updates, '{}'::jsonb);
  v_bad     text;
  v_audited boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Not allowed to change this machine' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_permission('machines', 'updateStage') OR public.has_permission('machines', 'finishTransfer')
          OR public.has_permission('machines', 'accept') OR public.has_permission('machines', 'release')) THEN
    RAISE EXCEPTION 'You do not have permission to change machines' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(v_entries) <> 'array' THEN
    RAISE EXCEPTION 'History entries must be a list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_entries) > 20 THEN
    RAISE EXCEPTION 'Too many history entries in one change' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_entries) e WHERE jsonb_typeof(e) <> 'object') THEN
    RAISE EXCEPTION 'Each history entry must be an object' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_upd) <> 'object' THEN
    RAISE EXCEPTION 'Updates must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(v_upd) k
   WHERE k NOT IN ('stage', 'status', 'completed_date', 'current_department', 'department_entered_at',
                   'pending_handover_id', 'hold_active', 'hold_reason', 'trial_certificate')
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Column % cannot be changed here', v_bad USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_m FROM public.machine_log WHERE id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found' USING ERRCODE = 'P0002'; END IF;

  -- Same rule as the machine_update policy USING clause (058).
  IF NOT (public.dept_unscoped() OR public.machine_can_act(v_m.current_department, v_m.pending_handover_id)) THEN
    RAISE EXCEPTION 'You can only change machines in your own department' USING ERRCODE = '42501';
  END IF;

  -- Compare-and-set: someone else moved the machine first. Change nothing.
  IF p_expected_stage IS NOT NULL AND v_m.stage IS DISTINCT FROM p_expected_stage THEN
    RETURN jsonb_build_object('ok', false, 'stale', true, 'machine', to_jsonb(v_m));
  END IF;

  UPDATE public.machine_log SET
    history               = COALESCE(history, '[]'::jsonb) || v_entries,
    stage                 = CASE WHEN v_upd ? 'stage'                 THEN v_upd ->> 'stage'                          ELSE stage END,
    status                = CASE WHEN v_upd ? 'status'                THEN v_upd ->> 'status'                         ELSE status END,
    completed_date        = CASE WHEN v_upd ? 'completed_date'        THEN (v_upd ->> 'completed_date')::date         ELSE completed_date END,
    current_department    = CASE WHEN v_upd ? 'current_department'    THEN v_upd ->> 'current_department'             ELSE current_department END,
    department_entered_at = CASE WHEN v_upd ? 'department_entered_at' THEN (v_upd ->> 'department_entered_at')::timestamptz ELSE department_entered_at END,
    pending_handover_id   = CASE WHEN v_upd ? 'pending_handover_id'   THEN (v_upd ->> 'pending_handover_id')::bigint  ELSE pending_handover_id END,
    hold_active           = CASE WHEN v_upd ? 'hold_active'           THEN COALESCE((v_upd ->> 'hold_active')::boolean, false) ELSE hold_active END,
    hold_reason           = CASE WHEN v_upd ? 'hold_reason'           THEN NULLIF(v_upd ->> 'hold_reason', '')        ELSE hold_reason END,
    trial_certificate     = CASE WHEN v_upd ? 'trial_certificate'     THEN NULLIF(v_upd -> 'trial_certificate', 'null'::jsonb) ELSE trial_certificate END
  WHERE id = p_machine_id
  RETURNING * INTO v_new;

  -- Same rule as the machine_update policy WITH CHECK clause (058).
  IF NOT (public.dept_unscoped() OR public.in_dept(v_new.current_department)) THEN
    RAISE EXCEPTION 'You can only move machines within your own department' USING ERRCODE = '42501';
  END IF;

  IF p_audit IS NOT NULL AND jsonb_typeof(p_audit) = 'object' THEN
    SELECT * INTO v_user FROM public.users WHERE id = v_uid;
    INSERT INTO public.audit_log (user_id, user_name, user_role, type, module, action, ref, serial_no, details)
    VALUES (v_uid, COALESCE(v_user.full_name, v_user.username, 'User'), v_user.role_key,
            COALESCE(NULLIF(p_audit ->> 'type', ''), 'machine_history'),
            COALESCE(NULLIF(p_audit ->> 'module', ''), 'Machine'),
            COALESCE(NULLIF(p_audit ->> 'action', ''), 'Machine updated'),
            COALESCE(p_audit ->> 'ref', v_new.bom_key),
            COALESCE(p_audit ->> 'serial_no', v_new.serial_no),
            COALESCE(p_audit -> 'details', '{}'::jsonb) || jsonb_build_object('machine_id', p_machine_id));
    v_audited := true;
  END IF;

  RETURN jsonb_build_object('ok', true, 'stale', false, 'audited', v_audited, 'machine', to_jsonb(v_new));
END;
$fn$;

REVOKE ALL ON FUNCTION public.machine_append_history(bigint, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.machine_append_history(bigint, jsonb, jsonb, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.machine_append_history(bigint, jsonb, jsonb, text, jsonb) IS
  '063: atomic history append + optional compare-and-set on stage; returns {ok, stale, audited, machine}.';

COMMIT;
