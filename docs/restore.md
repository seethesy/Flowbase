# Backups and restore

Source: [FLOW-30](https://sybertechlabs.atlassian.net/browse/FLOW-30). Supabase Free keeps no backups, so Flowbase dumps production every night to the R2 bucket `flowbase-backups` (ADR-22). The job runs from the private ops repo, never from Flowbase's own Actions (ADR-26).

## What a backup contains

- `scripts/backup.sh` runs `pg_dump` in custom format (compressed) against `DATABASE_URL` and uploads it as `production/flowbase-<UTC time>.dump`, for example `production/flowbase-2026-10-22T071503Z.dump`.
- It dumps the `public` schema (application tables) and the `drizzle` schema (migration history). Supabase-managed schemas (`auth`, `storage`, extensions) are not included; the target Supabase project provides them. Once Google sign-in (FLOW-36) stores users in Supabase Auth, revisit whether `auth` data must be backed up too.
- If `pg_dump` fails or writes an empty file, the script exits non-zero and uploads nothing.
- After a successful upload, it deletes only its own dumps (`flowbase-<time>.dump` keys under the prefix) whose name time is more than 30 days old. Other objects in the bucket are never touched. The date logic is in `scripts/backup-retention.mjs`.

## Set up the nightly job (developer, once)

1. In Cloudflare, create an R2 API token with **Object Read & Write** on `flowbase-backups` only. Note the access key ID and secret.
2. In the private ops repo, add these Actions secrets (names exactly as below):

   | Secret | Value |
   | --- | --- |
   | `FLOWBASE_READ_TOKEN` | Fine-grained PAT with read-only access to `seethesy/Flowbase` contents. The collector uses the same secret (`collector/README.md`). |
   | `FLOWBASE_PROD_DATABASE_URL` | `flowbase-prod` connection string. GitHub runners have no IPv6, so use the session pooler string. |
   | `R2_ACCOUNT_ID` | Cloudflare account ID |
   | `R2_BACKUP_ACCESS_KEY_ID` | R2 token access key ID |
   | `R2_BACKUP_SECRET_ACCESS_KEY` | R2 token secret |

3. Make sure the `ops-v1` tag exists in Flowbase (see [Update the scripts the ops repo runs](#update-the-scripts-the-ops-repo-runs)).
4. Copy `ops-templates/backup.yml` from Flowbase `main` to `.github/workflows/backup.yml` in the ops repo and commit it.
5. Run it once with **Run workflow**, then confirm a new `production/flowbase-*.dump` object in the bucket.

The job runs nightly at 07:15 UTC and uses about 2 Actions minutes per run from the shared 2,000 free minutes.

## Update the scripts the ops repo runs

The ops workflows (`backup.yml` and `collector.yml`) check out Flowbase at the tag `ops-v1`, not `main` (FLOW-175). They run with production secrets, so a merged change to `scripts/backup.sh`, `scripts/backup-retention.mjs` or `collector/` reaches them only when you move the tag after reviewing it.

1. Review what changed since the tag: `git fetch origin --tags && git diff ops-v1 origin/main -- scripts/ collector/ package.json package-lock.json`.
2. Move the tag to the reviewed commit and push it:

   ```sh
   git tag -f ops-v1 <reviewed commit on main>
   git push origin -f refs/tags/ops-v1
   ```

3. Start each workflow once with **Run workflow** in the ops repo and check it passes.

To create the tag the first time, run step 2 with the current `main` commit. If a template in `ops-templates/` itself changed, copy it to the ops repo again too.

## Restore into a Supabase project

Always restore into a new Supabase project (or one with no Flowbase tables yet), for drills and for real recovery alike. To recover production, restore into a new project and then point Flowbase at it (step 6). The damaged project stays untouched, so you can still copy data out of it.

1. **Pick the dump.** In the Cloudflare dashboard, open R2 → `flowbase-backups` → `production/` and download the newest `flowbase-*.dump` (or the last one before the incident). With the AWS CLI and an R2 token:

   ```sh
   aws s3 cp s3://flowbase-backups/production/<file>.dump . \
     --endpoint-url https://<account-id>.r2.cloudflarestorage.com
   ```

2. **Check the file.** `pg_restore --list <file>.dump | head` must list Flowbase tables. Use `pg_restore` 17 or newer.
3. **Get the target connection string.** In the target Supabase project, open **Connect** and copy the session pooler string (or the direct string if your machine has IPv6). Call it `TARGET_URL`.
4. **Restore:**

   ```sh
   pg_restore --no-owner --no-privileges --dbname "$TARGET_URL" <file>.dump
   ```

   A message that schema `public` already exists is expected, because every Supabase project has one. Any other error means the restore is incomplete. If that happens, delete and recreate the target project, fix the cause and start again from step 3.

5. **Verify:**
   - `psql "$TARGET_URL" -c 'select count(*) from drizzle.__drizzle_migrations'` equals the number of entries in `drizzle/meta/_journal.json` on `main`.
   - Spot-check row counts of the main tables against what you expect.
   - Every restored table still has RLS on: `select relname from pg_class join pg_namespace n on n.oid = relnamespace where nspname = 'public' and relkind = 'r' and not relrowsecurity;` returns no rows.
6. **Point the Worker at it** (only when the restored project replaces production): update the production Hyperdrive config with the new connection string (`npx wrangler hyperdrive update d6486e8ab1314d8ca1dbf5addf1036d0 --connection-string "<string>"`), update the `DATABASE_URL` build variable in Workers Builds and `FLOWBASE_PROD_DATABASE_URL` in the ops repo, then check `/api/health` reports `database: "reachable"`.

The restore drill before go-live is tracked in FLOW-35.
