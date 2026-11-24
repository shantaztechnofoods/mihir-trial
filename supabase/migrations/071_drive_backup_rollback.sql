-- Rollback for 071_drive_backup.sql. Removes only what 071 added.
-- The erp-backups bucket is left in place if it still holds files (Storage
-- refuses to drop a non-empty bucket); empty it in the dashboard first.
BEGIN;
DROP TABLE IF EXISTS public.backup_files;
DROP TABLE IF EXISTS public.backup_secrets;
DROP TABLE IF EXISTS public.backup_runs;
DELETE FROM storage.buckets b
 WHERE b.id = 'erp-backups'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'erp-backups');
COMMIT;
