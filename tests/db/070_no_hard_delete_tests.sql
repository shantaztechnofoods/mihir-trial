-- Tests for migration 070: no hard DELETE on master / history tables.
-- Runs against erp_test built with 001..070:
--   bash tests/db/build_local_db.sh 070
--   su postgres -c "psql -q -d erp_test -f tests/db/070_no_hard_delete_tests.sql" | grep -E 'FAIL|PASSED|FAILED'
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
CREATE TEMP TABLE t_results (name text, ok boolean);
CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t_results VALUES (p_name, coalesce(p_ok,false));
      RAISE NOTICE '%  %', CASE WHEN coalesce(p_ok,false) THEN 'PASS' ELSE 'FAIL' END, p_name; END $$;
-- Run SQL as postgres (superuser — RLS bypassed, so only the trigger can stop it).
CREATE OR REPLACE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN '00000'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true); PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE p_sql; v := '00000'; EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v;
END $$;

\set SA  '''c0000000-0000-0000-0000-000000000001'''
\set ADM '''c0000000-0000-0000-0000-000000000002'''
INSERT INTO auth.users (id, email) VALUES (:SA,'sa@t'),(:ADM,'adm@t');
UPDATE public.users SET role_key='super_admin', status='active' WHERE id=:SA;
UPDATE public.users SET role_key='Admin', status='active' WHERE id=:ADM;

-- Fixture: one row in every guarded table.
INSERT INTO public.bom_definitions (key, label, items) VALUES ('T-10','Test BOM','[]'), ('T-20','Spare BOM','[]');
INSERT INTO public.checklist_templates (department, name, items, active, bom_key, stage)
  VALUES ('Assembly','T-10 check','[{"id":"a","label":"ok"}]', true, 'T-10', 'before_dispatch');
INSERT INTO public.items (code, name, category, stock) VALUES ('X1','Bolt','Hardware', 10), ('X2','Nut','Hardware', 4);
INSERT INTO public.item_history (item_id, item_code, event_type, quantity_change) SELECT id, code, 'Opening', 0 FROM public.items WHERE code='X1';
INSERT INTO public.vendors (name) VALUES ('Acme Steel');
INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department) VALUES
 (701,'T-10','Test','SN-701','Assembly','active',current_date,'[]','Assembly');
INSERT INTO public.handover_events (machine_id,bom_key,serial_no,from_department,to_department,sent_by,sent_at,expected_duration_minutes,actual_duration_minutes,status,accept_timeout_minutes,release_required)
 VALUES (701,'T-10','SN-701','Assembly','Mechanical',:SA,now(),0,0,'pending',0,false);
INSERT INTO public.pending_handover_items (machine_id, description) VALUES (701, 'missing bolt');
INSERT INTO public.checklist_responses (machine_id, department) VALUES (701, 'Assembly');

-- ── 1. Every guarded table refuses DELETE, even for the superuser ──────────
SELECT pg_temp.chk('guard function exists', to_regprocedure('public.forbid_hard_delete()') IS NOT NULL);
SELECT pg_temp.chk('9 BEFORE DELETE guard triggers installed',
  (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%\_no\_hard\_delete' AND NOT tgisinternal) = 9);
SELECT pg_temp.chk('9 BEFORE TRUNCATE guard triggers installed',
  (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%\_no\_truncate' AND NOT tgisinternal) = 9);
SELECT pg_temp.chk('DELETE bom_definitions refused with the archive message',
  pg_temp.try('DELETE FROM public.bom_definitions WHERE key=''T-20''') LIKE '23514 Deleting is not allowed — archive instead%');
SELECT pg_temp.chk('DELETE items refused',               pg_temp.try('DELETE FROM public.items WHERE code=''X2''') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('DELETE vendors refused',             pg_temp.try('DELETE FROM public.vendors') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('DELETE checklist_templates refused', pg_temp.try('DELETE FROM public.checklist_templates') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('DELETE item_history refused',        pg_temp.try('DELETE FROM public.item_history') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('DELETE machine_log refused',         pg_temp.try('DELETE FROM public.machine_log WHERE id=701') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('DELETE handover_events refused',     pg_temp.try('DELETE FROM public.handover_events') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('DELETE pending_handover_items refused', pg_temp.try('DELETE FROM public.pending_handover_items') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('DELETE checklist_responses refused', pg_temp.try('DELETE FROM public.checklist_responses') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('TRUNCATE bom_definitions refused',   pg_temp.try('TRUNCATE public.bom_definitions CASCADE') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('TRUNCATE items refused',             pg_temp.try('TRUNCATE public.items CASCADE') LIKE '23514 Deleting is not allowed%');
SELECT pg_temp.chk('audit_log still immutable (004 trigger)', pg_temp.try('DELETE FROM public.audit_log') <> '00000' OR (SELECT count(*) FROM public.audit_log) = 0);
SELECT pg_temp.chk('every fixture row is still there',
  (SELECT count(*) FROM public.bom_definitions WHERE key IN ('T-10','T-20'))=2 AND (SELECT count(*) FROM public.items WHERE code IN ('X1','X2'))=2
  AND (SELECT count(*) FROM public.vendors)=1 AND (SELECT count(*) FROM public.checklist_templates)=1 AND (SELECT count(*) FROM public.item_history)=1
  AND (SELECT count(*) FROM public.machine_log WHERE id=701)=1 AND (SELECT count(*) FROM public.handover_events)=1
  AND (SELECT count(*) FROM public.pending_handover_items)=1 AND (SELECT count(*) FROM public.checklist_responses)=1);

-- ── 2. App users through the API (authenticated role) are refused too ──────
SELECT pg_temp.chk('Super Admin direct DELETE of a BOM leaves the row', (pg_temp.as_user(:SA,'DELETE FROM public.bom_definitions WHERE key=''T-20'''), (SELECT count(*) FROM public.bom_definitions WHERE key='T-20'))::text LIKE '%,1)');
SELECT pg_temp.chk('Admin direct DELETE of an item leaves the row', (pg_temp.as_user(:ADM,'DELETE FROM public.items WHERE code=''X2'''), (SELECT count(*) FROM public.items WHERE code='X2'))::text LIKE '%,1)');

-- ── 3. Archive / restore (what the app does now) still works ───────────────
-- (each write runs in its own statement: a check in the same statement would
-- read the statement's snapshot from before the write)
SELECT pg_temp.try('UPDATE public.bom_definitions SET retired_at=now() WHERE key=''T-10''') AS a1 \gset
SELECT pg_temp.chk('archive a BOM = UPDATE retired_at', :'a1'='00000' AND (SELECT retired_at IS NOT NULL FROM public.bom_definitions WHERE key='T-10'));
SELECT pg_temp.chk('archived BOM keeps its checklist link', (SELECT bom_key FROM public.checklist_templates WHERE name='T-10 check')='T-10');
SELECT pg_temp.try('UPDATE public.bom_definitions SET retired_at=NULL, replaced_by=NULL WHERE key=''T-10''') AS a2 \gset
SELECT pg_temp.chk('restore a BOM = retired_at NULL', :'a2'='00000' AND (SELECT retired_at IS NULL FROM public.bom_definitions WHERE key='T-10'));
SELECT pg_temp.chk('archive / restore an item = is_active false / true',
  pg_temp.try('UPDATE public.items SET is_active=false, deactivated_at=now() WHERE code=''X2''')='00000'
  AND pg_temp.try('UPDATE public.items SET is_active=true, deactivated_at=NULL WHERE code=''X2''')='00000');
SELECT pg_temp.chk('switch a checklist off / on', pg_temp.try('UPDATE public.checklist_templates SET active=false')='00000' AND pg_temp.try('UPDATE public.checklist_templates SET active=true')='00000');
SELECT pg_temp.try('UPDATE public.bom_definitions SET key=''T-11'' WHERE key=''T-10''') AS a3 \gset
SELECT pg_temp.chk('BOM rename still cascades to checklist_templates.bom_key (ON UPDATE CASCADE kept)', :'a3'='00000' AND (SELECT bom_key FROM public.checklist_templates WHERE name='T-10 check')='T-11');

-- ── 4. FK: SET NULL → RESTRICT ─────────────────────────────────────────────
SELECT pg_temp.chk('checklist_templates_bom_key_fkey is ON UPDATE CASCADE ON DELETE RESTRICT',
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='checklist_templates_bom_key_fkey' AND conrelid='public.checklist_templates'::regclass)
    = 'FOREIGN KEY (bom_key) REFERENCES bom_definitions(key) ON UPDATE CASCADE ON DELETE RESTRICT'
  AND (SELECT convalidated FROM pg_constraint WHERE conname='checklist_templates_bom_key_fkey'));
-- Even with the emergency setting on, a BOM that still has checklists cannot be
-- deleted (RESTRICT) — the checklists would otherwise be unlinked again.
SELECT pg_temp.chk('emergency DELETE of a BOM with checklists is refused by the FK (23503)',
  pg_temp.try('DO $d$ BEGIN PERFORM set_config(''app.allow_hard_delete'',''on'',true); DELETE FROM public.bom_definitions WHERE key=''T-11''; END $d$') LIKE '23503%'
  AND (SELECT count(*) FROM public.bom_definitions WHERE key='T-11')=1);

-- ── 5. Emergency escape hatch (deliberate admin script) ────────────────────
SELECT pg_temp.try('DO $d$ BEGIN PERFORM set_config(''app.allow_hard_delete'',''on'',true); DELETE FROM public.bom_definitions WHERE key=''T-20''; END $d$') AS a4 \gset
SELECT pg_temp.chk('with app.allow_hard_delete=on a deliberate DELETE works (T-20 has no checklists)', :'a4'='00000' AND (SELECT count(*) FROM public.bom_definitions WHERE key='T-20')=0);
SELECT pg_temp.chk('the setting is transaction-local (next statement is guarded again)',
  pg_temp.try('DELETE FROM public.vendors') LIKE '23514%');
SELECT pg_temp.chk('authenticated users cannot change the guard (function owned by postgres, no privilege to drop triggers)',
  pg_temp.as_user(:SA,'ALTER TABLE public.items DISABLE TRIGGER items_no_hard_delete') <> '00000');

-- ── 6. Sanctioned machine removals still work, with a full snapshot ────────
SELECT pg_temp.as_user(:SA, 'SELECT public.delete_machine_super_admin(701, ''070 test'')') AS r1 \gset
SELECT pg_temp.chk('Super Admin machine delete still works (' || :'r1' || ')', :'r1'='00000' AND (SELECT count(*)=0 FROM public.machine_log WHERE id=701));
SELECT pg_temp.chk('its audit row holds the machine AND every linked row',
  (SELECT old_value->>'serial_no' FROM public.audit_log WHERE type='machine_deleted' AND (details->>'machine_id')='701')='SN-701'
  AND (SELECT jsonb_array_length(details->'linked_rows_snapshot'->'handover_events') FROM public.audit_log WHERE type='machine_deleted' AND (details->>'machine_id')='701')=1
  AND (SELECT jsonb_array_length(details->'linked_rows_snapshot'->'pending_handover_items') FROM public.audit_log WHERE type='machine_deleted' AND (details->>'machine_id')='701')=1
  AND (SELECT jsonb_array_length(details->'linked_rows_snapshot'->'checklist_responses') FROM public.audit_log WHERE type='machine_deleted' AND (details->>'machine_id')='701')=1);
SELECT pg_temp.chk('Admin still cannot call the Super Admin delete', pg_temp.as_user(:ADM,'SELECT public.delete_machine_super_admin(1)') LIKE '42501%');

-- Remove From Rack (undo a BOM issue): stock goes back, rows are snapshotted.
INSERT INTO public.outward_log (id, event_date, type, ref, serial_no, items)
 VALUES (7101, current_date, 'bom', 'T-11', 'SN-702', '[{"code":"X1","issueQty":3}]');
UPDATE public.outward_log SET issue_id = 7101 WHERE id = 7101;
INSERT INTO public.pending_log (issue_id, bom_key, code, pending_qty, serial_no) VALUES (7101, 'T-11', 'X2', 2, 'SN-702');
INSERT INTO public.machine_log (id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department,issue_id) VALUES
 (702,'T-11','Test','SN-702','BOM Issued','active',current_date,'[]','Assembly',7101);
SELECT pg_temp.as_user(:SA, 'SELECT public.rack_remove_machine(702)') AS r2 \gset
SELECT pg_temp.chk('Remove From Rack still works (' || :'r2' || ')', :'r2'='00000' AND (SELECT count(*)=0 FROM public.machine_log WHERE id=702));
SELECT pg_temp.chk('stock returned once (X1 10 → 13)', (SELECT stock FROM public.items WHERE code='X1')=13);
SELECT pg_temp.chk('snapshot audit row holds machine, outward and pending rows',
  (SELECT old_value->>'serial_no' FROM public.audit_log WHERE type='machine_rack_remove_snapshot')='SN-702'
  AND (SELECT jsonb_array_length(details->'outward_rows') FROM public.audit_log WHERE type='machine_rack_remove_snapshot')=1
  AND (SELECT jsonb_array_length(details->'pending_rows') FROM public.audit_log WHERE type='machine_rack_remove_snapshot')=1);
SELECT pg_temp.chk('retry is idempotent (already_removed, no second stock credit)',
  pg_temp.as_user(:SA, 'SELECT public.rack_remove_machine(702)')='00000' AND (SELECT stock FROM public.items WHERE code='X1')=13);
SELECT pg_temp.chk('after the functions, the guard is on again (DELETE machine_log refused)',
  (SELECT count(*) FROM public.machine_log)=0 OR pg_temp.try('DELETE FROM public.machine_log') LIKE '23514%');
SELECT pg_temp.chk('anon cannot call rack_remove_machine / delete_machine_super_admin',
  NOT has_function_privilege('anon','public.rack_remove_machine(bigint)','EXECUTE') AND NOT has_function_privilege('anon','public.delete_machine_super_admin(bigint,text)','EXECUTE'));

SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
