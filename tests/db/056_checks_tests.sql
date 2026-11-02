-- Role-based tests for migration 056 (critical check points on pending items). Runs against erp_test built with 001..056.
-- Each check prints PASS/FAIL; the final line counts failures.
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on

CREATE TEMP TABLE t_results (name text, ok boolean);
CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_ok,false));
      RAISE NOTICE '%  %', CASE WHEN coalesce(p_ok,false) THEN 'PASS' ELSE 'FAIL' END, p_name; END $$;
-- run a statement as a user; returns the SQLSTATE ('00000' on success)
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_uid = '' THEN 'anon' ELSE 'authenticated' END, true);
  IF p_uid = '' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
  BEGIN EXECUTE p_sql; v := '00000';
  EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;
-- same but returns the scalar result of a query
CREATE OR REPLACE FUNCTION pg_temp.q_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_uid = '' THEN 'anon' ELSE 'authenticated' END, true);
  IF p_uid = '' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
  BEGIN EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN v := 'ERR ' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;

\set ASM  '''a0000000-0000-0000-0000-000000000003'''
\set SA   '''a0000000-0000-0000-0000-000000000001'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ASM,'asm@t');
UPDATE public.users SET role_key='super_admin', status='active', departments='{}' WHERE id=:SA;
UPDATE public.users SET role_key='Production', status='active', departments='{Assembly}' WHERE id=:ASM;
INSERT INTO public.machine_log (id,issue_id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department)
 VALUES (101,NULL,'M-10','Kneading','SN-A1','Assembly','active',current_date,'[]','Assembly');
SELECT pg_temp.as_user(:ASM, $q$INSERT INTO public.pending_handover_items (id,machine_id,raised_in_department,assigned_department,description,kind,item_name,qty,critical,source,critical_checks,raised_by)
  VALUES (1,101,'Stores','Stores','Gearbox','owed','Gearbox',1,true,'bom_outward','{"points":[{"text":"Nameplate","ok":true},{"text":"Damage","ok":false}]}','a0000000-0000-0000-0000-000000000003')$q$) AS i1 \gset
SELECT pg_temp.chk('staff can save a pending item with check points', :'i1' = '00000' AND (SELECT jsonb_array_length(critical_checks->'points')=2 FROM public.pending_handover_items WHERE id=1));
SELECT pg_temp.chk('existing rows default to NULL', (SELECT count(*)=0 FROM public.pending_handover_items WHERE id<>1 AND critical_checks IS NOT NULL));
SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
