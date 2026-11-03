-- Tests for migration 060: service-role profile upsert (user creation) + Department Staff role.
-- Runs against erp_test built with 001..060.
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
\set DIS '''b0000000-0000-0000-0000-000000000004'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ADM,'adm@t'),(:PRD,'prd@t'),(:DIS,'dis@t');
UPDATE public.users SET role_key='super_admin', status='active' WHERE id=:SA;
UPDATE public.users SET role_key='Admin', status='active' WHERE id=:ADM;
UPDATE public.users SET role_key='Production', status='active', departments='{Mechanical}' WHERE id=:PRD;
UPDATE public.users SET role_key='super_admin', status='disabled' WHERE id=:DIS;

INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES
 (301,'M-10','K','SN-301','Assembly','active',current_date,'[]','Assembly'),   -- active build
 (302,'M-10','K','SN-302','Ready','active',current_date,'[]','Ready'),          -- ready machine
 (303,'M-15','K','SN-303','Mechanical','active',current_date,'[]','Mechanical'),-- bystander
 (304,'M-20','K','SN-304','Electrical','active',current_date,'[]','Electrical');-- second bystander
INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
 VALUES (301,'M-10','SN-301','Assembly','Mechanical',:SA,now(),0,0,'pending',0,false),(303,'M-15','SN-303','Assembly','Mechanical',:SA,now(),0,0,'pending',0,false);
CREATE TEMP TABLE before_cnt AS SELECT (SELECT count(*) FROM public.items) i, (SELECT count(*) FROM public.stock_movements) sm, (SELECT count(*) FROM public.users) u, (SELECT count(*) FROM public.bom_definitions) b, (SELECT count(*) FROM public.outward_log) o;

SELECT pg_temp.chk('anon key cannot call it', (SELECT has_function_privilege('anon','public.delete_machine_super_admin(bigint,text)','EXECUTE'))=false);
SELECT pg_temp.chk('Admin is refused (42501)', pg_temp.as_user(:ADM,'SELECT public.delete_machine_super_admin(301)') LIKE '42501%');
SELECT pg_temp.chk('Production (Assembly/Mechanical) user is refused', pg_temp.as_user(:PRD,'SELECT public.delete_machine_super_admin(301)') LIKE '42501%');
SELECT pg_temp.chk('disabled super admin is refused', pg_temp.as_user(:DIS,'SELECT public.delete_machine_super_admin(301)') LIKE '42501%');
SELECT pg_temp.chk('a service-role / no-user caller is refused', pg_temp.as_service('SELECT public.delete_machine_super_admin(301)') LIKE '42501%');
SELECT pg_temp.chk('direct DELETE is refused for Admin (no rows deleted)', (pg_temp.as_user(:ADM,'DELETE FROM public.machine_log WHERE id=301'), (SELECT count(*) FROM public.machine_log WHERE id=301))::text LIKE '%,1)');
SELECT pg_temp.chk('direct DELETE is refused even for Super Admin (only the function deletes)', (SELECT count(*) FROM public.machine_log WHERE id=301)=1 AND pg_temp.as_user(:SA,'DELETE FROM public.machine_log WHERE id=301')='00000' AND (SELECT count(*) FROM public.machine_log WHERE id=301)=1);
SELECT pg_temp.chk('all four machines still present after refused attempts', (SELECT count(*)=4 FROM public.machine_log WHERE id BETWEEN 301 AND 304));
SELECT pg_temp.chk('refused attempts wrote no machine_deleted audit row', (SELECT count(*)=0 FROM public.audit_log WHERE type='machine_deleted'));

SELECT pg_temp.chk('unknown machine id -> error, nothing changes', pg_temp.as_user(:SA,'SELECT public.delete_machine_super_admin(99999)') LIKE '%P0002%' OR pg_temp.as_user(:SA,'SELECT public.delete_machine_super_admin(99999)') LIKE 'P0002%');
SELECT pg_temp.as_user(:SA, 'SELECT public.delete_machine_super_admin(301, ''test'')') AS r1 \gset
SELECT pg_temp.chk('Super Admin deletes the Active Build (' || :'r1' || ')', :'r1'='00000' AND (SELECT count(*)=0 FROM public.machine_log WHERE id=301));
SELECT pg_temp.as_user(:SA, 'SELECT public.delete_machine_super_admin(302)') AS r2 \gset
SELECT pg_temp.chk('Super Admin deletes the Ready machine (' || :'r2' || ')', :'r2'='00000' AND (SELECT count(*)=0 FROM public.machine_log WHERE id=302));
SELECT pg_temp.chk('its linked hand-over rows are gone with it', (SELECT count(*)=0 FROM public.handover_events WHERE machine_id=301));
SELECT pg_temp.chk('bystander machines and their hand-over rows are untouched', (SELECT count(*)=2 FROM public.machine_log WHERE id IN (303,304)) AND (SELECT count(*)=1 FROM public.handover_events WHERE machine_id=303));
SELECT pg_temp.chk('two audit rows: who, which machine, snapshot kept',
  (SELECT count(*)=2 AND bool_and(user_role='super_admin' AND old_value IS NOT NULL AND serial_no IS NOT NULL AND (details->>'machine_id') IS NOT NULL) FROM public.audit_log WHERE type='machine_deleted')
  AND (SELECT old_value->>'stage' FROM public.audit_log WHERE type='machine_deleted' AND serial_no='SN-302')='Ready'
  AND (SELECT (details->'linked_records_removed'->>'handover_events')::int FROM public.audit_log WHERE type='machine_deleted' AND serial_no='SN-301')=1);
SELECT pg_temp.chk('items, stock movements, users, BOMs and outward log unchanged',
  (SELECT i=(SELECT count(*) FROM public.items) AND sm=(SELECT count(*) FROM public.stock_movements) AND u=(SELECT count(*) FROM public.users) AND b=(SELECT count(*) FROM public.bom_definitions) AND o=(SELECT count(*) FROM public.outward_log) FROM before_cnt));
SELECT pg_temp.chk('audit log stays append-only (cannot be deleted)', pg_temp.as_user(:SA,'DELETE FROM public.audit_log') <> '00000' OR (SELECT count(*)=2 FROM public.audit_log WHERE type='machine_deleted'));

SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
