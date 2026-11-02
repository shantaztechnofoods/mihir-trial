-- Role-based tests for migration 057 (accept signature columns). Runs against erp_test built with 001..057.
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
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE p_sql; v := '00000';
  EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.q_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN v := 'ERR ' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;

\set ASM '''a0000000-0000-0000-0000-000000000003'''
\set MEC '''a0000000-0000-0000-0000-000000000004'''
INSERT INTO auth.users (id, email) VALUES (:ASM,'asm@t'),(:MEC,'mec@t');
UPDATE public.users SET role_key='Production', status='active', departments='{Assembly}' WHERE id=:ASM;
UPDATE public.users SET role_key='Production', status='active', departments='{Mechanical}' WHERE id=:MEC;
INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES (301,'M-10','Kneading','SN-S1','Assembly','active',current_date,'[]','Assembly');
SELECT pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
  VALUES (301,'M-10','SN-S1','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :ASM));

SELECT pg_temp.chk('columns exist', (SELECT count(*)=3 FROM information_schema.columns WHERE table_name='handover_events' AND column_name IN ('accepted_signature_svg','accepted_by_name','accepted_in_department')));
SELECT pg_temp.chk('accept may not rewrite other columns (still blocked)', pg_temp.as_user(:MEC,
  format($q$UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now(),accepted_signature_svg='<svg/>',overrun_narration='tampered' WHERE machine_id=301 AND status='pending'$q$, :MEC)) LIKE '42501%');
SELECT pg_temp.chk('accept with signature, name and team is allowed', pg_temp.q_user(:MEC,
  format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now(),accepted_signature_svg='<svg>sig</svg>',accepted_by_name='Samir',accepted_in_department='Hacked',accepted_by_team_snapshot='[{"name":"Samir"}]' WHERE machine_id=301 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$, :MEC)) = '1');
SELECT pg_temp.chk('signature stored', (SELECT accepted_signature_svg='<svg>sig</svg>' AND accepted_by_name='Samir' FROM public.handover_events WHERE machine_id=301));
SELECT pg_temp.chk('department is stamped by the database, not the client', (SELECT accepted_in_department='Mechanical' FROM public.handover_events WHERE machine_id=301));
SELECT pg_temp.chk('accepted signature is immutable', pg_temp.q_user(:MEC, $q$WITH u AS (UPDATE public.handover_events SET accepted_signature_svg='<svg>other</svg>' WHERE machine_id=301 RETURNING id) SELECT count(*)::text FROM u$q$) IN ('0','ERR 42501'));
SELECT pg_temp.chk('signature unchanged after tamper attempt', (SELECT accepted_signature_svg='<svg>sig</svg>' FROM public.handover_events WHERE machine_id=301));
SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
