-- Rollback for 070_no_hard_delete.sql — removes the delete guard triggers and
-- puts checklist_templates.bom_key back to ON DELETE SET NULL.
-- delete_machine_super_admin() and rack_remove_machine() are LEFT as 070 made
-- them: they behave exactly like 060/053 plus an extra audit snapshot, and the
-- set_config('app.allow_hard_delete', …) calls are harmless without the
-- triggers. Audit rows written meanwhile are kept (audit_log is immutable).
-- Never apply this on ERP LIVE without the owner's go-ahead.
BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_definitions','items','vendors','checklist_templates','item_history',
                           'machine_log','handover_events','pending_handover_items','checklist_responses'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_hard_delete', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate', t);
  END LOOP;
END
$$;
DROP FUNCTION IF EXISTS public.forbid_hard_delete();

ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_bom_key_fkey,
  ADD  CONSTRAINT checklist_templates_bom_key_fkey FOREIGN KEY (bom_key)
       REFERENCES public.bom_definitions(key) ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;
