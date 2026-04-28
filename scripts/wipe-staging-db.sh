#!/usr/bin/env bash
# Wipe the staging backend SQLite database. Safe — only ever touches
# db.staging.sqlite3 and bounces the staging service. Production untouched.
set -euo pipefail

echo "▸ Stopping staging backend…"
sudo systemctl stop jednadvacet-backend-staging

echo "▸ Removing staging DB files…"
cd "$(dirname "$0")/../backend"
rm -f db.staging.sqlite3 db.staging.sqlite3-shm db.staging.sqlite3-wal

echo "▸ Restarting staging backend (schema + superadmin rebootstrap on empty DB)…"
sudo systemctl start jednadvacet-backend-staging
sleep 2

echo "▸ Verifying…"
curl -sS http://127.0.0.1:3022/api/health
echo
echo "✔ Staging DB wiped + rebuilt."
