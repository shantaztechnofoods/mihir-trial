-- Tests for migration 072: Admin may save ONLY settings.report.master and
-- settings.departmentHeads, through save_org_setting(). Run against erp_test
-- built with 001..072:
--   bash tests/db/build_local_db.sh 072
--   su postgres -c "psql -q -d erp_test -f tests/db/072_admin_settings_tests.sql" | grep -E 'FAIL|PASSED|FAILED'
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
CREATE TEMP TABLE t_results (name text, ok boolean);
GRANT ALL ON t_results TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_ok,false));
      RAISE NOTICE '%  %', CASE WHEN coalesce(p_ok,false) THEN 'PASS' ELSE 'FAIL' END, p_name; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_uid = '' THEN 'anon' ELSE 'authenticated' END, true);
  IF p_uid = '' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
  BEGIN EXECUTE p_sql; v := '00000'; EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_service(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;
  BEGIN EXECUTE p_sql; v := '00000'; EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;

\set SA  '''c0000000-0000-0000-0000-000000000001'''
\set ADM '''c0000000-0000-0000-0000-000000000002'''
\set PRD '''c0000000-0000-0000-0000-000000000003'''
\set OFF '''c0000000-0000-0000-0000-000000000004'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ADM,'adm@t'),(:PRD,'prd@t'),(:OFF,'off@t');
UPDATE public.users SET role_key='super_admin', status='active'   WHERE id=:SA;
UPDATE public.users SET role_key='Admin',       status='active'   WHERE id=:ADM;
UPDATE public.users SET role_key='Production',  status='active'   WHERE id=:PRD;
UPDATE public.users SET role_key='Admin',       status='disabled' WHERE id=:OFF;
INSERT INTO public.settings (key,value) VALUES ('org','{"companyName":"Shantaz","waApiKey":"SECRET-WA","report":{"language":"hi"}}')
  ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;

-- ── 1. shape ────────────────────────────────────────────────────────────────
SELECT pg_temp.chk('function exists and is SECURITY DEFINER',
  (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.save_org_setting(text,jsonb)')));
SELECT pg_temp.chk('anon has no EXECUTE', NOT has_function_privilege('anon', 'public.save_org_setting(text,jsonb)', 'EXECUTE'));
SELECT pg_temp.chk('authenticated has EXECUTE', has_function_privilege('authenticated', 'public.save_org_setting(text,jsonb)', 'EXECUTE'));
SELECT pg_temp.chk('settings policies still super-admin only for writes',
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='settings' AND cmd IN ('INSERT','UPDATE')
     AND coalesce(qual, with_check) = 'is_super_admin()') = 2);

-- ── 2. the bug: Admin direct table write is still refused ───────────────────
SELECT pg_temp.chk('Admin direct UPDATE of settings runs (RLS filters it to 0 rows)',
  pg_temp.as_user(:ADM, $q$UPDATE public.settings SET value = '{}' WHERE key='org'$q$) = '00000');
SELECT pg_temp.chk('Admin direct UPDATE changed nothing (the original bug: table is Super Admin only)',
  (SELECT value->>'waApiKey' FROM public.settings WHERE key='org') = 'SECRET-WA');

SELECT pg_temp.chk('Admin upsert (what saveSettings() sends) is refused with 42501',
  pg_temp.as_user(:ADM, $q$INSERT INTO public.settings (key, value) VALUES ('org', '{}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value$q$) LIKE '42501%');

-- ── 3. Admin may save the two keys ──────────────────────────────────────────
-- (call and read-back are separate statements: one statement sees one snapshot)
SELECT pg_temp.chk('Admin save_org_setting(report.master) succeeds',
  pg_temp.as_user(:ADM, $q$SELECT public.save_org_setting('report.master', '{"access":{"company":["Admin"]}}')$q$) = '00000');
SELECT pg_temp.chk('report.master stored',
  (SELECT value #> '{report,master,access,company}' FROM public.settings WHERE key='org') = '["Admin"]'::jsonb);
SELECT pg_temp.chk('report.master keeps the other report fields', (SELECT value #>> '{report,language}' FROM public.settings WHERE key='org') = 'hi');
SELECT pg_temp.chk('Admin save_org_setting(departmentHeads) succeeds',
  pg_temp.as_user(:ADM, $q$SELECT public.save_org_setting('departmentHeads', '{"Assembly":{"userId":null,"name":"Ram"}}')$q$) = '00000');
SELECT pg_temp.chk('departmentHeads stored',
  (SELECT value #>> '{departmentHeads,Assembly,name}' FROM public.settings WHERE key='org') = 'Ram');
SELECT pg_temp.chk('secret key and company name untouched by Admin saves',
  (SELECT value->>'waApiKey' = 'SECRET-WA' AND value->>'companyName' = 'Shantaz' FROM public.settings WHERE key='org'));
SELECT pg_temp.chk('Super Admin may also use it',
  pg_temp.as_user(:SA, $q$SELECT public.save_org_setting('departmentHeads', '{"Trial":{"userId":null,"name":"Sonu"}}')$q$) = '00000');
SELECT pg_temp.chk('Super Admin value stored',
  (SELECT value #>> '{departmentHeads,Trial,name}' FROM public.settings WHERE key='org') = 'Sonu');

-- ── 4. refusals ─────────────────────────────────────────────────────────────
SELECT pg_temp.chk('Admin refused for any other key (companyName)',
  pg_temp.as_user(:ADM, $q$SELECT public.save_org_setting('companyName', '{"x":1}')$q$) LIKE '22023%');
SELECT pg_temp.chk('Admin refused for waApiKey',
  pg_temp.as_user(:ADM, $q$SELECT public.save_org_setting('waApiKey', '{"x":1}')$q$) LIKE '22023%');
SELECT pg_temp.chk('Admin refused for report (whole) and enabledModules',
  pg_temp.as_user(:ADM, $q$SELECT public.save_org_setting('report', '{}')$q$) LIKE '22023%'
  AND pg_temp.as_user(:ADM, $q$SELECT public.save_org_setting('enabledModules', '{}')$q$) LIKE '22023%');
SELECT pg_temp.chk('non-object value refused',
  pg_temp.as_user(:ADM, $q$SELECT public.save_org_setting('departmentHeads', '"x"')$q$) LIKE '22023%'
  AND pg_temp.as_user(:ADM, $q$SELECT public.save_org_setting('departmentHeads', NULL)$q$) LIKE '22023%');
SELECT pg_temp.chk('Production user refused',
  pg_temp.as_user(:PRD, $q$SELECT public.save_org_setting('departmentHeads', '{}')$q$) LIKE '42501%');
SELECT pg_temp.chk('disabled Admin refused',
  pg_temp.as_user(:OFF, $q$SELECT public.save_org_setting('departmentHeads', '{}')$q$) LIKE '42501%');
SELECT pg_temp.chk('anon refused',
  pg_temp.as_user('', $q$SELECT public.save_org_setting('departmentHeads', '{}')$q$) LIKE '42501%');
SELECT pg_temp.chk('service role (no user) refused — only a signed-in Admin / Super Admin',
  (SELECT r LIKE '42501%' FROM (SELECT pg_temp.as_service($q$SELECT public.save_org_setting('departmentHeads', '{}')$q$) r) x));
SELECT pg_temp.chk('refusals changed nothing',
  (SELECT value #>> '{departmentHeads,Trial,name}' = 'Sonu' AND value->>'companyName' = 'Shantaz' FROM public.settings WHERE key='org'));

SELECT CASE WHEN count(*) FILTER (WHERE NOT ok) = 0 THEN 'PASSED ' ELSE 'FAILED ' END || count(*) FILTER (WHERE ok) || '/' || count(*) FROM t_results;
