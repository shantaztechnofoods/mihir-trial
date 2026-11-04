-- Tests for migration 063: machine_append_history() — atomic append, compare-and-set, refusals.
-- Runs against erp_test built with 001..063.  Concurrency: tests/db/063_concurrent_append.sh
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
CREATE TEMP TABLE t_results (name text, ok boolean);
CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_ok,false));
      RAISE NOTICE '%  %', CASE WHEN coalesce(p_ok,false) THEN 'PASS' ELSE 'FAIL' END, p_name; END $$;
-- Runs p_sql as the given user; returns the function result text, or 'ERR <sqlstate>'.
CREATE OR REPLACE FUNCTION pg_temp.q_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true); PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE p_sql INTO v; EXCEPTION WHEN OTHERS THEN v := 'ERR ' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.q_anon(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN EXECUTE p_sql INTO v; EXCEPTION WHEN OTHERS THEN v := 'ERR ' || SQLSTATE; END;
  RESET ROLE; RETURN v;
END $$;
\set SA  '''c0000000-0000-0000-0000-000000000001'''
\set ADM '''c0000000-0000-0000-0000-000000000002'''
\set PRD '''c0000000-0000-0000-0000-000000000003'''
\set DIS '''c0000000-0000-0000-0000-000000000004'''
\set NOP '''c0000000-0000-0000-0000-000000000005'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ADM,'adm@t'),(:PRD,'prd@t'),(:DIS,'dis@t'),(:NOP,'nop@t');
UPDATE public.users SET role_key='super_admin', status='active' WHERE id=:SA;
UPDATE public.users SET role_key='Admin', status='active' WHERE id=:ADM;
UPDATE public.users SET role_key='Production', status='active', departments='{Mechanical}' WHERE id=:PRD;
UPDATE public.users SET role_key='Admin', status='disabled' WHERE id=:DIS;
UPDATE public.users SET role_key='no_access', status='active', departments='{Mechanical}' WHERE id=:NOP;

INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES
 (401,'M-10','K','SN-401','Assembly','active',current_date,'[{"stage":"Assembly","date":"d0","note":"start"}]','Assembly'),
 (402,'M-10','K','SN-402','Mechanical','active',current_date,'[]','Mechanical'),
 (403,'M-15','K','SN-403','Electrical','active',current_date,'[]','Electrical');

-- ── privileges / refusals ──
SELECT pg_temp.chk('anon has no EXECUTE', has_function_privilege('anon','public.machine_append_history(bigint,jsonb,jsonb,text,jsonb)','EXECUTE')=false);
SELECT pg_temp.chk('PUBLIC has no EXECUTE', NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges WHERE routine_name='machine_append_history' AND grantee='PUBLIC'));
SELECT pg_temp.chk('authenticated has EXECUTE', has_function_privilege('authenticated','public.machine_append_history(bigint,jsonb,jsonb,text,jsonb)','EXECUTE'));
SELECT pg_temp.chk('function is SECURITY DEFINER with search_path=public',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE proname='machine_append_history'));
SELECT pg_temp.chk('anon call refused', pg_temp.q_anon($q$SELECT public.machine_append_history(401,'[{"note":"x"}]')::text$q$) LIKE 'ERR 42501%');
SELECT pg_temp.chk('disabled user refused (42501)', pg_temp.q_user(:DIS, $q$SELECT public.machine_append_history(401,'[{"note":"dis"}]')::text$q$) = 'ERR 42501');
SELECT pg_temp.chk('user without machine permission refused', pg_temp.q_user(:NOP, $q$SELECT public.machine_append_history(402,'[{"note":"nop"}]')::text$q$) = 'ERR 42501');
SELECT pg_temp.chk('no-user caller refused', pg_temp.q_user('', $q$SELECT public.machine_append_history(401,'[{"note":"x"}]')::text$q$) LIKE 'ERR%');
SELECT pg_temp.chk('Mechanical user refused on an Assembly machine', pg_temp.q_user(:PRD, $q$SELECT public.machine_append_history(401,'[{"note":"prd"}]')::text$q$) = 'ERR 42501');
SELECT pg_temp.chk('Mechanical user cannot move own machine into Electrical', pg_temp.q_user(:PRD, $q$SELECT public.machine_append_history(402,'[{"note":"jump"}]','{"stage":"Electrical","current_department":"Electrical"}','Mechanical')::text$q$) = 'ERR 42501');
SELECT pg_temp.chk('refusals changed nothing', (SELECT history FROM public.machine_log WHERE id=401) = '[{"stage":"Assembly","date":"d0","note":"start"}]'::jsonb
  AND (SELECT stage FROM public.machine_log WHERE id=402)='Mechanical' AND (SELECT jsonb_array_length(history) FROM public.machine_log WHERE id=402)=0);
SELECT pg_temp.chk('identity columns cannot be passed (22023)', pg_temp.q_user(:ADM, $q$SELECT public.machine_append_history(401,'[]','{"bom_key":"HACK"}')::text$q$) = 'ERR 22023');
SELECT pg_temp.chk('non-array entries refused', pg_temp.q_user(:ADM, $q$SELECT public.machine_append_history(401,'{"note":"x"}')::text$q$) = 'ERR 22023');
SELECT pg_temp.chk('unknown machine -> P0002', pg_temp.q_user(:ADM, $q$SELECT public.machine_append_history(99999,'[{"note":"x"}]')::text$q$) = 'ERR P0002');

-- ── append ──
SELECT pg_temp.q_user(:PRD, $q$SELECT public.machine_append_history(402,'[{"stage":"Mechanical","date":"d1","note":"own dept note"}]')::text$q$) AS r1 \gset
SELECT pg_temp.chk('department user appends on own machine', (:'r1')::jsonb ->> 'ok' = 'true'
  AND (SELECT history FROM public.machine_log WHERE id=402) = '[{"stage":"Mechanical","date":"d1","note":"own dept note"}]'::jsonb);
-- Two appends from two "stale" clients: neither sends the other's entry, both survive.
SELECT pg_temp.q_user(:ADM, $q$SELECT public.machine_append_history(401,'[{"stage":"Assembly","date":"d2","note":"Put ON HOLD by A"}]','{"hold_active":true,"hold_reason":"waiting part"}')::text$q$) AS r2 \gset
SELECT pg_temp.q_user(:SA,  $q$SELECT public.machine_append_history(401,'[{"stage":"Mechanical","date":"d2","note":"stage by B"}]','{"stage":"Mechanical","current_department":"Mechanical"}','Assembly')::text$q$) AS r3 \gset
SELECT pg_temp.chk('hold append ok and hold stamped by trigger', (:'r2')::jsonb ->> 'ok'='true'
  AND (SELECT hold_active AND hold_by = :ADM::uuid AND hold_reason='waiting part' FROM public.machine_log WHERE id=401));
SELECT pg_temp.chk('stage CAS with correct expected stage ok', (:'r3')::jsonb ->> 'ok'='true' AND (SELECT stage='Mechanical' AND current_department='Mechanical' FROM public.machine_log WHERE id=401));
SELECT pg_temp.chk('both entries present, original kept, in order',
  (SELECT history FROM public.machine_log WHERE id=401) = '[{"stage":"Assembly","date":"d0","note":"start"},{"stage":"Assembly","date":"d2","note":"Put ON HOLD by A"},{"stage":"Mechanical","date":"d2","note":"stage by B"}]'::jsonb);
SELECT pg_temp.chk('returned row carries the new history', jsonb_array_length((:'r3')::jsonb -> 'machine' -> 'history') = 3);

-- ── compare-and-set: stale ──
SELECT pg_temp.q_user(:SA, $q$SELECT public.machine_append_history(401,'[{"note":"late stage"}]','{"stage":"Electrical","current_department":"Electrical"}','Assembly')::text$q$) AS r4 \gset
SELECT pg_temp.chk('stale expected stage -> {ok:false, stale:true}', (:'r4')::jsonb ->> 'stale'='true' AND (:'r4')::jsonb ->> 'ok'='false'
  AND (:'r4')::jsonb -> 'machine' ->> 'stage' = 'Mechanical');
SELECT pg_temp.chk('stale call changed nothing', (SELECT stage='Mechanical' AND jsonb_array_length(history)=3 FROM public.machine_log WHERE id=401));

-- ── null handling, audit ──
SELECT pg_temp.q_user(:ADM, $q$SELECT public.machine_append_history(401,'[{"note":"released"}]','{"hold_active":false,"hold_reason":""}',NULL,'{"type":"machine_hold_released","action":"Released test","details":{"why":"t"}}')::text$q$) AS r5 \gset
SELECT pg_temp.chk('release clears hold, audit row written in same call', (:'r5')::jsonb ->> 'audited'='true'
  AND (SELECT NOT hold_active AND hold_reason IS NULL FROM public.machine_log WHERE id=401)
  AND (SELECT count(*)=1 FROM public.audit_log WHERE type='machine_hold_released' AND user_id=:ADM::uuid AND user_role='Admin' AND ref='M-10' AND serial_no='SN-401' AND (details->>'machine_id')='401'));
SELECT pg_temp.chk('no audit param -> no audit row', (SELECT count(*)=1 FROM public.audit_log WHERE type IN ('machine_hold_released','machine_history')));
INSERT INTO public.handover_events (id,machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
 VALUES (777,403,'M-15','SN-403','Electrical','Trial',:SA,now(),0,0,'pending',0,false);
UPDATE public.machine_log SET pending_handover_id = 777 WHERE id=403;
SELECT pg_temp.chk('setup: machine linked to hand-over', (SELECT pending_handover_id=777 FROM public.machine_log WHERE id=403));
SELECT pg_temp.q_user(:ADM, $q$SELECT public.machine_append_history(403,'[{"note":"unlink"}]','{"pending_handover_id":null}')::text$q$) AS r6 \gset
SELECT pg_temp.chk('JSON null clears pending_handover_id', (:'r6')::jsonb ->> 'ok'='true' AND (SELECT pending_handover_id IS NULL FROM public.machine_log WHERE id=403));
SELECT pg_temp.chk('bad stage value rejected by CHECK, nothing changed', pg_temp.q_user(:ADM, $q$SELECT public.machine_append_history(403,'[{"note":"bad"}]','{"stage":"Nowhere"}')::text$q$) LIKE 'ERR 23514'
  AND (SELECT jsonb_array_length(history)=1 FROM public.machine_log WHERE id=403));
SELECT pg_temp.chk('hold without reason still refused by 055 trigger', pg_temp.q_user(:ADM, $q$SELECT public.machine_append_history(403,'[]','{"hold_active":true}')::text$q$) = 'ERR 22023');

SELECT count(*) FILTER (WHERE ok) || ' PASSED' FROM t_results;
SELECT count(*) FILTER (WHERE NOT ok) || ' FAILED' FROM t_results;
