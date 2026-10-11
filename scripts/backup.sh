#!/usr/bin/env bash
# Usage: DATABASE_URL=postgresql://... bash scripts/backup.sh [output-dir]
# Writes a compressed, restorable PostgreSQL dump (custom format).
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
OUT="${1:-backups}"
mkdir -p "$OUT"
FILE="$OUT/kusbill-$(date +%Y%m%d-%H%M%S).dump"
# Strip Prisma's ?schema= parameter, which pg_dump does not understand.
URL="${DATABASE_URL%%\?*}"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$URL"
echo "Backup written to $FILE"
