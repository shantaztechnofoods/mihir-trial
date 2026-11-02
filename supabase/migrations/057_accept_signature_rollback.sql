-- Rollback for 057: restores the 053 guard function and drops the columns.
BEGIN;
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
ALTER TABLE public.handover_events DROP COLUMN IF EXISTS accepted_signature_svg, DROP COLUMN IF EXISTS accepted_by_name, DROP COLUMN IF EXISTS accepted_in_department;
COMMIT;
