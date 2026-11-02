-- Role-based tests for migration 058 (department-level authorization). Runs against erp_test built with 001..058.
-- Two floor users from different departments, a user with NO department, Admin, Production Head and a Super Admin.
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

\set SA  '''a0000000-0000-0000-0000-000000000001'''
\set ADM '''a0000000-0000-0000-0000-000000000002'''
\set ASM '''a0000000-0000-0000-0000-000000000003'''
\set MEC '''a0000000-0000-0000-0000-000000000004'''
\set PH  '''a0000000-0000-0000-0000-000000000005'''
\set ELE '''a0000000-0000-0000-0000-000000000008'''
\set NOD '''a0000000-0000-0000-0000-000000000009'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ADM,'adm@t'),(:ASM,'asm@t'),(:MEC,'mec@t'),(:PH,'ph@t'),(:ELE,'ele@t'),(:NOD,'nod@t');
UPDATE public.users SET role_key='super_admin', status='active', departments='{}' WHERE id=:SA;
UPDATE public.users SET role_key='Admin', status='active', departments='{}' WHERE id=:ADM;
UPDATE public.users SET role_key='Production', status='active', departments='{Assembly}' WHERE id=:ASM;
UPDATE public.users SET role_key='Production', status='active', departments='{Mechanical}' WHERE id=:MEC;
UPDATE public.users SET role_key='Production', status='active', departments='{Electrical}' WHERE id=:ELE;
UPDATE public.users SET role_key='Production', status='active', departments='{}' WHERE id=:NOD;
UPDATE public.users SET role_key='Production Head', status='active', departments='{}' WHERE id=:PH;

-- machine 201: Assembly, waiting to be accepted by Mechanical; 202: Electrical; 203: Mechanical (came from Assembly); 204: Assembly
INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES
 (201,'M-10','K','SN-201','Assembly','active',current_date,'[]','Assembly'),
 (202,'M-10','K','SN-202','Electrical','active',current_date,'[]','Electrical'),
 (203,'M-10','K','SN-203','Mechanical','active',current_date,'[]','Mechanical'),
 (204,'M-10','K','SN-204','Assembly','active',current_date,'[]','Assembly');
INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
 VALUES (201,'M-10','SN-201','Assembly','Mechanical',:ASM,now(),60,50,'pending',120,false);
INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,accepted_by,accepted_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
 VALUES (203,'M-10','SN-203','Assembly','Mechanical',:ASM,now(),:MEC,now(),60,50,'accepted',120,false);
UPDATE public.machine_log SET pending_handover_id=(SELECT id FROM public.handover_events WHERE machine_id=201) WHERE id=201;
INSERT INTO public.pending_handover_items (id,machine_id,description,kind,status,assigned_department,raised_in_department,raised_by,qty,item_name)
 VALUES (1,201,'Gearbox','owed','open','Mechanical','Assembly',:ASM,10,'Gearbox'),
        (2,202,'Wire lamp','owed','open','Electrical','Assembly',:ASM,NULL,NULL),
        (3,203,'Fit cover','owed','open','Mechanical','Assembly',:ASM,NULL,NULL);
INSERT INTO public.audit_log (user_id,user_name,user_role,type,module,action) VALUES (:MEC,'mec','Production','t','m','mec did x'),(:ELE,'ele','Production','t','m','ele did y');
SELECT setval(pg_get_serial_sequence('public.pending_handover_items','id'), 50);

-- ── 1. visibility: each department sees only its own ─────────────────────────
\set CNT_M 'SELECT count(*)::text FROM public.machine_log WHERE id BETWEEN 201 AND 204'
SELECT pg_temp.chk('Assembly user sees 201, 203 (sent on), 204 — not Electrical 202', pg_temp.q_user(:ASM, 'SELECT string_agg(id::text, '','' ORDER BY id) FROM public.machine_log WHERE id BETWEEN 201 AND 204') = '201,203,204');
SELECT pg_temp.chk('Mechanical user sees 201 (waiting for it), 203 — not 202/204', pg_temp.q_user(:MEC, 'SELECT string_agg(id::text, '','' ORDER BY id) FROM public.machine_log WHERE id BETWEEN 201 AND 204') = '201,203');
SELECT pg_temp.chk('Electrical user sees only 202', pg_temp.q_user(:ELE, 'SELECT string_agg(id::text, '','' ORDER BY id) FROM public.machine_log WHERE id BETWEEN 201 AND 204') = '202');
SELECT pg_temp.chk('user with NO department sees nothing', pg_temp.q_user(:NOD, :'CNT_M') = '0');
SELECT pg_temp.chk('Super Admin, Admin and Production Head keep full visibility', pg_temp.q_user(:SA, :'CNT_M') = '4' AND pg_temp.q_user(:ADM, :'CNT_M') = '4' AND pg_temp.q_user(:PH, :'CNT_M') = '4');
SELECT pg_temp.chk('Electrical cannot read Mechanical hand-overs', pg_temp.q_user(:ELE, 'SELECT count(*)::text FROM public.handover_events') = '0');
SELECT pg_temp.chk('Mechanical sees hand-overs into it (2)', pg_temp.q_user(:MEC, 'SELECT count(*)::text FROM public.handover_events') = '2');
SELECT pg_temp.chk('Mechanical sees its jobs (1,3) not Electrical''s', pg_temp.q_user(:MEC, 'SELECT string_agg(id::text, '','' ORDER BY id) FROM public.pending_handover_items WHERE id < 10') = '1,3');
SELECT pg_temp.chk('Electrical sees its job only (2)', pg_temp.q_user(:ELE, 'SELECT string_agg(id::text, '','' ORDER BY id) FROM public.pending_handover_items WHERE id < 10') = '2');
SELECT pg_temp.chk('Super Admin sees all 3 jobs', pg_temp.q_user(:SA, 'SELECT count(*)::text FROM public.pending_handover_items WHERE id < 10') = '3');
SELECT pg_temp.chk('audit log: staff see only their own entries; super admin sees all', pg_temp.q_user(:MEC, 'SELECT count(*)::text FROM public.audit_log WHERE type=''t''') = '1' AND pg_temp.q_user(:SA, 'SELECT count(*)::text FROM public.audit_log WHERE type=''t''') = '2');

-- ── 2. Accept: only into your own department ─────────────────────────────────
SELECT pg_temp.chk('Electrical cannot accept a hand-over into Mechanical (direct API)', pg_temp.q_user(:ELE, format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=201 RETURNING id) SELECT count(*)::text FROM u$q$, :ELE)) = '0');
SELECT pg_temp.chk('Assembly (sender) cannot accept its own hand-over into Mechanical', pg_temp.q_user(:ASM, format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=201 RETURNING id) SELECT count(*)::text FROM u$q$, :ASM)) IN ('0','ERR 42501'));
SELECT pg_temp.chk('user with no department cannot accept', pg_temp.q_user(:NOD, format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=201 RETURNING id) SELECT count(*)::text FROM u$q$, :NOD)) = '0');
SELECT pg_temp.chk('hand-over still pending after the refused attempts', (SELECT status='pending' FROM public.handover_events WHERE machine_id=201));
SELECT pg_temp.chk('Electrical cannot move machine 201 (not its department)', pg_temp.q_user(:ELE, $q$WITH u AS (UPDATE public.machine_log SET stage='Electrical',current_department='Electrical' WHERE id=201 RETURNING id) SELECT count(*)::text FROM u$q$) IN ('0','ERR 42501'));
SELECT pg_temp.chk('Mechanical accepts into Mechanical', pg_temp.q_user(:MEC, format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=201 RETURNING id) SELECT count(*)::text FROM u$q$, :MEC)) = '1');
SELECT pg_temp.chk('Mechanical promotes the machine into Mechanical', pg_temp.q_user(:MEC, $q$WITH u AS (UPDATE public.machine_log SET stage='Mechanical',current_department='Mechanical',pending_handover_id=NULL WHERE id=201 RETURNING id) SELECT count(*)::text FROM u$q$) = '1');
SELECT pg_temp.chk('Mechanical cannot push the machine into another department', pg_temp.q_user(:MEC, $q$WITH u AS (UPDATE public.machine_log SET stage='Trial',current_department='Trial' WHERE id=201 RETURNING id) SELECT count(*)::text FROM u$q$) IN ('0','ERR 42501'));

-- ── 3. Finish & Transfer: only from your own department ──────────────────────
SELECT pg_temp.chk('Electrical cannot send a hand-over FROM Assembly', pg_temp.as_user(:ELE, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required) VALUES (204,'M-10','SN-204','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :ELE)) LIKE '42501%');
SELECT pg_temp.chk('user with no department cannot send a hand-over', pg_temp.as_user(:NOD, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required) VALUES (204,'M-10','SN-204','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :NOD)) LIKE '42501%');
SELECT pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required) VALUES (204,'M-10','SN-204','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :ASM)) AS ins \gset
SELECT pg_temp.chk('Assembly hand-over from Assembly is accepted by the database', :'ins' = '00000');
SELECT pg_temp.chk('Super Admin may send from any department', pg_temp.as_user(:SA, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required) VALUES (202,'M-10','SN-202','Electrical','Trial',%L,now(),60,50,'pending',120,false)$q$, :SA)) = '00000');

-- ── 4. Part Received / Work Completed ────────────────────────────────────────
SELECT pg_temp.chk('Electrical cannot receive Mechanical''s part (RPC)', pg_temp.as_user(:ELE, 'SELECT public.receive_pending_part(1, 2)') LIKE '42501%');
SELECT pg_temp.chk('user with NO department cannot receive any part (old unscoped loophole closed)', pg_temp.as_user(:NOD, 'SELECT public.receive_pending_part(1, 2)') LIKE '42501%');
SELECT pg_temp.chk('Mechanical receives Mechanical''s part', pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(1, 2)') = '00000');
SELECT pg_temp.chk('Electrical cannot mark Mechanical''s job completed (direct update)', pg_temp.q_user(:ELE, format($q$WITH u AS (UPDATE public.pending_handover_items SET status='resolved',resolved_by=%L,resolved_at=now() WHERE id=3 RETURNING id) SELECT count(*)::text FROM u$q$, :ELE)) = '0');
SELECT pg_temp.chk('Electrical cannot mark received by direct update either', pg_temp.q_user(:ELE, format($q$WITH u AS (UPDATE public.pending_handover_items SET received_at=now(),received_by=%L WHERE id=3 RETURNING id) SELECT count(*)::text FROM u$q$, :ELE)) = '0');
SELECT pg_temp.chk('job 3 still open after the refused attempts', (SELECT status='open' AND received_at IS NULL FROM public.pending_handover_items WHERE id=3));
SELECT pg_temp.chk('Mechanical completes its own work', pg_temp.q_user(:MEC, format($q$WITH u AS (UPDATE public.pending_handover_items SET status='resolved',resolved_by=%L,resolved_at=now() WHERE id=3 RETURNING id) SELECT count(*)::text FROM u$q$, :MEC)) = '1');
SELECT pg_temp.chk('Super Admin completes any department''s work', pg_temp.q_user(:SA, format($q$WITH u AS (UPDATE public.pending_handover_items SET status='resolved',resolved_by=%L,resolved_at=now() WHERE id=2 RETURNING id) SELECT count(*)::text FROM u$q$, :SA)) = '1');

-- ── 5. users and departments: super admin only ───────────────────────────────
SELECT pg_temp.as_user(:ADM, format($q$UPDATE public.users SET departments='{Assembly}' WHERE id=%L$q$, :ELE));
SELECT pg_temp.chk('Admin cannot change another user''s department', (SELECT departments='{Electrical}' FROM public.users WHERE id=:ELE));
SELECT pg_temp.chk('staff cannot change their own department (guard)', pg_temp.as_user(:MEC, format($q$UPDATE public.users SET departments='{Assembly,Mechanical}' WHERE id=%L$q$, :MEC)) LIKE '42501%');
SELECT pg_temp.chk('staff cannot create users', pg_temp.as_user(:MEC, $q$INSERT INTO public.users (id,username,role_key,status,departments) VALUES (gen_random_uuid(),'hack','super_admin','active','{}')$q$) LIKE '42501%');
SELECT pg_temp.chk('Admin cannot create or delete users', pg_temp.as_user(:ADM, $q$INSERT INTO public.users (id,username,role_key,status,departments) VALUES (gen_random_uuid(),'hack2','Production','active','{}')$q$) LIKE '42501%'
  AND pg_temp.q_user(:ADM, format($q$WITH d AS (DELETE FROM public.users WHERE id=%L RETURNING id) SELECT count(*)::text FROM d$q$, :NOD)) = '0');
SELECT pg_temp.as_user(:SA, format($q$UPDATE public.users SET departments='{Electrical,Trial}' WHERE id=%L$q$, :ELE)) AS sadept \gset
SELECT pg_temp.chk('Super Admin changes a department; the user keeps it', :'sadept' = '00000' AND (SELECT departments='{Electrical,Trial}' FROM public.users WHERE id=:ELE));
SELECT pg_temp.chk('the new department takes effect for that user at once', pg_temp.q_user(:ELE, 'SELECT count(*)::text FROM public.machine_log WHERE id=202') = '1');
SELECT pg_temp.chk('a disabled/unknown caller sees nothing', pg_temp.q_user('', 'SELECT count(*)::text FROM public.machine_log') IN ('0','ERR 42501'));

SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
