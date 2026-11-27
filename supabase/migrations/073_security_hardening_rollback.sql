-- Rollback for 073_security_hardening.sql (restores the 2026-11-27 state).
begin;
grant insert, update, delete, truncate, references, trigger on public.v_dept_roster to authenticated;

drop policy if exists item_media_auth_read   on storage.objects;
drop policy if exists item_media_auth_upload on storage.objects;
drop policy if exists item_media_auth_update on storage.objects;
drop policy if exists item_media_auth_delete on storage.objects;
create policy item_media_public_read on storage.objects for select to public using (bucket_id = 'item-media');
create policy item_media_auth_upload on storage.objects for insert to authenticated with check (bucket_id = 'item-media');
create policy item_media_auth_update on storage.objects for update to authenticated using (bucket_id = 'item-media') with check (bucket_id = 'item-media');
create policy item_media_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'item-media');

grant execute on function public.handle_new_auth_user()       to public, anon, authenticated;
grant execute on function public.machine_log_rack_set_guard() to public, anon, authenticated;
grant execute on function public.rls_auto_enable()            to public, anon, authenticated;

alter function public.set_updated_at()          reset search_path;
alter function public.reject_audit_change()     reset search_path;
alter function public.reject_immutable_change() reset search_path;
alter function public.eff_dept(text)            reset search_path;

do $$
begin
  if to_regclass('public.cleanup_backup_20261031') is not null then
    execute 'grant all on public.cleanup_backup_20261031 to anon, authenticated';
  end if;
  -- demo_cleanup_backup_20261102 had no anon/authenticated grants before 073: nothing to restore.
end $$;
commit;
