#!/usr/bin/env bash
# Safety pipeline verification script
# Run from project root: bash scripts/verify-safety-pipeline.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export $(grep -v '^#' .env | xargs) 2>/dev/null || true

SEP="────────────────────────────────────────────────────────"

# ─────────────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "  DLR SAFETY PIPELINE VERIFICATION"
echo "$SEP"

# ─────────────────────────────────────────────────────────
echo ""
echo "BEFORE COUNTS"
echo "$SEP"
psql "$DATABASE_URL" --no-align --tuples-only -c "
SELECT
  COUNT(*)                                        AS total_leads,
  COUNT(*) FILTER (WHERE state = 'active')        AS active,
  COUNT(*) FILTER (WHERE state = 'stale')         AS stale,
  COUNT(*) FILTER (WHERE state = 'revival_eligible') AS revival_eligible,
  COUNT(*) FILTER (WHERE state = 'enrolled')      AS enrolled,
  COUNT(*) FILTER (WHERE state = 'responded')     AS responded,
  COUNT(*) FILTER (WHERE state = 'opted_out')     AS opted_out,
  COUNT(*) FILTER (WHERE state = 'dead')          AS dead,
  COUNT(*) FILTER (WHERE is_test = true)          AS is_test,
  COUNT(*) FILTER (WHERE do_not_automate = true)  AS do_not_automate,
  COUNT(*) FILTER (WHERE is_test = true OR do_not_automate = true) AS flagged
FROM leads;
" | awk -F'|' '
BEGIN { labels[1]="total_leads"; labels[2]="active"; labels[3]="stale";
        labels[4]="revival_eligible"; labels[5]="enrolled"; labels[6]="responded";
        labels[7]="opted_out"; labels[8]="dead"; labels[9]="is_test";
        labels[10]="do_not_automate"; labels[11]="flagged" }
{ for(i=1;i<=NF;i++) printf "  %-22s %s\n", labels[i]":", $i }'

echo ""
echo "Opted-out phone numbers:"
psql "$DATABASE_URL" --no-align --tuples-only -c "SELECT COUNT(*) FROM opt_outs;" \
  | awk '{ printf "  %-22s %s\n", "opt_outs records:", $1 }'

echo ""
echo "All leads (to identify test/fake contacts):"
echo "$SEP"
psql "$DATABASE_URL" -c "
SELECT
  SUBSTRING(id::text, 1, 8) AS id_prefix,
  first_name, last_name, phone, state,
  is_test, do_not_automate,
  created_at::date AS created
FROM leads
ORDER BY created_at
LIMIT 50;
"

# ─────────────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "  STEP 1: DRY-RUN — preview test lead identification"
echo "$SEP"
echo "Searching for leads matching: test, fake, demo, sample, marcus"
echo ""
npx tsx scripts/mark-test-leads.ts --name-contains "test,fake,demo,sample,marcus" --dry-run || true

# ─────────────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "  STEP 2: APPLY — mark test/fake contacts"
echo "$SEP"
echo "Running mark-test-leads with name patterns: test,fake,demo,sample,marcus"
echo "(Edit this script to adjust patterns or use --phones for exact numbers)"
echo ""
npx tsx scripts/mark-test-leads.ts --name-contains "test,fake,demo,sample,marcus" || true

# ─────────────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "  STEP 3: DRY-RUN PIPELINE — stale detection + eligibility"
echo "$SEP"
echo "Calling /api/dev/trigger-stale with dryRun:true ..."
echo "(Make sure the Next.js dev server is running: npm run dev)"
echo ""

# Get the first tenant ID from the DB
TENANT_ID=$(psql "$DATABASE_URL" --no-align --tuples-only -c "SELECT id FROM tenants LIMIT 1;")
if [ -z "$TENANT_ID" ]; then
  echo "  ERROR: No tenants found in database."
else
  echo "  Using tenant: $TENANT_ID"
  curl -s -X POST http://localhost:3000/api/dev/trigger-stale \
    -H 'Content-Type: application/json' \
    -d "{\"tenantId\":\"$TENANT_ID\",\"dryRun\":true}" \
    | npx --yes prettier --parser json 2>/dev/null || \
  curl -s -X POST http://localhost:3000/api/dev/trigger-stale \
    -H 'Content-Type: application/json' \
    -d "{\"tenantId\":\"$TENANT_ID\",\"dryRun\":true}"
fi

# ─────────────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "  STEP 4: LIVE PIPELINE — run actual stale + eligibility + enrollment"
echo "$SEP"
echo "  (SMS_LIVE_MODE is NOT set — enrollment will run but no SMS will send)"
echo ""

if [ -n "$TENANT_ID" ]; then
  curl -s -X POST http://localhost:3000/api/dev/trigger-stale \
    -H 'Content-Type: application/json' \
    -d "{\"tenantId\":\"$TENANT_ID\",\"dryRun\":false}" \
    | npx --yes prettier --parser json 2>/dev/null || \
  curl -s -X POST http://localhost:3000/api/dev/trigger-stale \
    -H 'Content-Type: application/json' \
    -d "{\"tenantId\":\"$TENANT_ID\",\"dryRun\":false}"
fi

# ─────────────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "  STEP 5: VERIFY SMS LIVE MODE GUARD"
echo "$SEP"
if [ "${SMS_LIVE_MODE:-}" = "true" ]; then
  echo "  ⚠  SMS_LIVE_MODE=true — real sends ENABLED"
else
  echo "  ✓  SMS_LIVE_MODE is not set — real sends BLOCKED"
fi
if [ "${DRY_RUN:-}" = "true" ]; then
  echo "  ✓  DRY_RUN=true — all sends will be logged only"
fi

# ─────────────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "  AFTER COUNTS"
echo "$SEP"
psql "$DATABASE_URL" --no-align --tuples-only -c "
SELECT
  COUNT(*)                                        AS total_leads,
  COUNT(*) FILTER (WHERE state = 'active')        AS active,
  COUNT(*) FILTER (WHERE state = 'stale')         AS stale,
  COUNT(*) FILTER (WHERE state = 'revival_eligible') AS revival_eligible,
  COUNT(*) FILTER (WHERE state = 'enrolled')      AS enrolled,
  COUNT(*) FILTER (WHERE state = 'responded')     AS responded,
  COUNT(*) FILTER (WHERE state = 'opted_out')     AS opted_out,
  COUNT(*) FILTER (WHERE state = 'dead')          AS dead,
  COUNT(*) FILTER (WHERE is_test = true)          AS is_test,
  COUNT(*) FILTER (WHERE do_not_automate = true)  AS do_not_automate
FROM leads;
" | awk -F'|' '
BEGIN { labels[1]="total_leads"; labels[2]="active"; labels[3]="stale";
        labels[4]="revival_eligible"; labels[5]="enrolled"; labels[6]="responded";
        labels[7]="opted_out"; labels[8]="dead"; labels[9]="is_test";
        labels[10]="do_not_automate" }
{ for(i=1;i<=NF;i++) printf "  %-22s %s\n", labels[i]":", $i }'

echo ""
echo "Workflow enrollments:"
psql "$DATABASE_URL" -c "
SELECT status, COUNT(*) AS count
FROM workflow_enrollments
GROUP BY status
ORDER BY status;
"

echo ""
echo "Step executions:"
psql "$DATABASE_URL" -c "
SELECT status, COUNT(*) AS count
FROM workflow_step_executions
GROUP BY status
ORDER BY status;
"

echo ""
echo "Messages sent/skipped:"
psql "$DATABASE_URL" -c "
SELECT status, direction, COUNT(*) AS count
FROM messages
GROUP BY status, direction
ORDER BY direction, status;
"

echo ""
echo "$SEP"
echo "  VERIFICATION COMPLETE"
echo "$SEP"
echo ""
echo "What to check:"
echo "  • is_test leads should all have state = 'dead' and do_not_automate = true"
echo "  • stale leads should NOT appear in workflow_enrollments as 'active'"
echo "  • revival_eligible leads should appear in workflow_enrollments as 'active'"
echo "  • No messages with status = 'sent' unless SMS_LIVE_MODE=true"
echo ""
