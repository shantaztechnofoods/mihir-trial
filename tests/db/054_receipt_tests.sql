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
INSERT INTO public.items (code,name,category,unit,stock,min_stock) VALUES ('GBX-T','Gearbox T','Mech','Nos',10,1);
INSERT INTO public.machine_log (id,issue_id,bom_key,bom_label,serial_no,stage,status,created_date,history,current_department)
 VALUES (101,NULL,'M-10','Kneading','SN-A1','Assembly','active',current_date,'[]','Assembly');
-- job 1: 100 gearboxes pending (in Item Master);  job 2: manual critical item, not in Item Master;
-- job 3: critical gearbox with serial verification;  job 4: quantity-less job
INSERT INTO public.pending_handover_items (id,machine_id,raised_in_department,assigned_department,description,kind,item_code,item_name,qty,critical,source,raised_by)
 VALUES (1,101,'Assembly','Stores','Missing gearbox','owed','GBX-T','Gearbox T',100,false,'bom_outward',:SA),
        (2,101,'Assembly','Stores','Loose cover','owed',NULL,'Cover plate',10,true,'bom_outward',:SA),
        (3,101,'Assembly','Stores','Serial gearbox','owed','GBX-T','Gearbox T',2,true,'bom_outward',:SA),
        (4,101,'Assembly','Stores','Fit label','owed',NULL,NULL,NULL,false,NULL,:SA);

-- ── partial receipt: 100 pending, 50 received ────────────────────────────────
SELECT pg_temp.chk('staff receives 50 of 100', pg_temp.q_user(:MEC, $q$SELECT (public.receive_pending_part(1, 50, 'first lot', '{"kind":"checkbox","verified":true}', 'Mechanical')->>'remaining_qty')$q$) = '50');
SELECT pg_temp.chk('stock inwarded by exactly 50', (SELECT stock=60 FROM public.items WHERE code='GBX-T'));
SELECT pg_temp.chk('job keeps 50 pending and stays open (not received)', (SELECT received_qty=50 AND received_at IS NULL AND status='open' AND qty=100 FROM public.pending_handover_items WHERE id=1));
SELECT pg_temp.chk('receipt row has qty, employee, remaining, department, verification',
  (SELECT qty_received=50 AND remaining_qty=50 AND received_by=:MEC AND received_in_department='Mechanical' AND stock_inwarded AND stock_after=60 AND verification->>'kind'='checkbox' FROM public.pending_item_receipts WHERE pending_item_id=1));
SELECT pg_temp.chk('ledger shows a purchase_in of 50 referencing the receipt',
  EXISTS (SELECT 1 FROM public.stock_movements m JOIN public.pending_item_receipts r ON m.reference_id=r.id::text WHERE m.movement_type='purchase_in' AND m.qty=50 AND m.reference_type='pending_receipt' AND r.pending_item_id=1));
SELECT pg_temp.chk('cannot receive more than remaining', pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(1, 51)') LIKE '22023%');
SELECT pg_temp.chk('rejected over-receipt moved no stock', (SELECT stock=60 FROM public.items WHERE code='GBX-T'));
SELECT pg_temp.chk('zero / negative / null quantity refused',
  pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(1, 0)') LIKE '22023%' AND pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(1, -5)') LIKE '22023%' AND pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(1, NULL)') LIKE '22023%');
SELECT pg_temp.q_user(:ASM, $q$SELECT (public.receive_pending_part(1, 50, NULL, '{"kind":"checkbox","verified":true}', 'Assembly')->>'fully_received')$q$) AS r1 \gset
SELECT pg_temp.chk('second receipt (50) completes receiving and sets the received fields',
  :'r1' = 'true'
  AND (SELECT received_qty=100 AND received_at IS NOT NULL AND received_by=:ASM AND status='open' FROM public.pending_handover_items WHERE id=1)
  AND (SELECT stock=110 FROM public.items WHERE code='GBX-T'));
SELECT pg_temp.chk('both receipts remain, in order', (SELECT count(*)=2 AND min(remaining_qty)=0 AND max(remaining_qty)=50 FROM public.pending_item_receipts WHERE pending_item_id=1));
SELECT pg_temp.chk('fully received job refuses a third receipt (no double inward)', pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(1, 1)') LIKE '42501%' AND (SELECT stock=110 FROM public.items WHERE code='GBX-T'));

-- ── append-only ─────────────────────────────────────────────────────────────
SELECT pg_temp.chk('staff cannot edit a receipt', pg_temp.as_user(:MEC, 'UPDATE public.pending_item_receipts SET qty_received=1') LIKE '42501%');
SELECT pg_temp.chk('admin cannot delete a receipt', pg_temp.as_user(:ADM, 'DELETE FROM public.pending_item_receipts') LIKE '42501%');
SELECT pg_temp.chk('nobody can insert a receipt directly', pg_temp.as_user(:SA, $q$INSERT INTO public.pending_item_receipts(pending_item_id,machine_id,qty_received) VALUES (1,101,5)$q$) LIKE '42501%');
SELECT pg_temp.chk('receipts survive: still 2 rows', (SELECT count(*)=2 FROM public.pending_item_receipts WHERE pending_item_id=1));

-- ── critical items ──────────────────────────────────────────────────────────
SELECT pg_temp.chk('critical job refuses a receipt without verification', pg_temp.as_user(:MEC, 'SELECT public.receive_pending_part(2, 4)') LIKE '22023%');
SELECT pg_temp.q_user(:MEC, $q$SELECT (public.receive_pending_part(2, 4, 'part', '{"kind":"checkbox","critical":true,"verified":true,"serials":["C-1","C-2"]}', 'Stores')->>'stock_inwarded')$q$) AS r2 \gset
SELECT pg_temp.chk('manual critical item (not in Item Master): partial receipt, no stock row touched',
  :'r2' = 'false'
  AND (SELECT remaining_qty=6 AND NOT stock_inwarded AND stock_after IS NULL FROM public.pending_item_receipts WHERE pending_item_id=2));
SELECT pg_temp.chk('same serial cannot be reused on a later receipt', pg_temp.as_user(:MEC, $q$SELECT public.receive_pending_part(2, 1, NULL, '{"kind":"checkbox","verified":true,"serials":["c-1"]}')$q$) LIKE '22023%');
SELECT pg_temp.chk('serial kind: count must equal quantity', pg_temp.as_user(:MEC, $q$SELECT public.receive_pending_part(3, 2, NULL, '{"kind":"serial","serials":["G-1"]}')$q$) LIKE '22023%');
SELECT pg_temp.chk('serial kind: duplicates inside one receipt refused', pg_temp.as_user(:MEC, $q$SELECT public.receive_pending_part(3, 2, NULL, '{"kind":"serial","serials":["G-1","g-1"]}')$q$) LIKE '22023%');
SELECT pg_temp.as_user(:MEC, $q$SELECT public.receive_pending_part(3, 2, NULL, '{"kind":"serial","serials":["G-1","G-2"]}')$q$) AS r3 \gset
SELECT pg_temp.chk('serial kind: valid receipt stores serials and inwards 2',
  :'r3' = '00000'
  AND (SELECT verification->'serials' = '["G-1","G-2"]'::jsonb FROM public.pending_item_receipts WHERE pending_item_id=3) AND (SELECT stock=112 FROM public.items WHERE code='GBX-T'));

-- ── quantity-less job, permissions, completion ──────────────────────────────
SELECT pg_temp.q_user(:MEC, $q$SELECT (public.receive_pending_part(4, 1)->>'fully_received')$q$) AS r4 \gset
SELECT pg_temp.chk('job without a quantity: one receipt completes the receive step', :'r4' = 'true');
INSERT INTO public.pending_handover_items (id,machine_id,assigned_department,description,kind,item_code,qty,raised_by) VALUES (5,101,'Stores','Another gearbox','owed','GBX-T',5,:SA);
SELECT pg_temp.chk('store manager (no Finish & Transfer permission) cannot receive', pg_temp.as_user(:STO, 'SELECT public.receive_pending_part(5, 1)') LIKE '42501%');
SELECT pg_temp.chk('disabled user cannot receive', pg_temp.as_user(:DIS, 'SELECT public.receive_pending_part(5, 1)') LIKE '42501%');
SELECT pg_temp.chk('anon cannot call the function', pg_temp.as_user('', 'SELECT public.receive_pending_part(5, 1)') LIKE '42501%');
SELECT pg_temp.q_user('', 'SELECT count(*)::text FROM public.pending_item_receipts') AS an, pg_temp.q_user(:MEC, 'SELECT count(*)::text FROM public.pending_item_receipts') AS st \gset
SELECT pg_temp.chk('anon sees no receipts; active staff does', :'an' IN ('0','ERR 42501') AND :'st'::int > 0);
SELECT pg_temp.as_user(:MEC, $q$UPDATE public.pending_handover_items SET status='resolved', resolved_at=now(), resolved_by=auth.uid(), resolved_in_department='Mechanical', resolution_notes='fitted' WHERE id=2$q$) AS r5 \gset
SELECT pg_temp.chk('partly received job can still be marked completed (existing step), receipts intact',
  :'r5' = '00000'
  AND (SELECT status='resolved' AND received_qty=4 FROM public.pending_handover_items WHERE id=2) AND (SELECT count(*)=1 FROM public.pending_item_receipts WHERE pending_item_id=2));
SELECT pg_temp.chk('completed job refuses further receipts', pg_temp.as_user(:MEC, $q$SELECT public.receive_pending_part(2, 1, NULL, '{"kind":"checkbox","verified":true}')$q$) LIKE '42501%');
SELECT pg_temp.chk('staff still cannot edit job quantity or received_qty directly',
  pg_temp.as_user(:MEC, 'UPDATE public.pending_handover_items SET qty=1 WHERE id=5') LIKE '42501%' OR pg_temp.as_user(:MEC, 'UPDATE public.pending_handover_items SET received_qty=5 WHERE id=5') LIKE '42501%');

SELECT 'FAILED: ' || count(*) FROM t_results WHERE NOT ok;
SELECT 'PASSED: ' || count(*) FROM t_results WHERE ok;
