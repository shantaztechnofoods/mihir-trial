-- Role tests for migration 065 (Stores read-only machine visibility). Runs against a DB built with 001..065.
-- Store Manager with no department, Purchase Manager, a disabled / page-blocked Store Manager, floor users, Admin.
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
\set ELE '''a0000000-0000-0000-0000-000000000008'''
\set NOD '''a0000000-0000-0000-0000-000000000009'''
\set STM '''a0000000-0000-0000-0000-000000000011'''
\set PUR '''a0000000-0000-0000-0000-000000000012'''
\set STD '''a0000000-0000-0000-0000-000000000013'''
\set STX '''a0000000-0000-0000-0000-000000000014'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ADM,'adm@t'),(:ASM,'asm@t'),(:ELE,'ele@t'),(:NOD,'nod@t'),(:STM,'stm@t'),(:PUR,'pur@t'),(:STD,'std@t'),(:STX,'stx@t');
UPDATE public.users SET role_key='super_admin', status='active', departments='{}' WHERE id=:SA;
UPDATE public.users SET role_key='Admin', status='active', departments='{}' WHERE id=:ADM;
UPDATE public.users SET role_key='Production', status='active', departments='{Assembly}' WHERE id=:ASM;
UPDATE public.users SET role_key='Production', status='active', departments='{Electrical}' WHERE id=:ELE;
UPDATE public.users SET role_key='Production', status='active', departments='{}' WHERE id=:NOD;
UPDATE public.users SET role_key='Store Manager', status='active', departments='{}' WHERE id=:STM;
UPDATE public.users SET role_key='Purchase Manager', status='active', departments='{}' WHERE id=:PUR;
UPDATE public.users SET role_key='Store Manager', status='disabled', departments='{}' WHERE id=:STD;
-- a Store Manager whose Machine Tracker page is switched off by a per-user override
UPDATE public.users SET role_key='Store Manager', status='active', departments='{}', overrides='{"pages":{"machines":false}}' WHERE id=:STX;

INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department,rack_slot) VALUES
 (301,'M-10','K','SN-301','Assembly','active',current_date,'[]','Assembly',NULL),
 (302,'M-10','K','SN-302','Electrical','active',current_date,'[]','Electrical',NULL),
 (303,'M-20','R','SN-303','BOM Issued','active',current_date,'[]','Assembly','M-20-1#1');
INSERT INTO public.pending_handover_items (id,machine_id,description,kind,status,assigned_department,raised_in_department,raised_by,qty,item_name,item_code)
 VALUES (11,301,'Gearbox','owed','open','Assembly','Assembly',:ASM,4,'Gearbox','GB-1'),
        (12,302,'Motor','fault','open','Electrical','Electrical',:ELE,1,'Motor','MT-1');
SELECT setval(pg_get_serial_sequence('public.pending_handover_items','id'), 50);

\set CNT_M 'SELECT count(*)::text FROM public.machine_log WHERE id BETWEEN 301 AND 303'
\set CNT_P 'SELECT count(*)::text FROM public.pending_handover_items WHERE id BETWEEN 11 AND 12'

-- ── 1. visibility ────────────────────────────────────────────────────────────
SELECT pg_temp.chk('Store Manager (no department) reads ALL machines incl. rack', pg_temp.q_user(:STM, :'CNT_M') = '3');
SELECT pg_temp.chk('Store Manager reads ALL pending jobs (parts waiting)', pg_temp.q_user(:STM, :'CNT_P') = '2');
SELECT pg_temp.chk('Store Manager sees rack slot + stage of rack machine', pg_temp.q_user(:STM, 'SELECT stage || ''|'' || rack_slot FROM public.machine_log WHERE id=303') = 'BOM Issued|M-20-1#1');
SELECT pg_temp.chk('Production user with NO department still sees nothing (058 unchanged)', pg_temp.q_user(:NOD, :'CNT_M') = '0' AND pg_temp.q_user(:NOD, :'CNT_P') = '0');
SELECT pg_temp.chk('Electrical still sees only its own machine (058 unchanged)', pg_temp.q_user(:ELE, 'SELECT string_agg(id::text, '','' ORDER BY id) FROM public.machine_log WHERE id BETWEEN 301 AND 303') = '302');
SELECT pg_temp.chk('Purchase Manager (inward.submit but no machines page) sees nothing', pg_temp.q_user(:PUR, :'CNT_M') = '0');
SELECT pg_temp.chk('disabled Store Manager sees nothing', pg_temp.q_user(:STD, :'CNT_M') = '0');
SELECT pg_temp.chk('Store Manager with machines page overridden OFF sees nothing', pg_temp.q_user(:STX, :'CNT_M') = '0');
SELECT pg_temp.chk('anon sees nothing', pg_temp.q_user('', :'CNT_M') IN ('0','ERR 42501'));
SELECT pg_temp.chk('Admin / super admin unchanged (3)', pg_temp.q_user(:ADM, :'CNT_M') = '3' AND pg_temp.q_user(:SA, :'CNT_M') = '3');

-- ── 2. still read-only for Stores ────────────────────────────────────────────
SELECT pg_temp.chk('Store Manager cannot UPDATE a machine (0 rows changed)',
  pg_temp.q_user(:STM, 'WITH u AS (UPDATE public.machine_log SET stage=''Electrical'' WHERE id=301 RETURNING 1) SELECT count(*)::text FROM u') = '0');
SELECT pg_temp.chk('machine 301 stage unchanged', (SELECT stage FROM public.machine_log WHERE id=301) = 'Assembly');
SELECT pg_temp.chk('Store Manager cannot DELETE a machine', pg_temp.q_user(:STM, 'WITH d AS (DELETE FROM public.machine_log WHERE id=302 RETURNING 1) SELECT count(*)::text FROM d') IN ('0','ERR 42501')
  AND (SELECT count(*) FROM public.machine_log WHERE id=302) = 1);
SELECT pg_temp.chk('Store Manager cannot resolve another department''s job',
  pg_temp.q_user(:STM, 'WITH u AS (UPDATE public.pending_handover_items SET status=''resolved'', resolved_by=auth.uid() WHERE id=12 RETURNING 1) SELECT count(*)::text FROM u') IN ('0','ERR 42501')
  AND (SELECT status FROM public.pending_handover_items WHERE id=12) = 'open');
SELECT pg_temp.chk('Store Manager cannot raise a hand-over from a department it is not in',
  pg_temp.as_user(:STM, 'INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required) VALUES (301,''M-10'',''SN-301'',''Assembly'',''Mechanical'',auth.uid(),now(),60,50,''pending'',120,false)') <> '00000');
-- (Store Manager CAN already insert a pending job via the BOM Outward policy
--  pending_handover_items_insert_outward — pre-065 behaviour, unchanged here.)
SELECT pg_temp.chk('065 adds only SELECT policies', (SELECT count(*) FROM pg_policies WHERE policyname IN ('machine_select_stores','pending_handover_items_select_stores') AND cmd = 'SELECT') = 2
  AND (SELECT count(*) FROM pg_policies WHERE policyname LIKE '%\_stores' AND cmd <> 'SELECT') = 0);
SELECT pg_temp.chk('machine_in_scope() still false for Store Manager (write helpers untouched)', pg_temp.q_user(:STM, 'SELECT public.machine_in_scope(301)::text') = 'false');

SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
