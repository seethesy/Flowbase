#!/usr/bin/env bash
# Nightly Postgres backup to R2 (FLOW-30, ADR-22). Runs from the private ops repo
# (ops-templates/backup.yml); see docs/restore.md. Never run it with secrets in
# this repo.
#
# Required environment:
#   DATABASE_URL          Postgres connection string to dump
#   R2_ACCOUNT_ID         Cloudflare account ID (for the R2 S3 endpoint)
#   R2_ACCESS_KEY_ID      R2 API token access key ID
#   R2_SECRET_ACCESS_KEY  R2 API token secret
# Optional:
#   R2_BUCKET             default flowbase-backups
#   BACKUP_PREFIX         key prefix inside the bucket, default production/
#   RETENTION_DAYS        default 30
#   PG_DUMP               pg_dump binary, default pg_dump (must match the server major version)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
bucket="${R2_BUCKET:-flowbase-backups}"
prefix="${BACKUP_PREFIX:-production/}"
retention_days="${RETENTION_DAYS:-30}"
pg_dump_bin="${PG_DUMP:-pg_dump}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
# R2 does not accept the AWS CLI's default extra checksums.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
name="flowbase-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
dump="$work_dir/$name"

# 1. Dump. Custom format is compressed (level 9) and restores with pg_restore.
# Only Flowbase's schemas: public (application tables) and drizzle (migration
# history). Supabase-managed schemas are recreated by the target project.
echo "Dumping database to $name"
if ! "$pg_dump_bin" --format=custom --compress=9 --no-owner --no-privileges \
  --schema=public --schema=drizzle --file="$dump" "$DATABASE_URL"; then
  echo "pg_dump failed; nothing was uploaded." >&2
  exit 1
fi
if [[ ! -s "$dump" ]]; then
  echo "pg_dump produced an empty file; nothing was uploaded." >&2
  exit 1
fi

# 2. Upload.
echo "Uploading s3://$bucket/$prefix$name"
aws s3 cp "$dump" "s3://$bucket/$prefix$name" --endpoint-url "$endpoint" --only-show-errors

# 3. Retention: only after a successful upload, only keys this script wrote.
keys="$(aws s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix" \
  --endpoint-url "$endpoint" --query 'Contents[].Key' --output text)"
[[ "$keys" == "None" ]] && keys=""
expired="$(printf '%s\n' "$keys" | tr '\t' '\n' |
  node "$script_dir/backup-retention.mjs" --days "$retention_days")"
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  echo "Deleting expired backup $key"
  aws s3 rm "s3://$bucket/$key" --endpoint-url "$endpoint" --only-show-errors
done <<< "$expired"
echo "Backup complete: $prefix$name"
