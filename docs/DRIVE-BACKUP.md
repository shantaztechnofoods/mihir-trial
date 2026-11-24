# Google Drive backup

Every day at **1:00 PM and 9:00 PM IST**, and whenever a Super Admin presses
**Settings → Data & Backup → Back up now**, the ERP copies all its data into a
private Google Drive folder. The ERP data is only read, never changed.

## What lands in Drive

```
SHANTAZ ERP Backup (Trial)/
  README.txt · _Backup Log.xlsx
  01 Machine Tracker/  Machine Tracker MASTER.xlsx
     Machines/<serial> (id N)/  Activity.xlsx + Photos/ Videos/ Voice notes/ Files/
  02 Item Master/      MASTER + Item photos and files/
  03 Inward Outward Stock/ · 04 Purchase and Vendors/ · 05 BOM and Checklists/ (+ BOM photos)
  06 Pending Stock/ · 07 Audit Trail/ · 08 Users and Settings/ · 09 Other/ (any new table)
  Snapshots/<YYYY-MM-DD HHmm (auto|manual)>/   dated copies of every MASTER (90 days, then Drive trash)
  _Raw data (JSON)/    exact copy of every table (for restore)
```

* MASTER files are overwritten each run, so their links stay the same. Snapshots keep the history.
* Photos, videos, voice notes and PDFs are uploaded once. `backup_files` remembers what was already copied.
* Secret keys in Settings (WhatsApp, Gemini and Anthropic keys, tokens, passwords) are hidden.
* The same tree is saved as a ZIP in the private `erp-backups` Storage bucket (the latest 3 are kept). It is used by **Download latest (ZIP)**.
* **Local copy:** install *Google Drive for desktop* on the office PC and sign in with the same Google account. The backup folder then syncs to the PC automatically.

## How it works

| Piece | Where |
|---|---|
| Job (Node, ExcelJS) | `scripts/drive-backup/backup.mjs`, `lib.mjs` (pure helpers, tested) |
| Schedule + on-demand run | `.github/workflows/drive-backup.yml` (cron 07:30 and 15:30 UTC) |
| Tables, bucket | `supabase/migrations/071_drive_backup.sql` |
| Connect / Back up now / Download / token | edge function `supabase/functions/drive-backup` (**deploy with verify_jwt = false**; it checks Super Admin itself) |
| Settings UI | `src/modules/settings/DriveBackupPanel.jsx` |

Google access uses the narrow `drive.file` scope, so the job can only see files it created.

## One-time setup (per ERP: Trial now, Live later with its own values)

1. **Google Cloud console** (signed in as the Drive owner):
   1. Create a new project.
   2. Enable the **Google Drive API**.
   3. Set up the **OAuth consent screen**: External, with app name, support email and the scope `.../auth/drive.file`. Then **Publish app → In production**. If you skip publishing, Google stops the connection every 7 days.
   4. Go to **Credentials → Create OAuth client ID → Web application**. Add this authorised redirect URI: `https://<project-ref>.supabase.co/functions/v1/drive-backup`
2. **GitHub:** create a fine-grained personal access token limited to this repository, with **Actions: Read and write**. Under repo **Settings → Secrets and variables → Actions**, add the secret `SUPABASE_SERVICE_ROLE_KEY`.
3. **Supabase → Edge Functions → Secrets:** add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GITHUB_BACKUP_TOKEN`. For Live, also add `GITHUB_REPO` and `APP_URL`.
4. **ERP → Settings → Data & Backup → Connect Google Drive**, then press **Allow**.
5. Press **Back up now** once and check the Drive folder.

## Not included yet

* The customer report, factory report and trial certificate PDFs per machine. The ERP draws these in the browser and does not store them as files, so the job would need a headless browser to render them. This is the planned next step. Everything those reports show is already in each machine's Activity.xlsx.
* GitHub can start scheduled runs 10–30 minutes late when it is busy.
