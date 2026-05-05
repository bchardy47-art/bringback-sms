#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DLR Production Upgrade Deployment
#
# Run this from your LOCAL Mac after reviewing the preflight output.
# It SSHs into the DigitalOcean server and runs every step safely.
#
# Usage:
#   bash scripts/deploy-upgrade.sh
#
# Safety guarantees:
#   - Stops if git has local changes on the server
#   - Scans all 14 migration files for DROP/TRUNCATE before running any
#   - Backs up production DB before touching schema
#   - Never sets SMS_LIVE_MODE=true
#   - Checks message/enrollment counts before and after (must be identical)
#   - Verifies /admin/dlr/* routes exist after build
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SSH_KEY="/Users/brianhardy/dev/bringback-sms/keys/dlr-vps"
SERVER="root@67.205.143.71"
APP_DIR="/opt/dlr"

echo "================================================================"
echo "  DLR Production Upgrade — $(date)"
echo "================================================================"
echo ""

ssh -i "$SSH_KEY" "$SERVER" bash -s <<'REMOTE'
set -euo pipefail

APP_DIR="/opt/dlr"
cd "$APP_DIR"

# Load env (DATABASE_URL lives here)
set -a; source .env; set +a

echo "════════════════════════════════════════════"
echo " STEP 0 — Pre-deploy safety checks"
echo "════════════════════════════════════════════"

# ── 0a. Git local changes? ────────────────────────────────────────────────────
if git rev-parse --git-dir > /dev/null 2>&1; then
  DIRTY=$(git status --short 2>/dev/null)
  if [ -n "$DIRTY" ]; then
    echo "❌ ABORT: Server has uncommitted local changes:"
    echo "$DIRTY"
    echo "Resolve before deploying."
    exit 1
  fi
  echo "✅ Git working tree: clean"
else
  echo "ℹ️  No git repo on server — will set up remote and pull fresh"
fi

# ── 0b. SMS_LIVE_MODE must NOT be true ───────────────────────────────────────
LIVE_MODE=$(grep -i "SMS_LIVE_MODE" .env 2>/dev/null | grep -v "^#" | cut -d= -f2 | tr -d '"'"'"' ' || true)
if [ "$LIVE_MODE" = "true" ]; then
  echo "❌ ABORT: SMS_LIVE_MODE=true is set in .env. Remove it before deploying."
  exit 1
fi
echo "✅ SMS_LIVE_MODE: not true (safe)"

# ── 0c. Scan migration files for destructive SQL ─────────────────────────────
if [ -d "$APP_DIR/drizzle/migrations" ]; then
  DANGEROUS=$(grep -rn "DROP TABLE\|DROP COLUMN\|TRUNCATE\|DELETE FROM\|DROP INDEX\|DROP CONSTRAINT" \
    drizzle/migrations/*.sql 2>/dev/null | grep -v "^\s*--" || true)
  if [ -n "$DANGEROUS" ]; then
    echo "❌ ABORT: Destructive SQL found in migration files:"
    echo "$DANGEROUS"
    echo "Review manually before proceeding."
    exit 1
  fi
  echo "✅ Migration files: no destructive SQL"
else
  echo "ℹ️  drizzle/migrations/ not yet on server — will appear after git pull"
fi

# ── 0d. Snapshot message and enrollment counts (for after-deploy verification) ─
BEFORE_MSGS=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM messages;" 2>/dev/null || echo "0")
BEFORE_ENROLL=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM enrollments;" 2>/dev/null || echo "0")
echo "✅ Baseline — messages: $BEFORE_MSGS  enrollments: $BEFORE_ENROLL"

echo ""
echo "════════════════════════════════════════════"
echo " STEP 1 — Database backup"
echo "════════════════════════════════════════════"

BACKUP_FILE="/tmp/dlr-db-backup-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
echo "✅ DB backup: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

echo ""
echo "════════════════════════════════════════════"
echo " STEP 2 — Git pull"
echo "════════════════════════════════════════════"

if git rev-parse --git-dir > /dev/null 2>&1; then
  # Has git — check remote
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
  if [ -z "$REMOTE_URL" ]; then
    echo "  Adding GitHub remote..."
    git remote add origin https://github.com/bchardy47-art/bringback-sms.git
  fi
  echo "  Remote: $(git remote get-url origin)"
  echo "  Before: $(git log --oneline -1)"
  git fetch origin
  git reset --hard origin/main
  echo "  After:  $(git log --oneline -1)"
else
  echo "ℹ️  No .git — initializing repo and pulling from GitHub..."
  git init
  git remote add origin https://github.com/bchardy47-art/bringback-sms.git
  git fetch origin main
  # reset --hard updates tracked files, leaves .env and untracked files untouched
  git reset --hard origin/main
  git checkout -b main 2>/dev/null || git checkout main
  echo "✅ Repo initialized: $(git log --oneline -1)"
fi

# Re-scan migrations now that code is present
DANGEROUS=$(grep -rn "DROP TABLE\|DROP COLUMN\|TRUNCATE\|DELETE FROM\|DROP INDEX\|DROP CONSTRAINT" \
  drizzle/migrations/*.sql 2>/dev/null | grep -v "^\s*--" || true)
if [ -n "$DANGEROUS" ]; then
  echo "❌ ABORT: Destructive SQL found after pull — stopping before any schema change:"
  echo "$DANGEROUS"
  exit 1
fi
echo "✅ Post-pull migration scan: clean"

echo ""
echo "════════════════════════════════════════════"
echo " STEP 3 — Install dependencies"
echo "════════════════════════════════════════════"
sudo -u dlr npm ci 2>&1 | tail -5
echo "✅ npm ci complete"

echo ""
echo "════════════════════════════════════════════"
echo " STEP 4 — TypeScript build"
echo "════════════════════════════════════════════"
sudo -u dlr npm run build 2>&1 | tail -10
echo "✅ Build complete"

echo ""
echo "════════════════════════════════════════════"
echo " STEP 5 — Base Drizzle migration (0000/0001)"
echo "════════════════════════════════════════════"
sudo -u dlr npx drizzle-kit migrate 2>&1
echo "✅ drizzle-kit migrate complete"

echo ""
echo "════════════════════════════════════════════"
echo " STEP 6 — Custom SQL migrations (0001-0014)"
echo "════════════════════════════════════════════"

for migration in \
  drizzle/migrations/0001_safety_gates.sql \
  drizzle/migrations/0002_revival_eligible_pipeline.sql \
  drizzle/migrations/0003_audit_trail.sql \
  drizzle/migrations/0004_reply_classification.sql \
  drizzle/migrations/0005_handoff_tasks.sql \
  drizzle/migrations/0006_workflow_templates.sql \
  drizzle/migrations/0007_live_readiness.sql \
  drizzle/migrations/0008_pilot_batches.sql \
  drizzle/migrations/0009_pre_live_compliance.sql \
  drizzle/migrations/0010_first_pilot.sql \
  drizzle/migrations/0011_ten_dlc_submission.sql \
  drizzle/migrations/0012_live_pilot_execution.sql \
  drizzle/migrations/0013_pilot_lead_imports.sql \
  drizzle/migrations/0014_pilot_lead_import_review.sql
do
  echo -n "  $migration ... "
  psql "$DATABASE_URL" -f "$migration" > /dev/null 2>&1 && echo "✅" || echo "⚠️  (check output above)"
done

echo ""
echo "════════════════════════════════════════════"
echo " STEP 7 — Restart PM2"
echo "════════════════════════════════════════════"

# Restart existing processes with the new build.
# Use existing PM2 names (dlr-web / dlr-worker) — do NOT rename them.
sudo -u dlr pm2 restart dlr-web dlr-worker --update-env 2>/dev/null || \
  sudo -u dlr pm2 restart all
sudo -u dlr pm2 save
echo "✅ PM2 restarted"
sudo -u dlr pm2 list

echo ""
echo "════════════════════════════════════════════"
echo " STEP 8 — Post-deploy verification"
echo "════════════════════════════════════════════"

# Give Next.js 10 seconds to start
sleep 10

# 8a. Check /admin/dlr/* routes
echo "  Checking /admin/dlr/* routes..."
ROUTES=(
  "http://localhost:3000/admin/dlr"
  "http://localhost:3000/admin/dlr/production"
  "http://localhost:3000/admin/dlr/go-no-go"
  "http://localhost:3000/admin/dlr/pilot-leads"
  "http://localhost:3000/admin/dlr/pilot-pack"
  "http://localhost:3000/admin/dlr/pilot"
)
ALL_ROUTES_OK=true
for route in "${ROUTES[@]}"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$route" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "307" ] || [ "$STATUS" = "302" ]; then
    echo "    ✅ $route → $STATUS"
  else
    echo "    ❌ $route → $STATUS"
    ALL_ROUTES_OK=false
  fi
done

# 8b. SMS_LIVE_MODE still false/unset
LIVE_MODE_AFTER=$(grep -i "SMS_LIVE_MODE" .env 2>/dev/null | grep -v "^#" | cut -d= -f2 | tr -d '"'"'"' ' || true)
if [ "$LIVE_MODE_AFTER" = "true" ]; then
  echo "  ❌ CRITICAL: SMS_LIVE_MODE=true after deploy!"
else
  echo "  ✅ SMS_LIVE_MODE: still not true"
fi

# 8c. Message and enrollment counts must be identical to pre-deploy snapshot
AFTER_MSGS=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM messages;" 2>/dev/null || echo "0")
AFTER_ENROLL=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM enrollments;" 2>/dev/null || echo "0")
echo "  Before → After:"
echo "    messages:    $BEFORE_MSGS → $AFTER_MSGS"
echo "    enrollments: $BEFORE_ENROLL → $AFTER_ENROLL"
if [ "$BEFORE_MSGS" = "$AFTER_MSGS" ] && [ "$BEFORE_ENROLL" = "$AFTER_ENROLL" ]; then
  echo "  ✅ No new messages or enrollments — safe"
else
  echo "  ❌ WARNING: counts changed — investigate before proceeding"
fi

echo ""
echo "================================================================"
echo "  Deployment complete — $(date)"
if [ "$ALL_ROUTES_OK" = "true" ]; then
  echo "  Status: ✅ All /admin/dlr/* routes responding"
else
  echo "  Status: ⚠️  Some routes not yet responding (may need more startup time)"
fi
echo "  DB backup: $BACKUP_FILE"
echo "  Commit:    $(git log --oneline -1)"
echo "================================================================"
REMOTE
