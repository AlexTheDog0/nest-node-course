#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
: "${DATABASE_URL:=${DB_URL:-}}"
: "${DATABASE_URL:?Use with-secrets.sh or export DATABASE_URL/DB_URL}"
# Host-side Compose endpoint becomes its service address inside the client container.
CONNECTION="${DATABASE_URL/@127.0.0.1:6432\//@pgbouncer:5432/}"
CONNECTION="${CONNECTION/@localhost:6432\//@pgbouncer:5432/}"
DEST="${BACKUP_DIR:-$PWD/backups}"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
NAME="marketplace-$(date -u +%Y-%m-%dT%H-%M-%SZ)-$$"
REMOTE="$(docker compose exec -T db mktemp -d /tmp/hw15-backup.XXXXXXXX)"
cleanup() { docker compose exec -T db rm -rf -- "$REMOTE" >/dev/null; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Export a snapshot and keep its transaction open while pg_dump imports it.
# The manifest is produced by that same snapshot, not by a later live query.
docker compose exec -T -e PGDATABASE="$CONNECTION" -e BACKUP_TEMP="$REMOTE" db bash -se <<'INNER'
set -euo pipefail
cd "$BACKUP_TEMP"
psql -d "$PGDATABASE" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snapshot \gset
\setenv SNAPSHOT :snapshot
\o checks.sql
SELECT format('SELECT %L || ''|'' || count(*)::text FROM %I.%I;', table_name, table_schema, table_name)
FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;
SELECT 'SELECT ''products_aggregate|'' || coalesce(sum(price_cents::numeric * stock),0)::text FROM public.products;'
WHERE to_regclass('public.products') IS NOT NULL;
\o
\o expected.txt
\i checks.sql
\o
\! pg_dump -d "$PGDATABASE" -Fc --snapshot="$SNAPSHOT" -f archive.dump && touch dump.ok
COMMIT;
SQL
test -f dump.ok
pg_restore --list archive.dump >/dev/null
INNER
# Publish the archive last: restore-drill never sees an unfinished backup.
docker compose cp "db:$REMOTE/checks.sql" "$DEST/$NAME.checks.sql" >/dev/null
docker compose cp "db:$REMOTE/expected.txt" "$DEST/$NAME.expected.txt" >/dev/null
docker compose cp "db:$REMOTE/archive.dump" "$DEST/$NAME.dump.partial" >/dev/null
chmod 600 "$DEST/$NAME."*
mv "$DEST/$NAME.dump.partial" "$DEST/$NAME.dump"
printf '%s\n' "$DEST/$NAME.dump"
