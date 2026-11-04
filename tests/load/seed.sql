-- Synthetic data for the LOCAL 300-user load test (tests/load/setup-db.sh).
-- Roughly one busy production year. NO real names, NO production data —
-- every value is generated. Never run against Supabase.
--
-- 300 users: 1 super_admin, 4 Admin, 10 Production Head, 30 Production,
--            10 Store Manager, 5 Purchase Manager, 240 dept_staff (60 per dept)
-- 2,000 items · 60 BOMs · 3,000 machines (history jsonb) · 12,000 hand-overs
-- 4,000 pending jobs + 2,000 receipts · 12,000 checklist responses
-- 9,000 ratings · 6,000 attachments · 1,500 POs · 6,000 inward · 3,000 outward
-- 20,000 stock movements · 1,000 pending_log · 200 vendors · 1,500 follow-ups
\set ON_ERROR_STOP on
SET client_min_messages = warning;
BEGIN;

-- ── users (auth.users → trigger creates public.users, then give real roles) ──
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'load' || g || '@example.test',
       jsonb_build_object('full_name', 'Load User ' || g)
FROM generate_series(1, 300) g;

UPDATE public.users u SET
  status = 'active',
  role_key = CASE
    WHEN n = 1 THEN 'super_admin'
    WHEN n <= 5 THEN 'Admin'
    WHEN n <= 15 THEN 'Production Head'
    WHEN n <= 45 THEN 'Production'
    WHEN n <= 55 THEN 'Store Manager'
    WHEN n <= 60 THEN 'Purchase Manager'
    ELSE 'dept_staff' END,
  departments = CASE WHEN n > 60
    THEN ARRAY[(ARRAY['Assembly','Mechanical','Electrical','Trial'])[1 + (n % 4)]]
    ELSE u.departments END
FROM (SELECT id, ('x' || right(id::text, 12))::bit(48)::bigint AS n FROM public.users) s
WHERE s.id = u.id;

-- ── master data ──
INSERT INTO public.vendors (name, category, city)
SELECT 'Vendor ' || g, (ARRAY['Steel','Electrical','Hardware','Motors'])[1 + g % 4], 'City ' || (g % 20)
FROM generate_series(1, 200) g;

INSERT INTO public.items (code, name, category, unit, stock, min_stock, max_stock, status, last_purchase_rate, is_active, gst_rate, vendor_links, trend)
SELECT 'IT-' || lpad(g::text, 5, '0'), 'Item ' || g, 'Cat ' || (g % 25), 'pcs',
       (g * 7) % 500, 10, 600, (ARRAY['safe','warning','critical'])[1 + g % 3], (g % 900) + 10,
       g % 50 <> 0, 18, '[]'::jsonb, '[]'::jsonb
FROM generate_series(1, 2000) g;

INSERT INTO public.bom_definitions (key, label, color, rack_capacity, items, dept_durations)
SELECT 'BOM-' || g, 'Machine model ' || g, '#336699', 10,
       (SELECT jsonb_agg(jsonb_build_object('code', 'IT-' || lpad(((g * 31 + k) % 2000 + 1)::text, 5, '0'), 'qty', 1 + k % 4))
          FROM generate_series(1, 40) k),
       '{"Assembly":480,"Mechanical":360,"Electrical":300,"Trial":240}'::jsonb
FROM generate_series(1, 60) g;

INSERT INTO public.checklist_templates (department, name, items, active, version, stage)
SELECT (ARRAY['Assembly','Mechanical','Electrical','Trial'])[1 + g % 4], 'Checklist ' || g,
       (SELECT jsonb_agg(jsonb_build_object('id', k, 'label', 'Check ' || k)) FROM generate_series(1, 12) k),
       true, 1, (ARRAY['before_receive','during_work','before_dispatch'])[1 + g % 3]
FROM generate_series(1, 60) g;

-- ── production ──
INSERT INTO public.machine_log (id, issue_id, bom_key, bom_label, serial_no, stage, status, created_date, history, created_at, current_department, department_entered_at)
SELECT g, g, 'BOM-' || (1 + g % 60), 'Machine model ' || (1 + g % 60), 'SN-' || g,
       st, CASE WHEN st = 'Ready' THEN 'completed' ELSE 'active' END,
       (now() - (g || ' hours')::interval)::date,
       (SELECT jsonb_agg(jsonb_build_object('stage', 'Assembly', 'at', now() - (k || ' hours')::interval, 'by', 'Load User ' || k, 'note', 'step ' || k))
          FROM generate_series(1, 20) k),
       now() - (g || ' hours')::interval,
       CASE WHEN st IN ('Ready', 'BOM Issued') THEN NULL ELSE st END,
       now() - ((g % 48) || ' hours')::interval
FROM (SELECT g, CASE WHEN g <= 2400 THEN 'Ready' ELSE (ARRAY['BOM Issued','Assembly','Mechanical','Electrical','Trial'])[1 + g % 5] END AS st
        FROM generate_series(1, 3000) g) s;
SELECT setval(pg_get_serial_sequence('public.machine_log', 'id'), 3000);

INSERT INTO public.handover_events (machine_id, bom_key, serial_no, from_department, to_department, sent_by, sent_at,
                                    expected_duration_minutes, actual_duration_minutes, accept_timeout_minutes, status, accepted_by, accepted_at)
SELECT m, 'BOM-' || (1 + m % 60), 'SN-' || m, f.fr, f.t,
       ('00000000-0000-4000-8000-' || lpad(to_hex(61 + (m * 4 + i) % 240), 12, '0'))::uuid,
       now() - ((m + i) || ' hours')::interval, 300, 280, 60,
       CASE WHEN m > 2950 AND i = 4 THEN 'pending' ELSE 'accepted' END,
       CASE WHEN m > 2950 AND i = 4 THEN NULL ELSE ('00000000-0000-4000-8000-' || lpad(to_hex(61 + (m * 4 + i + 1) % 240), 12, '0'))::uuid END,
       CASE WHEN m > 2950 AND i = 4 THEN NULL ELSE now() - ((m + i) || ' hours')::interval END
FROM generate_series(1, 3000) m
CROSS JOIN LATERAL (VALUES (1, 'Assembly', 'Mechanical'), (2, 'Mechanical', 'Electrical'),
                           (3, 'Electrical', 'Trial'), (4, 'Trial', 'Ready')) f(i, fr, t);

INSERT INTO public.pending_handover_items (machine_id, raised_in_department, raised_by, description, status, assigned_department, kind, item_code, qty, resolved_at, resolved_by)
SELECT 1 + (g * 7) % 3000, (ARRAY['Assembly','Mechanical','Electrical','Trial'])[1 + g % 4],
       ('00000000-0000-4000-8000-' || lpad(to_hex(61 + g % 240), 12, '0'))::uuid,
       'Pending part ' || g, CASE WHEN g % 3 = 0 THEN 'open' ELSE 'resolved' END,
       (ARRAY['Assembly','Mechanical','Electrical','Trial','Stores'])[1 + g % 5],
       CASE WHEN g % 2 = 0 THEN 'owed' ELSE 'fault' END, 'IT-' || lpad((1 + g % 2000)::text, 5, '0'), 1 + g % 5,
       CASE WHEN g % 3 = 0 THEN NULL ELSE now() END,
       CASE WHEN g % 3 = 0 THEN NULL ELSE ('00000000-0000-4000-8000-' || lpad(to_hex(61 + g % 240), 12, '0'))::uuid END
FROM generate_series(1, 4000) g;

INSERT INTO public.pending_item_receipts (pending_item_id, machine_id, item_code, qty_received, remaining_qty, received_in_department)
SELECT p.id, p.machine_id, p.item_code, 1, 0, p.assigned_department
FROM public.pending_handover_items p WHERE p.id % 2 = 0;

INSERT INTO public.checklist_responses (machine_id, department, template_id, template_version, template_name, answers, submitted_at, stage)
SELECT 1 + g % 3000, (ARRAY['Assembly','Mechanical','Electrical','Trial'])[1 + g % 4], 1 + g % 60, 1, 'Checklist',
       (SELECT jsonb_agg(jsonb_build_object('id', k, 'ok', true)) FROM generate_series(1, 12) k),
       now() - (g || ' minutes')::interval, 'during_work'
FROM generate_series(1, 12000) g;

INSERT INTO public.department_ratings (machine_id, department, rating, calculation_log)
SELECT 1 + g % 3000, (ARRAY['Assembly','Mechanical','Electrical'])[1 + g % 3], 1 + g % 5, '{}'::jsonb
FROM generate_series(1, 9000) g;

INSERT INTO public.machine_attachments (machine_id, department, kind, storage_path, file_name, mime_type)
SELECT 1 + g % 3000, (ARRAY['Assembly','Mechanical','Electrical','Trial'])[1 + g % 4], 'photo',
       'm/' || (1 + g % 3000) || '/' || g || '.jpg', g || '.jpg', 'image/jpeg'
FROM generate_series(1, 6000) g;

INSERT INTO public.pending_log (issue_id, bom_key, code, name, category, unit, pending_qty, issue_qty, serial_no, event_date)
SELECT 1 + g % 3000, 'BOM-' || (1 + g % 60), 'IT-' || lpad((1 + g % 2000)::text, 5, '0'), 'Item', 'Cat', 'pcs', 1 + g % 3, 2, 'SN-' || g, current_date
FROM generate_series(1, 1000) g;

-- ── purchase / stores ──
INSERT INTO public.purchase_orders (id, vendor, status, date, amount, priority, line_items, activity_log, created_at)
SELECT 'PO-' || g, 'Vendor ' || (1 + g % 200),
       (ARRAY['draft','pending','approved','ordered','received'])[1 + g % 5], current_date - (g % 365),
       1000 + g, 'normal',
       (SELECT jsonb_agg(jsonb_build_object('code', 'IT-' || lpad((1 + (g + k) % 2000)::text, 5, '0'), 'qty', k, 'rate', 100)) FROM generate_series(1, 6) k),
       '[]'::jsonb, now() - (g || ' hours')::interval
FROM generate_series(1, 1500) g;

INSERT INTO public.follow_ups (po_id, vendor, item_names, next_follow_up, frequency)
SELECT 'PO-' || g, 'Vendor ' || (1 + g % 200), '["Item"]'::jsonb, current_date + (g % 30), 3
FROM generate_series(1, 1500) g;

INSERT INTO public.inward_log (event_date, vendor, item_code, item_name, unit, qty, from_po, created_at)
SELECT current_date - (g % 365), 'Vendor ' || (1 + g % 200), 'IT-' || lpad((1 + g % 2000)::text, 5, '0'), 'Item', 'pcs', 1 + g % 20,
       'PO-' || (1 + g % 1500), now() - (g || ' minutes')::interval
FROM generate_series(1, 6000) g;

INSERT INTO public.outward_log (event_date, type, ref, label, units, items, created_at)
SELECT current_date - (g % 365), CASE WHEN g % 4 = 0 THEN 'manual' ELSE 'bom' END, 'OUT-' || g, 'Machine model', 1,
       (SELECT jsonb_agg(jsonb_build_object('code', 'IT-' || lpad((1 + (g + k) % 2000)::text, 5, '0'), 'qty', 1)) FROM generate_series(1, 40) k),
       now() - (g || ' minutes')::interval
FROM generate_series(1, 3000) g;

INSERT INTO public.stock_movements (item_code, item_name, movement_type, qty, before_stock, after_stock, reference_type, reference_id, created_at)
SELECT 'IT-' || lpad((1 + g % 2000)::text, 5, '0'), 'Item', (ARRAY['purchase_in','production_issue'])[1 + g % 2], 1, 10, 9, 'po', 'PO-' || (1 + g % 1500),
       now() - (g || ' minutes')::interval
FROM generate_series(1, 20000) g;

COMMIT;

SELECT 'seeded: users=' || (SELECT count(*) FROM public.users WHERE status = 'active')
    || ' items=' || (SELECT count(*) FROM public.items)
    || ' machines=' || (SELECT count(*) FROM public.machine_log)
    || ' handovers=' || (SELECT count(*) FROM public.handover_events)
    || ' pending_items=' || (SELECT count(*) FROM public.pending_handover_items)
    || ' checklist_responses=' || (SELECT count(*) FROM public.checklist_responses) AS summary;
