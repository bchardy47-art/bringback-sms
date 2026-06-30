#!/usr/bin/env bash
# Run this yourself, directly in your own terminal (e.g. via `! bash scripts/prompt-prod-db-url.sh`).
# Prompts for the production DATABASE_URL with terminal echo OFF (read -s), so
# the value is never displayed, never typed into chat, and never seen by the
# agent. Saves it to .env.production.local, which is gitignored (matches the
# .env.*.local pattern) and read only by scripts that explicitly source it.
set -euo pipefail

cd "$(dirname "$0")/.."

read -rs -p "Production DATABASE_URL (input hidden, paste and press Enter): " URL
echo
if [ -z "$URL" ]; then
  echo "No value entered. Aborting — .env.production.local not written." >&2
  exit 1
fi

printf 'DATABASE_URL=%s\n' "$URL" > .env.production.local
chmod 600 .env.production.local

echo "Saved to .env.production.local (gitignored, not printed, mode 600)."
