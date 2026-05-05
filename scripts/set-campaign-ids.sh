#!/bin/bash
set -euo pipefail

SSH_KEY="/Users/brianhardy/dev/bringback-sms/keys/dlr-vps"
SERVER="root@67.205.143.71"

echo "=== Writing 10DLC campaign IDs to production DB ==="

ssh -i "$SSH_KEY" "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
source /opt/dlr/.env

psql "$DATABASE_URL" <<'SQL'
UPDATE tenants SET
  messaging_profile_id = '40019dca-34b2-4e32-bf94-d865cbcfb297',
  campaign_id          = '4b30019d-d9b3-93e3-fda8-a20ca0879037',
  sms_sending_number   = '+18015150232',
  brand_status         = 'approved',
  campaign_status      = 'pending',
  ten_dlc_status       = 'pending'
WHERE id = (SELECT id FROM tenants LIMIT 1)
RETURNING id, messaging_profile_id, campaign_id, sms_sending_number,
          brand_status, campaign_status, ten_dlc_status;
SQL

REMOTE

echo "=== Done ==="
