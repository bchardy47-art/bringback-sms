# 3-Lead Controlled End-to-End Test Plan

Run every checkpoint in order. Do not advance to the next step until the current one passes.

---

## Pre-flight (run once before any test)

SSH into VPS:
```bash
ssh -i ~/dev/bringback-sms/keys/dlr-vps root@67.205.143.71
```

Confirm workers are running:
```bash
pm2 status | grep dlr
```
Expected: `dlr-web` and `dlr-worker` both show `online`.

Confirm SMS live mode is on:
```bash
cat /opt/dlr/.env | grep SMS_LIVE_MODE
```
Expected: `SMS_LIVE_MODE=true`

---

## Test Leads

| Lead | Name | Phone | Vehicle | Purpose |
|------|------|-------|---------|---------|
| A | Test Active | YOUR real mobile | 2022 Toyota Camry | Full happy path + warm reply |
| B | Test NoVehicle | a Google Voice # | (leave blank) | Fallback template + STOP |
| C | Test Suppressed | any US # | anything | Blocked — never sends |

---

## Step 1 — Import

Create `test_leads.csv`:
```csv
first_name,last_name,phone,vehicle_of_interest,crm_lead_id
Test,Active,YOUR_MOBILE,2022 Toyota Camry,TEST-001
Test,NoVehicle,GOOGLE_VOICE_NUMBER,,TEST-002
Test,Suppressed,5555550199,2020 Honda Civic,TEST-003
```

Upload via the Leads → Import page OR run:
```bash
curl -X POST https://app.dlr.ai/api/leads/import \
  -H "Cookie: <your session cookie>" \
  -F "file=@test_leads.csv"
```

**DB checkpoint:**
```sql
SELECT id, "firstName", "lastName", phone, state, "consentStatus", "vehicleOfInterest"
FROM leads
WHERE "crmLeadId" IN ('TEST-001','TEST-002','TEST-003')
ORDER BY "crmLeadId";
```

**Pass criteria:**
- 3 rows exist
- All `phone` values are E.164 (start with `+1`)
- All `consentStatus = 'implied'`  ← Fix 1
- Lead B has `vehicleOfInterest = NULL`
- Lead A has `vehicleOfInterest = '2022 Toyota Camry'`
- All `state = 'active'`

**Then: set Lead C as suppressed:**
```sql
UPDATE leads SET "doNotAutomate" = true WHERE "crmLeadId" = 'TEST-003';
```

---

## Step 2 — Phone Dedup Check

Re-upload the same CSV (or one with Lead A's phone in two rows).

**Pass criteria:**
- Import response shows errors like: `Row 2: phone +1XXXXXXXXXX already exists (Test Active) — skipped`
- No duplicate leads appear in the DB

**DB checkpoint:**
```sql
SELECT COUNT(*) FROM leads WHERE phone = 'LEAD_A_PHONE' AND "tenantId" = 'YOUR_TENANT';
```
Expected: `1` (not 2).

---

## Step 3 — Alert Phone Check

Go to **https://app.dlr.ai/settings**

**Pass criteria:**
- Amber warning banner is visible: "No alert phone set. You won't receive SMS notifications..."
- Add your mobile number in the `Alert phone` field and click Save
- Banner disappears after save + page refresh

**DB checkpoint:**
```sql
SELECT name, email, role, phone FROM users WHERE role IN ('manager', 'admin');
```
Expected: your row shows your phone in E.164.

---

## Step 4 — Suppression Check

Wait for the hourly cron OR trigger eligibility pass manually:
```bash
# On VPS, trigger manually
cd /opt/dlr
npx ts-node --esm src/scripts/run-pipeline.ts  # adjust to actual script name
```

OR wait up to 1 hour for the worker to pick it up.

**DB checkpoint:**
```sql
SELECT "crmLeadId", state, "suppressionReason"
FROM leads
WHERE "crmLeadId" IN ('TEST-001','TEST-002','TEST-003')
ORDER BY "crmLeadId";
```

**Pass criteria:**
- Lead A: `state = 'revival_eligible'`, `suppressionReason = NULL`
- Lead B: `state = 'revival_eligible'`, `suppressionReason = NULL`
- Lead C: `state = 'stale'`, `suppressionReason = 'do_not_automate'`

---

## Step 5 — Enrollment

**DB checkpoint (immediately after eligibility pass):**
```sql
SELECT l."crmLeadId", l.state, e.status, e."currentStepPosition", e."enrolledAt"
FROM leads l
LEFT JOIN "workflowEnrollments" e ON e."leadId" = l.id
WHERE l."crmLeadId" IN ('TEST-001','TEST-002','TEST-003');
```

**Pass criteria:**
- Lead A: `state = 'enrolled'`, enrollment `status = 'active'`, `currentStepPosition = 0`
- Lead B: `state = 'enrolled'`, enrollment `status = 'active'`, `currentStepPosition = 0`
- Lead C: No enrollment row (or enrollment never created)

**BullMQ checkpoint** (optional — on VPS):
```bash
redis-cli llen bull:workflow-steps:wait
```
Should show ≥2 pending jobs.

---

## Step 6 — Step Execution + SMS Send

Watch worker logs on VPS:
```bash
pm2 logs dlr-worker --lines 50
```
Look for:
- `[executor] Step executed | lead=... | type=send_sms`
- `[send] SMS sent to +1...`

**DB checkpoint:**
```sql
SELECT m.status, m."providerMessageId", m."sentAt", m."skipReason", m.body
FROM messages m
JOIN conversations c ON c.id = m."conversationId"
JOIN leads l ON l.id = c."leadId"
WHERE l."crmLeadId" IN ('TEST-001','TEST-002')
ORDER BY m."createdAt";
```

**Pass criteria:**
- 2 rows with `status = 'sent'`
- Both have a real `providerMessageId` (not null)
- `skipReason = NULL`
- Lead B's `body` does NOT contain "looking for a ." — it should use the fallback template text (no vehicle placeholder artifact)
- Physical SMS arrives on both phones

---

## Step 7 — Delivery Receipt

Wait ~60 seconds after send, then:
```sql
SELECT m.status, m."deliveredAt"
FROM messages m
JOIN conversations c ON c.id = m."conversationId"
JOIN leads l ON l.id = c."leadId"
WHERE l."crmLeadId" IN ('TEST-001','TEST-002');
```

**Pass criteria:**
- `status = 'delivered'`
- `deliveredAt` is a real timestamp

If stuck at `sent` after 5 minutes: check Telnyx dashboard → Messages for the providerMessageId.

---

## Step 8 — Warm Reply (Lead A → Dealer Alert)

From Lead A's phone (your mobile), text back:
```
yes I'm interested
```

**DB checkpoint (within 30 seconds):**
```sql
SELECT
  l.state,
  l."replyClassification",
  l."needsHumanHandoff",
  l."lastCustomerReplyAt",
  e.status AS enrollment_status,
  e."stopReason",
  h.classification AS handoff_classification,
  h.priority AS handoff_priority,
  h.status AS handoff_status
FROM leads l
LEFT JOIN "workflowEnrollments" e ON e."leadId" = l.id
LEFT JOIN "handoffTasks" h ON h."leadId" = l.id
WHERE l."crmLeadId" = 'TEST-001';
```

**Pass criteria:**
- Lead state: `responded`
- `replyClassification = 'interested'`
- `needsHumanHandoff = true`
- Enrollment `status = 'cancelled'`, `stopReason = 'inbound_reply:interested'`
- Handoff task: `classification = 'interested'`, `priority = 'high'`, `status = 'open'`
- **Your phone (dealer's) receives an SMS alert within 30 seconds** — it should say something like:
  `🤝 DLR Handoff [High]: Test Active re: 2022 Toyota Camry — Interested 🔥 ...`

**Worker log check:**
```bash
pm2 logs dlr-worker --lines 30 | grep "\[alerts\]"
```
Should show: `[alerts] Handoff alert: sending to 1 of 1 manager(s) with phone set`

---

## Step 9 — STOP (Lead B)

From Lead B's Google Voice number, text:
```
STOP
```

**DB checkpoint:**
```sql
SELECT l.state, o.phone AS opted_out, e.status AS enrollment_status, e."stopReason"
FROM leads l
LEFT JOIN "optOuts" o ON o.phone = l.phone AND o."tenantId" = l."tenantId"
LEFT JOIN "workflowEnrollments" e ON e."leadId" = l.id
WHERE l."crmLeadId" = 'TEST-002';
```

**Pass criteria:**
- Lead state: `opted_out`
- `optOuts` row exists for Lead B's phone
- Enrollment `status = 'cancelled'`, `stopReason = 'inbound_stop'`

---

## Step 10 — Bleed-Through Guard

Attempt to send to Lead B's opted-out number by checking what the send-guard would do. The easiest way is to re-enroll Lead B manually (via the Enroll button in the UI with `skipStateCheck` if needed) and watch the send-guard block it.

**DB checkpoint:**
```sql
SELECT "skipReason", status
FROM messages
WHERE "conversationId" IN (
  SELECT id FROM conversations WHERE "leadId" = (
    SELECT id FROM leads WHERE "crmLeadId" = 'TEST-002'
  )
)
ORDER BY "createdAt" DESC
LIMIT 1;
```

**Pass criteria:**
- `skipReason = 'opted_out'`
- `status = 'queued'` (audit row — never actually sent)

---

## Final Sign-off Checklist

| # | Check | Pass? |
|---|-------|-------|
| 1 | Import: 3 rows, E.164 phones, `consentStatus='implied'` | ☐ |
| 2 | Phone dedup: re-import blocked with clear error | ☐ |
| 3 | Alert phone: banner shown, number saved, banner gone | ☐ |
| 4 | Suppression: Lead C blocked with `do_not_automate` | ☐ |
| 5 | Enrollment: Leads A+B enrolled, Lead C untouched | ☐ |
| 6 | SMS sent: both phones receive messages, Lead B has no vehicle artifact | ☐ |
| 7 | Delivery: `status=delivered`, `deliveredAt` set within 5 min | ☐ |
| 8 | Warm reply: classification, handoff task, **dealer SMS alert received** | ☐ |
| 9 | STOP: opted-out, enrollment cancelled | ☐ |
| 10 | Bleed-through: opted-out lead blocked with `skipReason=opted_out` | ☐ |

All 10 pass → system is verified end-to-end. Safe to proceed with a larger batch.
