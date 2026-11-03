-- Rollback for 060: removes the function only. Audit rows it wrote are kept.
DROP FUNCTION IF EXISTS public.delete_machine_super_admin(bigint, text);
