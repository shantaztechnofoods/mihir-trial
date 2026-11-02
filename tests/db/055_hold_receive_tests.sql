-- Role-based tests for migration 055 (manual ON HOLD + department receiving). Runs against erp_test built with 001..055.
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

-- ── fixtures ────────────────────────────────────────────────────────────────
\set SA   '''a0000000-0000-0000-0000-000000000001'''
\set ADM  '''a0000000-0000-0000-0000-000000000002'''
\set ASM  '''a0000000-0000-0000-0000-000000000003'''
\set MEC  '''a0000000-0000-0000-0000-000000000004'''
\set DIS  '''a0000000-0000-0000-0000-000000000006'''
\set STO  '''a0000000-0000-0000-0000-000000000007'''
\set PH   '''a0000000-0000-0000-0000-000000000005'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ADM,'adm@t'),(:ASM,'asm@t'),(:MEC,'mec@t'),(:DIS,'dis@t'),(:STO,'sto@t'),(:PH,'ph@t');
UPDATE public.users SET role_key='super_admin', status='active', departments='{}' WHERE id=:SA;
UPDATE public.users SET role_key='Admin', status='active', departments='{}' WHERE id=:ADM;
UPDATE public.users SET role_key='Production', status='active', departments='{Assembly}' WHERE id=:ASM;
UPDATE public.users SET role_key='Production', status='active', departments='{Mechanical}' WHERE id=:MEC;
UPDATE public.users SET role_key='Production', status='disabled', departments='{Assembly}' WHERE id=:DIS;
UPDATE public.users SET role_key='Store Manager', status='active', departments='{Stores}' WHERE id=:STO;
UPDATE public.users SET role_key='Production Head', status='active', departments='{}' WHERE id=:PH;
INSERT INTO public.items (code,name,category,unit,stock,min_stock) VALUES ('GBX-T','Gearbox T','Mech','Nos',10,1);
INSERT INTO public.machine_log (id,issue_id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department)
 VALUES (101,NULL,'M-10','Kneading','SN-A1','Assembly','active',current_date,'[]','Assembly');
INSERT INTO public.pending_handover_items (id,machine_id,raised_in_department,assigned_department,description,kind,item_code,item_name,qty,critical,source,raised_by)
 VALUES (1,101,'Assembly','Assembly','Assembly part','owed','GBX-T','Gearbox T',10,false,'bom_outward',:SA),
        (2,101,'Assembly','Mechanical','Mechanical part','owed','GBX-T','Gearbox T',10,false,'bom_outward',:SA),
        (3,101,'Assembly','Stores','Stores part','owed','GBX-T','Gearbox T',10,false,'bom_outward',:SA),
        (4,101,'Assembly','Electrical','Electrical part','owed','GBX-T','Gearbox T',10,false,'bom_outward',:SA);

-- ── department-aware receiving ──────────────────────────────────────────────
SELECT pg_temp.as_user(:ASM, 'SELECT public.receive_pending_part(1, 4)') AS a1 \gset
SELECT pg_temp.chk('department staff receives (partly) a job assigned to their department', :'a1' = '00000' AND (SELECT stock=14 FROM public.items WHERE code='GBX-T'));
SELECT pg_temp.as_user(:ASM, 'SELECT public.receive_pending_part(1, 6)') AS a2 \gset
SELECT pg_temp.chk('same staff can finish the remainder (partial receiving kept)', :'a2' = '00000' AND (SELECT received_qty=10 FROM public.pending_handover_items WHERE id=1) AND (SELECT stock=20 FROM public.items WHERE code='GBX-T'));
SELECT pg_temp.chk('over-receipt still refused', pg_temp.as_user(:ASM, 'SELECT public.receive_pending_part(1, 1)') IS NOT NULL AND pg_temp.as_user(:ASM, 'SELECT public.receive_pending_part(1, 1)') <> '00000');
SELECT pg_temp.chk('Mechanical staff cannot receive a Stores job on an Assembly machine', pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(3, 1)') LIKE '42501%');
SELECT pg_temp.chk('staff may receive a job on a machine that is currently in their department', pg_temp.as_user(:ASM, 'SELECT public.receive_pending_part(4, 1)') = '00000');
SELECT pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(2, 3)') AS a3 \gset
SELECT pg_temp.chk('Mechanical staff receives their own job (not only when the machine is theirs)', :'a3' = '00000' AND (SELECT stock=24 FROM public.items WHERE code='GBX-T'));
UPDATE public.machine_log SET current_department='Trial' WHERE id=101;
SELECT pg_temp.chk('once the machine moved on, an unrelated department is refused', pg_temp.as_user(:ASM, 'SELECT public.receive_pending_part(2, 1)') LIKE '42501%');
SELECT pg_temp.chk('Admin receives any department''s job', pg_temp.as_user(:ADM, 'SELECT public.receive_pending_part(4, 2)') = '00000');
SELECT pg_temp.chk('super admin receives any job', pg_temp.as_user(:SA, 'SELECT public.receive_pending_part(2, 1)') = '00000');
SELECT pg_temp.chk('Store Manager receives a Stores job', pg_temp.as_user(:STO, 'SELECT public.receive_pending_part(3, 2)') = '00000');
SELECT pg_temp.chk('Store Manager cannot receive a Mechanical job', pg_temp.as_user(:STO, 'SELECT public.receive_pending_part(2, 1)') LIKE '42501%');
SELECT pg_temp.chk('Production Head (release-only role, no Finish & Transfer) still cannot receive', pg_temp.as_user(:PH, 'SELECT public.receive_pending_part(4, 1)') LIKE '42501%');
SELECT pg_temp.chk('disabled user and anon refused', pg_temp.as_user(:DIS, 'SELECT public.receive_pending_part(4, 1)') LIKE '42501%' AND pg_temp.as_user('', 'SELECT public.receive_pending_part(4, 1)') LIKE '42501%');
SELECT pg_temp.chk('every accepted receipt moved exactly its quantity into stock (10+4+6+1+3+2+1+2 = 29; refused calls moved nothing)', (SELECT stock=29 FROM public.items WHERE code='GBX-T') );
UPDATE public.machine_log SET current_department='Assembly' WHERE id=101;

-- ── manual ON HOLD ──────────────────────────────────────────────────────────
SELECT pg_temp.chk('hold columns default to off', (SELECT NOT hold_active AND hold_reason IS NULL FROM public.machine_log WHERE id=101));
SELECT pg_temp.chk('hold needs a reason', pg_temp.as_user(:ASM, 'UPDATE public.machine_log SET hold_active=true WHERE id=101') LIKE '22023%');
SELECT pg_temp.as_user(:ASM, format($q$UPDATE public.machine_log SET hold_active=true, hold_reason='waiting for motor', hold_by=%L, hold_at='2000-01-01' WHERE id=101$q$, :SA)) AS h1 \gset
SELECT pg_temp.chk('hold with reason works and records the real user + time (spoof ignored)',
  :'h1' = '00000' AND (SELECT hold_active AND hold_by=:ASM AND hold_at > now() - interval '1 minute' FROM public.machine_log WHERE id=101));
SELECT pg_temp.chk('already-held machine cannot be held again', pg_temp.as_user(:ASM, $q$UPDATE public.machine_log SET hold_active=true, hold_reason='x' WHERE id=101$q$) LIKE '55000%');
INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
 SELECT 101,'M-10','SN-A1','Assembly','Mechanical',:SA,now(),10,10,'pending',30,false WHERE false;
SELECT pg_temp.chk('no new hand-over can be sent while on hold',
  pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required) VALUES (101,'M-10','SN-A1','Assembly','Mechanical',%L,now(),10,10,'pending',30,false)$q$, :ASM)) LIKE '55000%');
SELECT pg_temp.as_user(:MEC, $q$UPDATE public.machine_log SET hold_active=false WHERE id=101$q$) AS r1 \gset
SELECT pg_temp.chk('release works for a permitted user', :'r1' = '00000' AND (SELECT NOT hold_active FROM public.machine_log WHERE id=101));
SELECT pg_temp.chk('hand-over can be sent after release',
  pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required) VALUES (101,'M-10','SN-A1','Assembly','Mechanical',%L,now(),10,10,'pending',30,false)$q$, :ASM)) = '00000');
SELECT pg_temp.as_user(:ADM, $q$UPDATE public.machine_log SET hold_active=true, hold_reason='quality check' WHERE id=101$q$) AS h2 \gset
SELECT pg_temp.chk('Admin can hold too', :'h2' = '00000');
SELECT pg_temp.chk('a pending hand-over cannot be accepted while on hold',
  pg_temp.as_user(:MEC, $q$UPDATE public.handover_events SET status='accepted', accepted_by=auth.uid(), accepted_at=now() WHERE machine_id=101 AND status='pending'$q$) LIKE '55000%');
SELECT pg_temp.as_user(:DIS, 'UPDATE public.machine_log SET hold_active=false WHERE id=101') AS d1 \gset
SELECT pg_temp.as_user('', 'UPDATE public.machine_log SET hold_active=false WHERE id=101') AS d2 \gset
SELECT pg_temp.chk('disabled user / anon cannot release (still on hold afterwards)', (SELECT hold_active FROM public.machine_log WHERE id=101));
SELECT pg_temp.chk('Admin releases', pg_temp.as_user(:ADM, 'UPDATE public.machine_log SET hold_active=false WHERE id=101') = '00000');

-- ── Finish & Transfer: empty worker list + signed-in main employee ──────────
INSERT INTO public.machine_log (id,issue_id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES (102,NULL,'M-10','Kneading','SN-A2','Assembly','active',current_date,'[]','Assembly');
SELECT pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required,worked_by,main_employee_id)
  VALUES (102,'M-10','SN-A2','Assembly','Mechanical',%L,now(),10,10,'pending',30,false,'{}',%L)$q$, :ASM, :ASM)) AS w1 \gset
SELECT pg_temp.chk('worked_by {} + main employee violates handover_main_in_worked (the old payload)', :'w1' LIKE '23514%');
SELECT pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required,worked_by,main_employee_id)
  VALUES (102,'M-10','SN-A2','Assembly','Mechanical',%L,now(),10,10,'pending',30,false,NULL,%L)$q$, :ASM, :ASM)) AS w2 \gset
SELECT pg_temp.chk('worked_by NULL + main employee is accepted (the fixed payload)', :'w2' = '00000');

SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
