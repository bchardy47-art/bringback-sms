#!/usr/bin/env bash
# DLR end-to-end smoke test — runs on the VPS, reports gate state + triggers a test send
set -euo pipefail

source /opt/dlr/.env
cd /opt/dlr

echo "================================================================"
echo "  DLR E2E Smoke Test — $(date)"
echo "================================================================"

echo ""
echo "── 1. PM2 STATUS ──────────────────────────────────────────────"
pm2 status

echo ""
echo "── 2. ENV CHECK ───────────────────────────────────────────────"
echo -n "SMS_LIVE_MODE: "
grep -i '^SMS_LIVE_MODE' /opt/dlr/.env 2>/dev/null | cut -d= -f2 || echo "(not set)"
echo -n "DRY_RUN:       "
grep -i '^DRY_RUN' /opt/dlr/.env 2>/dev/null | cut -d= -f2 || echo "(not set)"

echo ""
echo "── 3. TENANT GATE STATE ───────────────────────────────────────"
psql "$DATABASE_URL" -x -c "
  SELECT
    id,
    slug,
    name,
    sms_live_approved,
    ten_dlc_status,
    sms_sending_number,
    campaign_status,
    brand_status
  FROM tenants
  WHERE slug = 'demo-dealership';"

echo ""
echo "── 4. WORKFLOW GATE STATE ─────────────────────────────────────"
psql "$DATABASE_URL" -x -c "
  SELECT
    w.id,
    w.name,
    w.is_active,
    w.is_template,
    w.approved_for_live,
    w.trigger_type
  FROM workflows w
  JOIN tenants t ON t.id = w.tenant_id
  WHERE t.slug = 'demo-dealership'
  ORDER BY w.created_at;"

echo ""
echo "── 5. RECENT MESSAGES (last 10) ───────────────────────────────"
psql "$DATABASE_URL" -c "
  SELECT
    m.id,
    l.first_name,
    l.phone,
    m.status,
    m.skip_reason,
    m.direction,
    m.created_at
  FROM messages m
  JOIN leads l ON l.id = m.lead_id
  ORDER BY m.created_at DESC
  LIMIT 10;" 2>/dev/null || echo "(no messages table or no rows)"

echo ""
echo "── 6. RECENT ENROLLMENTS (last 5) ────────────────────────────"
psql "$DATABASE_URL" -c "
  SELECT
    e.id,
    l.first_name,
    l.phone,
    e.status,
    e.current_step,
    e.created_at
  FROM enrollments e
  JOIN leads l ON l.id = e.lead_id
  ORDER BY e.created_at DESC
  LIMIT 5;" 2>/dev/null || echo "(no enrollments)"

echo ""
echo "── 7. LAST 50 WORKER LOG LINES ────────────────────────────────"
pm2 logs dlr-worker --lines 50 --nostream

echo ""
echo "── 8. LAST 20 WEB LOG LINES ───────────────────────────────────"
pm2 logs dlr-web --lines 20 --nostream

echo ""
echo "================================================================"
echo "  Smoke test complete — $(date)"
echo "================================================================"
