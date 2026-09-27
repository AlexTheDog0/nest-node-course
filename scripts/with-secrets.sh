#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_SLUG="${1:-dev}"; shift || true
[ "$#" -gt 0 ] || set -- npm run start

# The grader/CI already supplies database credentials in the environment.
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"
if [ -f "$CREDS" ]; then
  set -a
  source "$CREDS"
  set +a
fi
command -v infisical >/dev/null 2>&1 || {
  echo 'Install Infisical CLI; see README. CI may use SKIP_VAULT=1.' >&2
  exit 1
}
# Reuse the machine identity created by homework 11; never print its token.
if [ -z "${INFISICAL_TOKEN:-}" ] && [ -f "$ROOT/secrets/infisical/app-token" ]; then
  INFISICAL_TOKEN="$(cat "$ROOT/secrets/infisical/app-token")"
  export INFISICAL_TOKEN
fi
if [ -f "$ROOT/secrets/infisical/client.json" ]; then
  INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).projectId)' "$ROOT/secrets/infisical/client.json")}"
  INFISICAL_API_URL="${INFISICAL_API_URL:-$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).apiUrl)' "$ROOT/secrets/infisical/client.json")}"
fi
: "${INFISICAL_PROJECT_ID:?Set INFISICAL_PROJECT_ID or run npm run infisical:setup}"
: "${INFISICAL_TOKEN:?Set INFISICAL_TOKEN or run npm run infisical:setup}"
: "${INFISICAL_API_URL:?Set INFISICAL_API_URL or run npm run infisical:setup}"
exec infisical run --domain="$INFISICAL_API_URL" --projectId="$INFISICAL_PROJECT_ID" --env="$ENV_SLUG" --path="${INFISICAL_SECRET_PATH:-/hw13}" -- "$@"
