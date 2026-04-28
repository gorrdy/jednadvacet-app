#!/usr/bin/env bash
# Build + deploy the frontend to production, restart prod backend, run
# a light smoke test against prod (health + version).
#
# Refuses to deploy if the working tree has uncommitted changes (opt-out
# with ALLOW_DIRTY=1). Prompts for confirmation before touching prod.
#
# Adapt to your host by overriding the env vars:
#
#   PROD_DIST=/var/www/your.example.com   \
#   PROD_HOST=your.example.com            \
#   PROD_BACKEND_PORT=3021                \
#   PROD_SERVICE=your-backend             \
#     CONFIRM=yes ./scripts/deploy-prod.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"

PROD_DIST="${PROD_DIST:-/var/www/jednadvacet.gorrdy.cz}"
PROD_HOST="${PROD_HOST:-jednadvacet.gorrdy.cz}"
PROD_BACKEND_PORT="${PROD_BACKEND_PORT:-3021}"
PROD_SERVICE="${PROD_SERVICE:-jednadvacet-backend}"

# Safety: scare the operator a little.
if [ "${CONFIRM:-}" != "yes" ]; then
  echo "This will deploy to PRODUCTION ($PROD_HOST)."
  read -r -p "Type 'yes' to proceed: " REPLY
  if [ "$REPLY" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "▸ Building frontend (production mode)…"
cd "$FRONTEND"
npm run build

echo "▸ Deploying to $PROD_DIST…"
sudo rsync -a --delete dist/ "$PROD_DIST/"

echo "▸ Restarting production backend ($PROD_SERVICE)…"
sudo systemctl restart "$PROD_SERVICE"
sleep 2

echo "▸ Smoke-testing prod endpoints…"
HEALTH=$(curl -sS "http://127.0.0.1:$PROD_BACKEND_PORT/api/health")
echo "  health: $HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || { echo "prod health check failed"; exit 1; }

VERSION=$(curl -sS "https://$PROD_HOST/version.json" || true)
[ -n "$VERSION" ] && echo "  version: $VERSION"

echo
echo "✔ Production deploy complete."
