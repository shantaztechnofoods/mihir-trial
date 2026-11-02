-- Tests for migration 059: service-role profile upsert (user creation) + Department Staff role.
-- Runs against erp_test built with 001..059. Covers all four departments, Admin, Production, Super Admin.
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
CREATE TEMP TABLE t_results (name text, ok boolean);
CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_ok,false));
      RAISE NOTICE '%  %', CASE WHEN coalesce(p_ok,false) THEN 'PASS' ELSE 'FAIL' END, p_name; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true); PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE p_sql; v := '00000'; EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.q_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true); PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE p_sql INTO v; EXCEPTION WHEN OTHERS THEN v := 'ERR ' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;
-- What the admin-create-user Edge Function does: PostgREST with the service-role key. Newer PostgREST
-- publishes ONLY request.jwt.claims (JSON) and the connection role is service_role.
CREATE OR REPLACE FUNCTION pg_temp.as_service(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  BEGIN EXECUTE p_sql; v := '00000'; EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $$;

\set SA  '''b0000000-0000-0000-0000-000000000001'''
\set ADM '''b0000000-0000-0000-0000-000000000002'''
\set PRD '''b0000000-0000-0000-0000-000000000003'''
\set U_A '''b0000000-0000-0000-0000-0000000000a1'''
\set U_M '''b0000000-0000-0000-0000-0000000000a2'''
\set U_E '''b0000000-0000-0000-0000-0000000000a3'''
\set U_T '''b0000000-0000-0000-0000-0000000000a4'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ADM,'adm@t'),(:PRD,'prd@t');
UPDATE public.users SET role_key='super_admin', status='active' WHERE id=:SA;
UPDATE public.users SET role_key='Admin', status='active' WHERE id=:ADM;
UPDATE public.users SET role_key='Production', status='active', departments='{Mechanical}' WHERE id=:PRD;

SELECT pg_temp.chk('role dept_staff exists as "Department Staff"', (SELECT label='Department Staff' FROM public.roles WHERE key='dept_staff'));
SELECT pg_temp.chk('dept_staff is not an admin/production role: no BOM issue, no users/roles, no stage skipping',
  (SELECT NOT (actions#>>'{outward,bom}')::bool AND NOT (actions#>>'{users,create}')::bool AND NOT (actions#>>'{machines,updateStage}')::bool
          AND NOT (actions#>>'{machines,configDept}')::bool AND NOT (actions#>>'{inventory,add}')::bool FROM public.roles WHERE key='dept_staff'));
SELECT pg_temp.chk('Production role unchanged (still issues BOMs)', (SELECT (actions#>>'{outward,bom}')::bool FROM public.roles WHERE key='Production'));
SELECT pg_temp.chk('Admin role unchanged (still manages users)', (SELECT (actions#>>'{users,create}')::bool IS NOT FALSE FROM public.roles WHERE key='Admin'));

-- Create one login per department the way the Edge Function does: auth user (trigger makes a locked profile), then the profile upsert.
INSERT INTO auth.users (id, email) VALUES (:U_A,'stf_assembly@users.shantaz.local'),(:U_M,'stf_mech@users.shantaz.local'),(:U_E,'stf_elec@users.shantaz.local'),(:U_T,'stf_trial@users.shantaz.local');
SELECT pg_temp.chk('new auth user starts locked (no_access / disabled)', (SELECT count(*)=4 FROM public.users WHERE id IN (:U_A,:U_M,:U_E,:U_T) AND role_key='no_access' AND status='disabled'));
SELECT pg_temp.chk('service-role profile upsert (Assembly) succeeds', pg_temp.as_service(format($q$INSERT INTO public.users(id,username,full_name,role_key,status,departments) VALUES (%L,'stf_assembly','stf_assembly','dept_staff','active','{Assembly}') ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, role_key=EXCLUDED.role_key, status=EXCLUDED.status, departments=EXCLUDED.departments$q$, :U_A)) = '00000');
SELECT pg_temp.chk('service-role profile upsert (Mechanical) succeeds', pg_temp.as_service(format($q$INSERT INTO public.users(id,username,full_name,role_key,status,departments) VALUES (%L,'stf_mech','stf_mech','dept_staff','active','{Mechanical}') ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, role_key=EXCLUDED.role_key, status=EXCLUDED.status, departments=EXCLUDED.departments$q$, :U_M)) = '00000');
SELECT pg_temp.chk('service-role profile upsert (Electrical) succeeds', pg_temp.as_service(format($q$INSERT INTO public.users(id,username,full_name,role_key,status,departments) VALUES (%L,'stf_elec','stf_elec','dept_staff','active','{Electrical}') ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, role_key=EXCLUDED.role_key, status=EXCLUDED.status, departments=EXCLUDED.departments$q$, :U_E)) = '00000');
SELECT pg_temp.chk('service-role profile upsert (Trial) succeeds', pg_temp.as_service(format($q$INSERT INTO public.users(id,username,full_name,role_key,status,departments) VALUES (%L,'stf_trial','stf_trial','dept_staff','active','{Trial}') ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, role_key=EXCLUDED.role_key, status=EXCLUDED.status, departments=EXCLUDED.departments$q$, :U_T)) = '00000');
SELECT pg_temp.chk('all four saved with role dept_staff, active and their own department',
  (SELECT count(*)=4 AND bool_and(role_key='dept_staff' AND status='active') FROM public.users WHERE id IN (:U_A,:U_M,:U_E,:U_T))
  AND (SELECT departments='{Assembly}' FROM public.users WHERE id=:U_A) AND (SELECT departments='{Mechanical}' FROM public.users WHERE id=:U_M)
  AND (SELECT departments='{Electrical}' FROM public.users WHERE id=:U_E) AND (SELECT departments='{Trial}' FROM public.users WHERE id=:U_T));

-- An ordinary user still cannot do what only the service role / super admin can.
SELECT pg_temp.chk('an ordinary user cannot make themselves super admin', pg_temp.as_user(:U_A, format($q$UPDATE public.users SET role_key='super_admin' WHERE id=%L$q$, :U_A)) <> '00000');
SELECT pg_temp.chk('an ordinary user cannot change their own role', pg_temp.as_user(:U_A, format($q$UPDATE public.users SET role_key='Admin' WHERE id=%L$q$, :U_A)) <> '00000');
SELECT pg_temp.chk('an ordinary user cannot change their own department', pg_temp.as_user(:U_A, format($q$UPDATE public.users SET departments='{Mechanical}' WHERE id=%L$q$, :U_A)) <> '00000');
SELECT pg_temp.chk('an ordinary user cannot re-enable themselves / change status', pg_temp.as_user(:U_A, format($q$UPDATE public.users SET status='disabled' WHERE id=%L$q$, :U_A)) <> '00000');
SELECT pg_temp.chk('an ordinary user cannot create a login', pg_temp.as_user(:U_A, format($q$INSERT INTO public.users(id,username,role_key) VALUES (gen_random_uuid(),'sneaky','Admin')$q$)) <> '00000');
SELECT pg_temp.as_user(:U_A, format($q$UPDATE public.users SET departments='{Assembly}' WHERE id=%L$q$, :U_M));
SELECT pg_temp.chk('an ordinary user cannot touch another user''s department (row not even visible to update)', (SELECT departments='{Mechanical}' FROM public.users WHERE id=:U_M));
SELECT pg_temp.chk('stored role/department still intact after those attempts',
  (SELECT role_key='dept_staff' AND departments='{Assembly}' FROM public.users WHERE id=:U_A));

-- Permissions each department login actually gets.
SELECT pg_temp.chk('dept staff: can Accept + Finish & Transfer', pg_temp.q_user(:U_A, $q$SELECT (has_permission('machines','accept') AND has_permission('machines','finishTransfer'))::text$q$) = 'true');
SELECT pg_temp.chk('dept staff: cannot skip stages, issue BOMs, receive stock or manage users',
  pg_temp.q_user(:U_E, $q$SELECT (NOT has_permission('machines','updateStage') AND NOT has_permission('outward','bom') AND NOT has_permission('inward','submit') AND NOT has_permission('users','create') AND NOT has_permission('machines','release'))::text$q$) = 'true');
SELECT pg_temp.chk('dept staff: not unscoped (department filter applies)', pg_temp.q_user(:U_T, 'SELECT dept_unscoped()::text') = 'false');
SELECT pg_temp.chk('each department login sees exactly its own department',
  pg_temp.q_user(:U_A,'SELECT my_departments()::text')='{Assembly}' AND pg_temp.q_user(:U_M,'SELECT my_departments()::text')='{Mechanical}'
  AND pg_temp.q_user(:U_E,'SELECT my_departments()::text')='{Electrical}' AND pg_temp.q_user(:U_T,'SELECT my_departments()::text')='{Trial}');
SELECT pg_temp.chk('Admin and Super Admin stay unscoped; Production keeps its department',
  pg_temp.q_user(:ADM,'SELECT dept_unscoped()::text')='true' AND pg_temp.q_user(:SA,'SELECT dept_unscoped()::text')='true'
  AND pg_temp.q_user(:PRD,'SELECT my_departments()::text')='{Mechanical}' AND pg_temp.q_user(:PRD,'SELECT has_permission(''outward'',''bom'')::text')='true');
SELECT pg_temp.as_user(:SA, format($q$UPDATE public.users SET departments='{Trial}' WHERE id=%L$q$, :U_A)) AS sa_res \gset
SELECT pg_temp.chk('super admin can still re-assign a department (' || :'sa_res' || ')', :'sa_res'='00000' AND (SELECT departments='{Trial}' FROM public.users WHERE id=:U_A));

SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
