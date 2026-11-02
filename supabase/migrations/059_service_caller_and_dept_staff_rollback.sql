-- Rollback for 059. Only removes dept_staff if no user holds it.
BEGIN;
CREATE OR REPLACE FUNCTION public.is_service_caller() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      OR (session_user <> 'authenticator'
          AND COALESCE(current_setting('request.jwt.claim.sub', true), '') = '');
$$;
DELETE FROM public.roles WHERE key = 'dept_staff' AND NOT EXISTS (SELECT 1 FROM public.users WHERE role_key = 'dept_staff');
COMMIT;
