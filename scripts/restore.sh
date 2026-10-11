#!/usr/bin/env bash
# Usage: DATABASE_URL=postgresql://... bash scripts/restore.sh backups/kusbill-XXXX.dump
# Restores into an EMPTY database. It refuses to run against a database that already has KusBill tables.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
FILE="${1:?Give the path of a .dump file}"
URL="${DATABASE_URL%%\?*}"
if [ "$(psql "$URL" -Atc "select count(*) from information_schema.tables where table_name = 'Transaction'")" != "0" ]; then
  echo "Refusing to restore: this database already contains KusBill tables. Create a new empty database first." >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$URL" "$FILE"
echo "Restore complete."
