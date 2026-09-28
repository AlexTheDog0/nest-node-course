#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
: "${DATABASE_URL:=${DB_URL:-}}"
: "${DATABASE_URL:?Use with-secrets.sh or export DATABASE_URL/DB_URL}"
DEST="${BACKUP_DIR:-$PWD/backups}"
# Date-first names sort chronologically; only completed .dump files are eligible.
LATEST="$(find "$DEST" -maxdepth 1 -type f -name 'marketplace-*.dump' | LC_ALL=C sort | tail -n 1)"
[ -n "$LATEST" ] || { echo 'No completed backup found' >&2; exit 1; }
BASE="${LATEST%.dump}"
test -f "$BASE.checks.sql" && test -f "$BASE.expected.txt"
now_ms() { node -p 'Date.now()'; }
START=$(now_ms)
NAME="hw15-drill-$(date -u +%Y%m%d%H%M%S)-$$-$RANDOM"
CREATED=0
cleanup() {
  if [ "$CREATED" = 1 ]; then docker rm -fv "$NAME" >/dev/null; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# No host ports and no reused storage. tmpfs is empty on every invocation.
docker create --name "$NAME" --network none \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore \
  postgres:17 >/dev/null
CREATED=1
docker start "$NAME" >/dev/null
READY=0
for ((i=0; i<60; i++)); do
  if docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres -d restore >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[ "$READY" = 1 ] || { echo 'Restore database did not become ready' >&2; exit 1; }
RESTORE_START=$(now_ms)
docker exec -i "$NAME" pg_restore --exit-on-error --no-owner --no-acl -U postgres -d restore < "$LATEST"
RESTORE_END=$(now_ms)
RESTORE_SECONDS=$(awk "BEGIN {printf \"%.3f\", ($RESTORE_END - $RESTORE_START) / 1000}")
ACTUAL="$(docker exec -i "$NAME" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d restore < "$BASE.checks.sql")"
EXPECTED="$(cat "$BASE.expected.txt")"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  printf 'MISMATCH\nExpected:\n%s\nActual:\n%s\n' "$EXPECTED" "$ACTUAL" >&2
  exit 1
fi
END=$(now_ms)
RTO_SECONDS=$(awk -v start="$START" -v end="$END" 'BEGIN {printf "%.3f", (end-start)/1000}')
printf 'MATCH\n%s\nDump: %s\nBytes: %s\nRestore: %s seconds\nRTO: %s seconds\n' \
  "$ACTUAL" "$LATEST" "$(wc -c < "$LATEST" | tr -d ' ')" "$RESTORE_SECONDS" "$RTO_SECONDS"
