-- ════════════════════════════════════════════════════════════════════════════
-- 057 — Accept: per-acceptance digital signature, name and department
-- ════════════════════════════════════════════════════════════════════════════
-- The employee_signatures row is ONE row per user, replaced in place, so a
-- reference to it cannot show what was signed on a given day. Each acceptance
-- now stores its own signature snapshot, the accepting user's name and the
-- department it was accepted into (accepted_at already holds the time).
-- The update guard (053) is extended to allow those three columns on an accept
-- and to stamp the department. Additive; no row is changed.
-- Rollback: 057_accept_signature_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
ALTER TABLE public.handover_events
  ADD COLUMN IF NOT EXISTS accepted_signature_svg text,
  ADD COLUMN IF NOT EXISTS accepted_by_name       text,
  ADD COLUMN IF NOT EXISTS accepted_in_department text;

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
    v_allowed := ARRAY['status','accepted_by','accepted_by_signature_id','accepted_at','accepted_by_team_snapshot',
                       'accepted_signature_svg','accepted_by_name','accepted_in_department'];
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
  IF v_kind = 'accept' THEN
    -- Migration 057: the department is the one the machine is accepted into,
    -- set here rather than trusted from the client. The signature is enforced
    -- by the app (an older cached client that sends none is not locked out).
    NEW.accepted_in_department := NEW.to_department;
  END IF;
  RETURN NEW;
END
$$;
COMMIT;
