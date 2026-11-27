-- 073_security_hardening.sql — security audit 2026-11-27 (MIHIR TRIAL).
-- Additive / privilege-tightening only. No table, column or row is dropped or changed.
-- Rollback: 073_security_hardening_rollback.sql.

begin;

-- H1. v_dept_roster is a SECURITY DEFINER (owner postgres) auto-updatable view.
-- authenticated held INSERT/UPDATE/DELETE/TRUNCATE on it, so any signed-in user could
-- DELETE rows of public.users through it, bypassing users RLS (users_delete = super admin).
-- The app only SELECTs it (src/auth/authStore.js), so keep SELECT and revoke the rest.
revoke insert, update, delete, truncate, references, trigger on public.v_dept_roster from authenticated, anon, public;
grant select on public.v_dept_roster to authenticated;

-- M2. item-media storage bucket: stop anonymous listing and require an active ERP user to write.
-- Files stay reachable by their public URL (/storage/v1/object/public/...): a public bucket
-- serves those without any SELECT policy. The app uploads with upsert:false and deletes by path.
drop policy if exists item_media_public_read on storage.objects;
create policy item_media_auth_read on storage.objects for select to authenticated
  using (bucket_id = 'item-media' and (select public.is_active_user()));

drop policy if exists item_media_auth_upload on storage.objects;
create policy item_media_auth_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'item-media' and (select public.is_active_user()));

drop policy if exists item_media_auth_update on storage.objects;
create policy item_media_auth_update on storage.objects for update to authenticated
  using (bucket_id = 'item-media' and (select public.is_active_user()))
  with check (bucket_id = 'item-media' and (select public.is_active_user()));

drop policy if exists item_media_auth_delete on storage.objects;
create policy item_media_auth_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-media' and (select public.is_active_user()));

-- M3. Trigger / event-trigger functions are never meant to be called over /rest/v1/rpc.
-- (EXECUTE is only checked when a trigger is created, not when it fires.)
revoke execute on function public.handle_new_auth_user()       from public, anon, authenticated;
revoke execute on function public.machine_log_rack_set_guard() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable()            from public, anon, authenticated;

-- L1. Pin search_path on the 4 functions the advisor flags.
alter function public.set_updated_at()          set search_path = public, pg_temp;
alter function public.reject_audit_change()     set search_path = public, pg_temp;
alter function public.reject_immutable_change() set search_path = public, pg_temp;
alter function public.eff_dept(text)            set search_path = public, pg_temp;

-- L2. Leftover backup copies: no API role needs them (RLS already returns no rows).
do $$
begin
  if to_regclass('public.cleanup_backup_20261031') is not null then
    execute 'revoke all on public.cleanup_backup_20261031 from anon, authenticated';
  end if;
  if to_regclass('public.demo_cleanup_backup_20261102') is not null then
    execute 'revoke all on public.demo_cleanup_backup_20261102 from anon, authenticated';
  end if;
end $$;

commit;
