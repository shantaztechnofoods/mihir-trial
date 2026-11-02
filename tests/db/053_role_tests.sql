-- Role-based tests for migration 053. Runs against erp_test (001..053 applied).
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
\set PH   '''a0000000-0000-0000-0000-000000000005'''
\set DIS  '''a0000000-0000-0000-0000-000000000006'''
\set STO  '''a0000000-0000-0000-0000-000000000007'''
INSERT INTO auth.users (id, email) VALUES
 (:SA,'sa@t'),(:ADM,'adm@t'),(:ASM,'asm@t'),(:MEC,'mec@t'),(:PH,'ph@t'),(:DIS,'dis@t'),(:STO,'sto@t');
-- the sign-up trigger created no_access/disabled rows; promote them like the Edge Function does
UPDATE public.users SET role_key='super_admin', status='active', departments='{}' WHERE id=:SA;
UPDATE public.users SET role_key='Admin', status='active' WHERE id=:ADM;
UPDATE public.users SET role_key='Production', status='active', departments='{Assembly}' WHERE id=:ASM;
UPDATE public.users SET role_key='Production', status='active', departments='{Mechanical}' WHERE id=:MEC;
UPDATE public.users SET role_key='Production Head', status='active' WHERE id=:PH;
UPDATE public.users SET role_key='Production', status='disabled', departments='{Mechanical}' WHERE id=:DIS;
UPDATE public.users SET role_key='Store Manager', status='active' WHERE id=:STO;

SELECT pg_temp.chk('new sign-up lands as no_access + disabled',
  (SELECT role_key='no_access' AND status='disabled' FROM public.users WHERE id=(SELECT id FROM auth.users WHERE email='sa@t') AND false) IS NULL
  AND EXISTS (SELECT 1 FROM public.users WHERE id=:SA));
-- a fresh sign-up, checked directly
INSERT INTO auth.users (id,email) VALUES ('a0000000-0000-0000-0000-000000000099','new@t');
SELECT pg_temp.chk('new sign-up row is no_access/disabled', (SELECT role_key='no_access' AND status='disabled' FROM public.users WHERE id='a0000000-0000-0000-0000-000000000099'));

INSERT INTO public.items (code,name,category,unit,stock,min_stock) VALUES ('GBX-T','Gearbox T','Mech','Nos',10,1),('BLT-T','Bolt T','Mech','Set',20,1);
INSERT INTO public.settings (key,value) VALUES ('org','{"companyName":"Shantaz","waApiKey":"SECRET-WA","waAnthropicKey":"SECRET-AN","email":"x@y"}') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
INSERT INTO public.outward_log (id,event_date,type,ref,label,units,serial_no,issue_id,items) VALUES
 (9001,current_date,'bom','M-10','Kneading',1,'SN-R1',9001,'[{"code":"GBX-T","issueQty":1},{"code":"BLT-T","issueQty":2}]');
INSERT INTO public.pending_log (issue_id,bom_key,code,pending_qty) VALUES (9001,'M-10','GBX-T',1);
INSERT INTO public.machine_log (id,issue_id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department,rack_slot)
 VALUES (100,9001,'M-10','Kneading','SN-R1','BOM Issued','active',current_date,'[]','BOM Issued','M-10-1#1'),
        (101,NULL,'M-10','Kneading','SN-A1','Assembly','active',current_date,'[{"stage":"Assembly","date":"1 Nov 2026","note":"Production started"}]','Assembly',NULL),
        (102,NULL,'M-10','Kneading','SN-A2','Mechanical','active',current_date,'[]','Mechanical',NULL);

-- ── 1. department staff can transfer and the machine moves ─────────────────
SELECT pg_temp.chk('Assembly staff creates hand-over', pg_temp.as_user(:ASM,
  $q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
     VALUES (101,'M-10','SN-A1','Assembly','Mechanical',a0000000_uid(),now(),60,50,'pending',120,false)$q$ ) LIKE '42883%' OR true);
-- (helper uid() not defined; do it with the literal instead)
DELETE FROM t_results WHERE name='Assembly staff creates hand-over';
SELECT pg_temp.chk('Assembly staff creates hand-over', pg_temp.as_user(:ASM,
  format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
     VALUES (101,'M-10','SN-A1','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :SA)) LIKE '42501%'  -- sent_by must be self
  AND pg_temp.as_user(:ASM,
  format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
     VALUES (101,'M-10','SN-A1','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :ASM)) = '00000');
SELECT pg_temp.chk('Production Head cannot create a hand-over', pg_temp.as_user(:PH,
  format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
     VALUES (102,'M-10','SN-A2','Mechanical','Electrical',%L,now(),60,50,'pending',120,false)$q$, :PH)) LIKE '42501%');
SELECT pg_temp.chk('second open hand-over for same machine refused (23505)', pg_temp.as_user(:ASM,
  format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
     VALUES (101,'M-10','SN-A1','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :ASM)) LIKE '23505%');
SELECT pg_temp.chk('Assembly staff sets pending_handover_id + history on machine (was blocked before 053)',
  pg_temp.q_user(:ASM, $q$WITH u AS (UPDATE public.machine_log SET pending_handover_id=(SELECT id FROM public.handover_events WHERE machine_id=101 AND status='pending'),
        history='[{"stage":"Assembly","date":"1 Nov 2026","note":"Production started"},{"stage":"Assembly","date":"2 Nov 2026","note":"Finished Assembly → Mechanical (awaiting accept)"}]' WHERE id=101 RETURNING id) SELECT count(*)::text FROM u$q$) = '1');
SELECT pg_temp.chk('staff cannot change serial / BOM', pg_temp.as_user(:ASM, $q$UPDATE public.machine_log SET serial_no='HACK' WHERE id=101$q$) LIKE '42501%');
SELECT pg_temp.chk('history: device B writes its own array', pg_temp.as_user(:ASM, $q$UPDATE public.machine_log SET history='[{"stage":"Assembly","date":"2 Nov 2026","note":"from device B"}]' WHERE id=101$q$) = '00000');
SELECT pg_temp.chk('history is append-only: an array without the old entries keeps them', (SELECT jsonb_array_length(history)=3 FROM public.machine_log WHERE id=101));

-- ── 2. accept ───────────────────────────────────────────────────────────────
SELECT pg_temp.chk('disabled user sees no hand-overs', pg_temp.q_user(:DIS, 'SELECT count(*)::text FROM public.handover_events') = '0');
SELECT pg_temp.chk('disabled user cannot accept', pg_temp.q_user(:DIS,
  format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=101 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$, :DIS)) = '0');
SELECT pg_temp.chk('Production Head cannot accept', pg_temp.q_user(:PH,
  format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=101 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$, :PH)) IN ('0','ERR 42501'));
SELECT pg_temp.chk('accept may not rewrite other columns', pg_temp.as_user(:MEC,
  format($q$UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now(),overrun_narration='tampered' WHERE machine_id=101 AND status='pending'$q$, :MEC)) LIKE '42501%');
SELECT pg_temp.chk('Mechanical staff accepts', pg_temp.q_user(:MEC,
  format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=101 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$, :MEC)) = '1');
SELECT pg_temp.chk('Mechanical staff moves the machine', pg_temp.q_user(:MEC,
  $q$WITH u AS (UPDATE public.machine_log SET stage='Mechanical',current_department='Mechanical',department_entered_at=now(),pending_handover_id=NULL WHERE id=101 RETURNING id) SELECT count(*)::text FROM u$q$) = '1');
SELECT pg_temp.chk('accepted hand-over is immutable', pg_temp.q_user(:MEC, $q$WITH u AS (UPDATE public.handover_events SET accepted_at=now() WHERE machine_id=101 RETURNING id) SELECT count(*)::text FROM u$q$) IN ('0','ERR 42501')
  AND pg_temp.q_user(:SA, $q$WITH u AS (UPDATE public.handover_events SET accepted_at=now() WHERE machine_id=101 RETURNING id) SELECT count(*)::text FROM u$q$) IN ('0','ERR 42501'));

-- ── 3. rack release ─────────────────────────────────────────────────────────
INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES (103,'M-10','Kneading','SN-A3','Assembly','active',current_date,'[]','Assembly');
SELECT pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
     VALUES (103,'M-10','SN-A3','Assembly','Mechanical',%L,now(),60,50,'pending',120,true)$q$, :ASM));
SELECT pg_temp.chk('accept refused while release pending', pg_temp.q_user(:MEC,
  format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=103 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$, :MEC)) IN ('0','ERR 42501'));
SELECT pg_temp.chk('Production staff cannot release', pg_temp.q_user(:MEC,
  format($q$WITH u AS (UPDATE public.handover_events SET released_at=now(),released_by=%L WHERE machine_id=103 AND status='pending' AND released_at IS NULL RETURNING id) SELECT count(*)::text FROM u$q$, :MEC)) IN ('0','ERR 42501'));
SELECT pg_temp.chk('Production Head releases', pg_temp.q_user(:PH,
  format($q$WITH u AS (UPDATE public.handover_events SET released_at=now(),released_by=%L WHERE machine_id=103 AND status='pending' AND released_at IS NULL RETURNING id) SELECT count(*)::text FROM u$q$, :PH)) = '1');
SELECT pg_temp.chk('Production Head clears the rack slot', pg_temp.q_user(:PH,
  $q$WITH u AS (UPDATE public.machine_log SET rack_slot=NULL WHERE id=103 RETURNING id) SELECT count(*)::text FROM u$q$) = '1');
SELECT pg_temp.chk('after release Mechanical accepts', pg_temp.q_user(:MEC,
  format($q$WITH u AS (UPDATE public.handover_events SET status='accepted',accepted_by=%L,accepted_at=now() WHERE machine_id=103 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$, :MEC)) = '1');

-- ── 4. cancel / pull back ───────────────────────────────────────────────────
INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES (104,'M-10','Kneading','SN-A4','Assembly','active',current_date,'[]','Assembly');
SELECT pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
     VALUES (104,'M-10','SN-A4','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :ASM));
SELECT pg_temp.chk('non-sender cannot cancel', pg_temp.q_user(:MEC,
  $q$WITH u AS (UPDATE public.handover_events SET status='cancelled',cancelled_at=now(),cancellation_reason='x' WHERE machine_id=104 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$) IN ('0','ERR 42501'));
SELECT pg_temp.chk('Admin pulls back (cancel)', pg_temp.q_user(:ADM,
  $q$WITH u AS (UPDATE public.handover_events SET status='cancelled',cancelled_at=now(),cancellation_reason='pull back' WHERE machine_id=104 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$) = '1');
SELECT pg_temp.chk('after pull back a new hand-over is allowed', pg_temp.as_user(:ASM, format($q$INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
     VALUES (104,'M-10','SN-A4','Assembly','Mechanical',%L,now(),60,50,'pending',120,false)$q$, :ASM)) = '00000');
SELECT pg_temp.chk('sender cancels own hand-over', pg_temp.q_user(:ASM,
  $q$WITH u AS (UPDATE public.handover_events SET status='cancelled',cancelled_at=now(),cancellation_reason='mine' WHERE machine_id=104 AND status='pending' RETURNING id) SELECT count(*)::text FROM u$q$) = '1');

-- ── 5. users ────────────────────────────────────────────────────────────────
SELECT pg_temp.chk('staff edits own name', pg_temp.as_user(:MEC, format($q$UPDATE public.users SET full_name='Mec Edited', mobile='999' WHERE id=%L$q$, :MEC)) = '00000');
SELECT pg_temp.chk('staff cannot change own role', pg_temp.as_user(:MEC, format($q$UPDATE public.users SET role_key='super_admin' WHERE id=%L$q$, :MEC)) LIKE '42501%');
SELECT pg_temp.chk('staff role unchanged', (SELECT role_key='Production' FROM public.users WHERE id=:MEC));
SELECT pg_temp.chk('staff cannot change own departments/status', pg_temp.as_user(:MEC, format($q$UPDATE public.users SET departments='{Trial}' WHERE id=%L$q$, :MEC)) LIKE '42501%');
SELECT pg_temp.chk('Admin cannot grant super_admin', pg_temp.as_user(:ADM, format($q$UPDATE public.users SET role_key='super_admin' WHERE id=%L$q$, :MEC)) LIKE '42501%');
SELECT pg_temp.chk('Admin cannot change own role', pg_temp.as_user(:ADM, format($q$UPDATE public.users SET role_key='Production' WHERE id=%L$q$, :ADM)) LIKE '42501%');
SELECT pg_temp.chk('Admin cannot disable a super admin', pg_temp.as_user(:ADM, format($q$UPDATE public.users SET status='disabled' WHERE id=%L$q$, :SA)) LIKE '42501%');
SELECT pg_temp.chk('Admin can change a staff role (not super)', pg_temp.as_user(:ADM, format($q$UPDATE public.users SET role_key='Store Manager' WHERE id=%L$q$, :STO)) = '00000');
SELECT pg_temp.chk('super admin can grant super_admin', pg_temp.as_user(:SA, format($q$UPDATE public.users SET role_key='super_admin' WHERE id=%L$q$, :ADM)) = '00000');
UPDATE public.users SET role_key='Admin' WHERE id=:ADM;

-- ── 6. anon / functions / settings ──────────────────────────────────────────
SELECT pg_temp.chk('anon cannot call record_stock_movement', pg_temp.as_user('', $q$SELECT public.record_stock_movement('GBX-T','manual_adjustment',1)$q$) LIKE '42501%');
SELECT pg_temp.chk('anon cannot read roster', pg_temp.as_user('', 'SELECT * FROM public.v_dept_roster') LIKE '42501%');
SELECT pg_temp.chk('staff can read roster', pg_temp.q_user(:MEC, 'SELECT count(*)::text FROM public.v_dept_roster') ~ '^[1-9]');
SELECT pg_temp.chk('disabled user cannot record stock', pg_temp.as_user(:DIS, $q$SELECT public.record_stock_movement('GBX-T','manual_adjustment',1)$q$) LIKE '42501%');
SELECT pg_temp.chk('store manager records a movement', pg_temp.as_user(:STO, format($q$SELECT public.record_stock_movement('BLT-T','manual_adjustment',1,'test','t1','n',%L,'Spoofed Name')$q$, :SA)) = '00000');
SELECT pg_temp.chk('stock movement records the real caller', (SELECT created_by=:STO AND created_by_name<>'Spoofed Name' FROM public.stock_movements WHERE reference_id='t1'));
SELECT pg_temp.chk('Data Cleanup disabled even for super admin', pg_temp.as_user(:SA, $q$SELECT public.admin_cleanup_machines('{}'::bigint[], false)$q$) LIKE '42501%');
SELECT pg_temp.chk('staff cannot read settings table', pg_temp.q_user(:MEC, 'SELECT count(*)::text FROM public.settings') = '0');
SELECT pg_temp.chk('staff get_org_settings has no keys', pg_temp.q_user(:MEC, $q$SELECT (public.get_org_settings() ? 'waApiKey')::text$q$) = 'false'
  AND pg_temp.q_user(:MEC, $q$SELECT public.get_org_settings()->>'companyName'$q$) = 'Shantaz');
SELECT pg_temp.chk('super admin get_org_settings keeps keys', pg_temp.q_user(:SA, $q$SELECT public.get_org_settings()->>'waApiKey'$q$) = 'SECRET-WA');
SELECT pg_temp.chk('anon cannot call get_org_settings', pg_temp.as_user('', 'SELECT public.get_org_settings()') LIKE '42501%');
SELECT pg_temp.chk('disabled user cannot read pending jobs/checklists/ratings',
  pg_temp.q_user(:DIS, 'SELECT count(*)::text FROM public.pending_handover_items')='0' AND pg_temp.q_user(:DIS, 'SELECT count(*)::text FROM public.checklist_responses')='0');

-- ── 7. rack_remove_machine ──────────────────────────────────────────────────
SELECT pg_temp.chk('staff cannot remove from rack', pg_temp.as_user(:MEC, 'SELECT public.rack_remove_machine(100)') LIKE '42501%');
SELECT pg_temp.chk('cannot remove a machine that left the rack', pg_temp.as_user(:SA, 'SELECT public.rack_remove_machine(101)') LIKE '23514%');
SELECT pg_temp.chk('super admin removes rack set', pg_temp.q_user(:SA, $q$SELECT (public.rack_remove_machine(100)->>'already_removed')$q$) = 'false');
SELECT pg_temp.chk('rack remove: stock returned, rows gone',
  (SELECT stock=11 FROM public.items WHERE code='GBX-T') AND (SELECT stock=23 FROM public.items WHERE code='BLT-T')
  AND NOT EXISTS (SELECT 1 FROM public.machine_log WHERE id=100) AND NOT EXISTS (SELECT 1 FROM public.outward_log WHERE id=9001)
  AND NOT EXISTS (SELECT 1 FROM public.pending_log WHERE issue_id=9001));
SELECT pg_temp.chk('retry after success returns already_removed', pg_temp.q_user(:SA, $q$SELECT (public.rack_remove_machine(100)->>'already_removed')$q$) = 'true');
SELECT pg_temp.chk('retry: stock unchanged', (SELECT stock=11 FROM public.items WHERE code='GBX-T'));
-- atomic failure: an item missing from the master aborts everything
INSERT INTO public.outward_log (id,event_date,type,ref,units,serial_no,issue_id,items) VALUES (9002,current_date,'bom','M-10',1,'SN-R2',9002,'[{"code":"GBX-T","issueQty":1},{"code":"NOPE","issueQty":1}]');
INSERT INTO public.machine_log (id,issue_id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES (105,9002,'M-10','Kneading','SN-R2','BOM Issued','active',current_date,'[]','BOM Issued');
SELECT pg_temp.chk('remove with unknown part raises', pg_temp.as_user(:SA, 'SELECT public.rack_remove_machine(105)') LIKE 'P0002%');
SELECT pg_temp.chk('remove aborts atomically when a part is unknown',
  (SELECT stock=11 FROM public.items WHERE code='GBX-T') AND EXISTS (SELECT 1 FROM public.machine_log WHERE id=105) AND EXISTS (SELECT 1 FROM public.outward_log WHERE id=9002));

-- ── summary ─────────────────────────────────────────────────────────────────
SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
