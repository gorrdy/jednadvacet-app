#!/usr/bin/env bash
# Build + deploy the frontend to staging, restart staging backend, run
# the API test suite against staging. Does not touch production.
#
# This is the upstream maintainer's deploy script. To adapt to your own
# host, override the env vars (or just rewrite — it's short on purpose):
#
#   STAGING_DIST=/var/www/your-staging.example.com   \
#   STAGING_HOST=your-staging.example.com            \
#   STAGING_BACKEND_PORT=3022                        \
#   STAGING_SERVICE=your-backend-staging             \
#   STAGING_ADMIN_EMAIL=admin@example.com            \
#   STAGING_ADMIN_PASSWORD=your-test-password        \
#     ./scripts/deploy-staging.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"

STAGING_DIST="${STAGING_DIST:-/var/www/jednadvacet-test.gorrdy.cz}"
STAGING_HOST="${STAGING_HOST:-jednadvacet-test.gorrdy.cz}"
STAGING_BACKEND_PORT="${STAGING_BACKEND_PORT:-3022}"
STAGING_SERVICE="${STAGING_SERVICE:-jednadvacet-backend-staging}"

if [ -z "${STAGING_ADMIN_EMAIL:-}" ] || [ -z "${STAGING_ADMIN_PASSWORD:-}" ]; then
  echo "✖ STAGING_ADMIN_EMAIL and STAGING_ADMIN_PASSWORD must be set in your environment" >&2
  echo "  (e.g. export them in ~/.bashrc, or pass inline before the command)." >&2
  exit 1
fi

echo "▸ Building frontend (staging mode)…"
cd "$FRONTEND"
# Vite picks up .env.staging when --mode staging is used.
npx vite build --mode staging

echo "▸ Deploying to $STAGING_DIST…"
sudo rsync -a --delete dist/ "$STAGING_DIST/"

echo "▸ Restarting staging backend ($STAGING_SERVICE)…"
sudo systemctl restart "$STAGING_SERVICE"
sleep 2

echo "▸ Running API tests…"
cd "$BACKEND"
BASE="http://127.0.0.1:$STAGING_BACKEND_PORT" \
  ADMIN_EMAIL="$STAGING_ADMIN_EMAIL" \
  ADMIN_PASSWORD="$STAGING_ADMIN_PASSWORD" \
  node --test test/api.test.mjs

echo
echo "✔ Staging deploy complete."
echo "  → https://$STAGING_HOST"
echo
echo "When staging is good, promote to prod:  ./scripts/deploy-prod.sh"
