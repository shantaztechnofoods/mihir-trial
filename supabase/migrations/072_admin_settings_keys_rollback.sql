-- Rollback for 072_admin_settings_keys.sql — removes the Admin save function.
-- Saved values stay in the settings row; only Super Admin can save again.
DROP FUNCTION IF EXISTS public.save_org_setting(text, jsonb);
