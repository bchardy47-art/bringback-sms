#!/usr/bin/env bash
# Run from the project root:  bash scripts/run-safety-gates.sh
set -e
cd "$(dirname "$0")/.."

echo "── Step 1: Apply migration ──────────────────────────────────────────────"
psql "$DATABASE_URL" -f drizzle/migrations/0001_safety_gates.sql
echo "Migration applied."

echo ""
echo "── Step 2: Show all leads (dry-run review) ──────────────────────────────"
npx tsx scripts/mark-test-leads.ts --name-contains "test,fake,demo,sample,marcus" --dry-run

echo ""
echo "── Adjust the --name-contains filter above, then run: ───────────────────"
echo "   npx tsx scripts/mark-test-leads.ts --name-contains \"test,fake,demo\""
echo "   or"
echo "   npx tsx scripts/mark-test-leads.ts --phones \"+15550000001\""
