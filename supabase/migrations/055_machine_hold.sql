-- ════════════════════════════════════════════════════════════════════════════
-- 055 — Manual ON HOLD for machines; department-aware Part received
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Manual ON HOLD. machine_log gets hold_active / hold_reason / hold_by /
--    hold_at. (The automatic "accept deadline passed" ON HOLD is computed from
--    the hand-over and is untouched.) A trigger makes the database the
--    authority: changing a hold needs Finish & Transfer or Update Stage (Admin
--    and super admin hold both); putting on hold needs a reason and records the
--    real user and time; and while a machine is on hold no hand-over can be
--    sent for it and none can be accepted. History is still append-only (053).
--
-- 2. receive_pending_part() (054) no longer lets any Finish & Transfer user
--    receive any department's job: Admin / super admin — any job; others —
--    jobs assigned to one of their departments or on a machine currently in
--    one of their departments; a Stores job may also be received by a holder
--    of the inward permission. Everything else in the function is unchanged
--    (pending-quantity limit, partial receipts, critical verification, serial
--    rules, stock via record_stock_movement, receipt rows).
--
-- Additive; no row is changed. Rollback: 055_machine_hold_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.machine_log
  ADD COLUMN IF NOT EXISTS hold_active boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS hold_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hold_at     timestamptz;

CREATE OR REPLACE FUNCTION public.machine_hold_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.hold_active IS DISTINCT FROM OLD.hold_active
     OR NEW.hold_reason IS DISTINCT FROM OLD.hold_reason
     OR NEW.hold_by IS DISTINCT FROM OLD.hold_by
     OR NEW.hold_at IS DISTINCT FROM OLD.hold_at THEN
    IF NOT (public.is_service_caller()
            OR public.has_permission('machines', 'finishTransfer')
            OR public.has_permission('machines', 'updateStage')) THEN
      RAISE EXCEPTION 'You do not have permission to put a machine on hold or release it' USING ERRCODE = '42501';
    END IF;
    IF NEW.hold_active AND NOT OLD.hold_active THEN
      IF NEW.hold_reason IS NULL OR btrim(NEW.hold_reason) = '' THEN
        RAISE EXCEPTION 'Write why the machine is being put on hold' USING ERRCODE = '22023';
      END IF;
      IF NOT public.is_service_caller() THEN
        NEW.hold_by := auth.uid();
        NEW.hold_at := now();
      END IF;
    ELSIF NEW.hold_active AND OLD.hold_active THEN
      RAISE EXCEPTION 'This machine is already on hold' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.machine_hold_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS machine_hold_guard ON public.machine_log;
CREATE TRIGGER machine_hold_guard BEFORE UPDATE ON public.machine_log
  FOR EACH ROW EXECUTE FUNCTION public.machine_hold_guard();

-- A machine on hold neither sends nor accepts a hand-over.
CREATE OR REPLACE FUNCTION public.handover_hold_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status = 'pending') THEN
    IF EXISTS (SELECT 1 FROM public.machine_log WHERE id = NEW.machine_id AND hold_active) THEN
      RAISE EXCEPTION 'This machine is ON HOLD — release the hold first' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handover_hold_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS handover_hold_guard ON public.handover_events;
CREATE TRIGGER handover_hold_guard BEFORE INSERT OR UPDATE ON public.handover_events
  FOR EACH ROW EXECUTE FUNCTION public.handover_hold_guard();

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
             AND (cardinality(v_depts) = 0   -- not tied to a department (e.g. Production Head): unscoped, as everywhere else in the app
                  OR COALESCE(v_job.assigned_department, '') = ANY (v_depts) OR COALESCE(v_mdept, '') = ANY (v_depts)))
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
REVOKE ALL ON FUNCTION public.receive_pending_part(bigint, numeric, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_pending_part(bigint, numeric, text, jsonb, text) TO authenticated, service_role;

COMMIT;
