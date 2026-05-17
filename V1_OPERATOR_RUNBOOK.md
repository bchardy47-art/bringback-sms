# DLR V1 Operator Runbook — Manual Post-Provision Steps

**Last updated:** May 13, 2026  
**Applies to:** Every new dealer provisioned via the intake → "Create tenant from intake" flow

---

## Overview

After provisioning a tenant, the checklist shows 8/12 steps complete. The remaining 4 steps are manual and must be done by the operator. This document covers each one exactly.

The checklist on the intake detail page tracks your progress automatically. All 4 remaining steps must be complete before you can run the first SMS pilot.

---

## Step 1: Assign a Telnyx Phone Number

**What:** Purchase a dedicated 10DLC number in Telnyx and link it to the tenant in the database.

**Why:** Without a sending number, the system cannot send any SMS messages.

### 1a. Buy the number in Telnyx

1. Go to [portal.telnyx.com](https://portal.telnyx.com)
2. Navigate to **Numbers → Search & Buy**
3. Search for a number in the dealer's state or area code
4. Confirm the number is routable on the 10DLC campaign already approved for this dealer
5. Purchase the number

### 1b. Assign the number to the tenant

Run this SQL against the production database. Replace the values with the actual tenant ID and purchased number.

```sql
UPDATE tenants
SET sms_sending_number = '+1XXXXXXXXXX'   -- E.164 format, e.g. +18015551234
WHERE id = '<tenant-uuid>';
```

**Find the tenant UUID** on the intake checklist page URL: `/admin/dlr/intakes/<intake-id>` — the tenant ID is shown in the checklist or can be retrieved from:

```sql
SELECT id, name FROM tenants ORDER BY created_at DESC LIMIT 5;
```

### 1c. Verify

Refresh the intake checklist. The "Telnyx number provisioned" step should now show green.

---

## Step 2: Create and Approve a Workflow

**What:** Create at least one SMS workflow for the tenant, review the copy, and mark it approved for live sends.

**Why:** The system will not enroll pilot leads without an approved workflow.

### 2a. Switch to the tenant's context

In the DLR admin sidebar, use the **tenant switcher** at the bottom of the left nav to switch to the new dealer's account.

### 2b. Create the workflow

1. Navigate to **Workflows** (left nav)
2. Click **New Workflow** (or equivalent create button)
3. Configure the workflow:
   - **Name**: e.g. "Dead Lead Revival — Initial Outreach"
   - **Messages**: Use the dealer's approved sample messages as the first touchpoints
   - **Delays**: Set appropriate wait times between messages (e.g. Day 1, Day 4, Day 8)
4. Save the workflow

### 2c. Approve the workflow for live sends

This requires a direct database update (no UI button in V1):

```sql
UPDATE workflows
SET approved_for_live = true
WHERE tenant_id = '<tenant-uuid>'
  AND id = '<workflow-uuid>';
```

Or approve all workflows for a tenant at once:

```sql
UPDATE workflows
SET approved_for_live = true
WHERE tenant_id = '<tenant-uuid>';
```

### 2d. Verify

Refresh the intake checklist. "Workflow set up and approved" should now show green.

---

## Step 3: Import Pilot Leads

**What:** Upload a CSV of dead leads into the pilot staging area and select up to 5 for the first batch.

**Why:** These are the first contacts the dealer's new SMS system will reach out to.

### 3a. Navigate to Pilot Leads

Go to: `https://dlr-sms.com/admin/dlr/pilot-leads?tenantId=<tenant-uuid>`

Or from the intake checklist, click **"Go to Pilot Leads ↗"**.

### 3b. Upload leads via CSV

Click **CSV Upload** and upload a file with these columns (header row required):

```
firstName,lastName,phone,email,vehicleName,leadsSource,originalInquiryAt,consentStatus,consentSource,consentCapturedAt,notes
```

**Key fields:**
- `phone`: E.164 or 10-digit format — system normalizes automatically
- `consentStatus`: `explicit`, `implied`, or `none`
- `originalInquiryAt`: ISO date string (e.g. `2024-03-15`) — must be old enough to qualify as a "dead lead"

You can also use **Manual Entry** to add leads one at a time.

### 3c. Review validation results

Each lead is validated immediately on import. The page shows counts for:
- **Imported** — total uploaded
- **Eligible** — pass all checks, ready to send
- **Blocked** — have suppression, opt-out, or consent issues (resolve or exclude)
- **Selected** — chosen for this pilot batch (max 5)

Resolve blocked leads: either fix the underlying issue (update consent status, check suppression) or click the **×** to exclude them from this import session.

### 3d. Select leads for the pilot

Check the checkbox next to each lead you want in the first batch. Max 5 leads.

Use **Generate Report** (Dry-Run Report section) to preview the first message each lead will receive before committing.

### 3e. Verify

Refresh the intake checklist. "Pilot leads imported" should now show green.

---

## Step 4: Run the First Pilot Batch

**What:** Review the dry-run report one final time, then send the first SMS pilot.

**Why:** This is the go/no-go gate before live messages leave the system.

### 4a. Navigate to Live Pilot

From the intake checklist, click **"Go to Pilot ↗"** or navigate to:

`https://dlr-sms.com/admin/dlr/live-pilot?tenantId=<tenant-uuid>`

### 4b. Review the dry-run report

Click **Generate Report** in the Dry-Run Report panel. Confirm:
- Recommendation shows **✅ Ready to create pilot batch**
- All selected leads show `eligible` status
- Message previews look correct (dealer name, agent name, vehicle name templated properly)
- No unexpected `fallback` flags

Do **not** proceed if the recommendation is "Fix warnings" or "Blocked".

### 4c. Create and send the pilot batch

Click **Create Pilot Batch** (Phase 13 confirmation gate).

The system will:
1. Enroll selected leads into the approved workflow
2. Queue the first message for each lead
3. Mark the import session as completed

### 4d. Monitor delivery

Check the **Inbox** and **Reports** tabs over the next 24 hours to confirm:
- Messages delivered (green DLR status)
- No opt-outs or STOP replies in the first wave
- dlr-worker logs show no errors

### 4e. Verify

Refresh the intake checklist. "First pilot sent 🚀" should now show green. The intake status will update to `live`.

---

## Quick Reference — Tenant Info

When working with a new tenant, the key IDs you'll need:

| Field | Where to find it |
|-------|-----------------|
| Intake ID | URL on intake detail page: `/admin/dlr/intakes/<intake-id>` |
| Tenant UUID | `SELECT id FROM tenants WHERE name = '<rooftop name>';` |
| Workflow UUID | `SELECT id FROM workflows WHERE tenant_id = '<tenant-uuid>';` |
| Sending number | `SELECT sms_sending_number FROM tenants WHERE id = '<tenant-uuid>';` |

---

## Checklist State Summary

| Step | Status after provision | How it goes green |
|------|----------------------|-------------------|
| Intake form submitted | ✅ Done | Automatic |
| Business identity complete | ✅ Done | Automatic |
| Contacts complete | ✅ Done | Automatic |
| Compliance narrative complete | ✅ Done | Automatic |
| Sample messages ready | ✅ Done | Automatic |
| 10DLC submitted to TCR | ✅ Done | Manual → auto |
| 10DLC approved by carriers | ✅ Done | Manual → auto |
| Tenant provisioned in DLR | ✅ Done | "Create tenant from intake" button |
| Telnyx number provisioned | 🟡 Pending | **Step 1 above** |
| Workflow set up and approved | 🟡 Pending | **Step 2 above** |
| Pilot leads imported | 🟡 Pending | **Step 3 above** |
| First pilot sent 🚀 | ⬜ Blocked | **Step 4 above** |
