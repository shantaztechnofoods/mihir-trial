-- ════════════════════════════════════════════════════════════════════════════
-- 054 — Partial receipts for pending jobs (parts), with stock inward
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why: "Part received" on a pending job was a one-shot yes/no. A part that is
-- owed in a quantity (100 pending) usually arrives in pieces (50 today, 50
-- later). The floor must record the quantity that ACTUALLY arrived, that
-- quantity must go into stock, the rest must stay pending, and every receipt
-- must stay on record with who/when/what was verified.
--
-- What this adds (additive; no existing row is changed or back-filled):
--   pending_handover_items.received_qty   running total received so far
--                                         (default 0). Remaining pending =
--                                         qty − received_qty.
--   pending_item_receipts                 one immutable row per receipt:
--                                         qty, time, employee, department,
--                                         verification (serials / ticks),
--                                         remaining after it, stock result.
--   receive_pending_part(...)             the ONLY way to record a receipt.
--                                         One transaction: lock the job, check
--                                         the quantity, insert the receipt,
--                                         inward stock (only when the part is
--                                         in the Item Master), update the
--                                         running total. A double click or a
--                                         second device cannot inward twice —
--                                         the second call sees the new total.
--
-- The job's old "received" fields (received_at / received_by / …) are set by
-- the function when the LAST piece arrives, so every existing report, chip and
-- guard keeps working unchanged. "Work completed" is still a separate step.
--
-- Stock: movement type purchase_in via record_stock_movement (the same engine
-- every other stock change uses), reference 'pending_receipt' / receipt id.
-- A part that is not in the Item Master has no stock row — the receipt is
-- recorded, stock_inwarded stays false, nothing is created in Item Master.
--
-- Rollback: 054_pending_item_receipts_rollback.sql (refuses once receipts exist).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.pending_handover_items
  ADD COLUMN IF NOT EXISTS received_qty numeric NOT NULL DEFAULT 0 CHECK (received_qty >= 0);
COMMENT ON COLUMN public.pending_handover_items.received_qty IS
  'Running total received so far across all receipts (pending_item_receipts). Remaining pending = qty − received_qty.';

CREATE TABLE IF NOT EXISTS public.pending_item_receipts (
  id                    bigserial    PRIMARY KEY,
  pending_item_id       bigint       NOT NULL REFERENCES public.pending_handover_items(id) ON DELETE CASCADE,
  machine_id            bigint       NOT NULL,
  item_code             text,
  item_name             text,
  qty_received          numeric      NOT NULL CHECK (qty_received > 0),
  remaining_qty         numeric      CHECK (remaining_qty IS NULL OR remaining_qty >= 0),
  received_at           timestamptz  NOT NULL DEFAULT now(),
  received_by           uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  received_by_name      text,
  received_in_department text,
  notes                 text,
  verification          jsonb,
  stock_inwarded        boolean      NOT NULL DEFAULT false,
  stock_after           numeric
);
CREATE INDEX IF NOT EXISTS pending_item_receipts_item_idx    ON public.pending_item_receipts (pending_item_id, received_at);
CREATE INDEX IF NOT EXISTS pending_item_receipts_machine_idx ON public.pending_item_receipts (machine_id);

ALTER TABLE public.pending_item_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_item_receipts_select ON public.pending_item_receipts;
CREATE POLICY pending_item_receipts_select ON public.pending_item_receipts
  FOR SELECT TO authenticated USING (is_active_user());
-- No INSERT / UPDATE / DELETE policy: only receive_pending_part() writes here.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pending_item_receipts FROM anon, authenticated;
REVOKE ALL ON public.pending_item_receipts FROM anon;
GRANT SELECT ON public.pending_item_receipts TO authenticated;

-- Receipts are a permanent record: even a direct write by an app role is refused.
CREATE OR REPLACE FUNCTION public.pending_item_receipts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Receipt records cannot be changed or deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS pending_item_receipts_guard ON public.pending_item_receipts;
CREATE TRIGGER pending_item_receipts_guard
  BEFORE UPDATE OR DELETE ON public.pending_item_receipts
  FOR EACH ROW EXECUTE FUNCTION public.pending_item_receipts_guard();

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
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Not allowed to record a receipt' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission('machines', 'finishTransfer') THEN
    RAISE EXCEPTION 'You do not have permission to record a received part' USING ERRCODE = '42501';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Enter the quantity that was actually received' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.pending_handover_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending job not found' USING ERRCODE = 'P0002'; END IF;
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pending_item_receipts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_item_receipts;
  END IF;
END $$;

COMMIT;
