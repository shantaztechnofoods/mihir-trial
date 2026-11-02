-- ════════════════════════════════════════════════════════════════════════════
-- 059 — Fix user creation (service-role recognition) + Department Staff role
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Bug: the admin-create-user Edge Function writes the new profile with the
--    service-role key, but users_update_guard (053) did not recognise that call
--    as a service call — PostgREST now publishes the verified token only as
--    request.jwt.claims (JSON), while is_service_caller() looked at the old
--    request.jwt.claim.role setting. The upsert was therefore judged an ordinary
--    unprivileged update and refused with "Only your name and mobile number can
--    be changed here", leaving the new login disabled with no access.
--    is_service_caller() now also accepts the JSON claim and the service_role
--    database role itself. Neither can be set by a browser user: the claim comes
--    from the verified JWT and the role from the key used.
-- 2. Adds the 'dept_staff' role ("Department Staff") the short Add New User
--    form assigns: Production's floor permissions (Accept, Finish & Transfer,
--    Part Received, Work Completed) WITHOUT BOM issuing; no admin rights.
--    Existing roles are untouched (ON CONFLICT DO NOTHING).
-- Additive. Rollback: 059_service_caller_and_dept_staff_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.is_service_caller() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      OR current_user = 'service_role'
      OR (session_user <> 'authenticator'
          AND COALESCE(current_setting('request.jwt.claim.sub', true), '') = ''
          AND COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '') = '');
$$;

INSERT INTO public.roles (key, label, icon, color, badge, pages, actions, is_system)
VALUES ('dept_staff', 'Department Staff', '🛠️', '#0f766e', 'Department Staff',
        '["machines"]'::jsonb,
        '{"inventory":{"add":false,"edit":false,"delete":false,"adjust":false},
          "pipeline":{"create":false,"approve":false,"reject":false,"ordered":false,"receive":false,"delete":false},
          "outward":{"bom":false,"manual":false,"editBOM":false},
          "machines":{"updateStage":false,"finishTransfer":true,"accept":true,"configDept":false},
          "vendors":{"add":false,"edit":false,"delete":false},
          "inward":{"submit":false},
          "pending":{"fulfill":true,"clear":false},
          "users":{"view":false,"create":false,"edit":false,"delete":false},
          "roles":{"view":false,"create":false,"edit":false,"delete":false}}'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

COMMIT;
