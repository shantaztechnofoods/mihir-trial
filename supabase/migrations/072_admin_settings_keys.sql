-- ─────────────────────────────────────────────────────────────────────────────
-- 072_admin_settings_keys.sql — let Admin save Report Master + Department heads
--
-- Bug: Settings → Report Master (PR #184) and Settings → Department heads
-- (PR #157) are editable by Admin in the UI (handler decision: Report Master
-- editors are Super Admin + Admin), but public.settings only accepts INSERT /
-- UPDATE from is_super_admin() (006_rls.sql settings_upsert / settings_update),
-- so an Admin's save was refused.
--
-- Fix (additive, no policy change): one SECURITY DEFINER function that writes
-- exactly ONE of two allowed keys inside the 'org' row, merged server-side:
--   'report.master'   → value #> '{report,master}'
--   'departmentHeads' → value -> 'departmentHeads'
-- Callers: active super_admin or active Admin. Every other key, role, disabled
-- user and anon is refused. The rest of the row (incl. WhatsApp / AI secret
-- keys Admin never sees) is left untouched — Admin never sends a whole row.
-- The settings RLS policies are NOT changed.
-- Run order: AFTER 071. Rollback: 072_admin_settings_keys_rollback.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Precheck (read-only): expect policies settings_select/update/upsert on
-- is_super_admin(), and no save_org_setting function yet.
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'settings';
--   SELECT to_regprocedure('public.save_org_setting(text,jsonb)');   -- NULL

CREATE OR REPLACE FUNCTION public.save_org_setting(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_cur  jsonb;
BEGIN
  SELECT role_key INTO v_role FROM public.users
   WHERE id = v_uid AND status = 'active';
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('super_admin', 'Admin') THEN
    RAISE EXCEPTION 'Only Super Admin or Admin can change this setting' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key NOT IN ('report.master', 'departmentHeads') THEN
    RAISE EXCEPTION 'This setting cannot be saved here: %', coalesce(p_key, '(none)') USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'Setting value must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_value::text) > 65536 THEN
    RAISE EXCEPTION 'Setting value is too large' USING ERRCODE = '22023';
  END IF;

  -- Lock the single org row so two saves never lose each other's keys.
  INSERT INTO public.settings (key, value) VALUES ('org', '{}'::jsonb) ON CONFLICT (key) DO NOTHING;
  SELECT value INTO v_cur FROM public.settings WHERE key = 'org' FOR UPDATE;
  v_cur := coalesce(v_cur, '{}'::jsonb);

  IF p_key = 'report.master' THEN
    v_cur := v_cur || jsonb_build_object('report',
               (CASE WHEN jsonb_typeof(v_cur -> 'report') = 'object' THEN v_cur -> 'report' ELSE '{}'::jsonb END)
               || jsonb_build_object('master', p_value));
  ELSE
    v_cur := v_cur || jsonb_build_object('departmentHeads', p_value);
  END IF;

  UPDATE public.settings SET value = v_cur WHERE key = 'org';
  RETURN jsonb_build_object('ok', true, 'key', p_key);
END
$$;

REVOKE ALL ON FUNCTION public.save_org_setting(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_org_setting(text, jsonb) TO authenticated, service_role;

-- Verify (read-only): function exists, SECURITY DEFINER, anon cannot run it,
-- authenticated can, and the settings policies are still super-admin only.
--   SELECT p.prosecdef AS security_definer,
--          has_function_privilege('anon',          'public.save_org_setting(text,jsonb)', 'EXECUTE') AS anon_can,
--          has_function_privilege('authenticated', 'public.save_org_setting(text,jsonb)', 'EXECUTE') AS auth_can
--     FROM pg_proc p WHERE p.oid = to_regprocedure('public.save_org_setting(text,jsonb)');
--   -- expect: true | false | true
