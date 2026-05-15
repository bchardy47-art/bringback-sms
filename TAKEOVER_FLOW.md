# Takeover Flow

How a human (manager or dealer) claims a reviving conversation and
permanently stops automation for that lead.

## When it fires

A conversation becomes a takeover candidate as soon as a lead replies to an
automated message. The reply handler already does most of the work:

  * stamps `leads.last_customer_reply_at`
  * cancels active enrollments
  * transitions `enrolled → responded`
  * creates a handoff task (warm/hot/escalation)
  * fires the revival alert to the manager

The conversation is now visible in the inbox with a green inbound dot, a
**REVIEW** pill, and amber row tint. Nothing has been *taken over* yet —
the lead is just waiting for a human.

## What "take over" does

`POST /api/conversations/:id/take-over` — both manager (admin inbox) and
dealer (dealer inbox) can call it. The handler:

1. Stamps `conversations.human_took_over_at = now()` and
   `conversations.taken_over_by = <user id>`.
2. Cancels every still-active `workflow_enrollment` for the lead with
   `stop_reason = 'human_takeover'`.
3. Sets `leads.do_not_automate = true` (permanent — no auto-resume).
4. Removes pending BullMQ step jobs for every enrollment via
   `cancelPendingExecutions()`.

Steps 1–3 run inside a single DB transaction. The route is tenant-scoped:
`and(eq(conversations.id, params.id), eq(conversations.tenantId,
session.user.tenantId))` — cross-tenant calls return 404.

Idempotent — if `human_took_over_at` is already set, the route returns
`{ ok: true, alreadyTakenOver: true }` and does no further work.

## Why the send pipeline can't slip through

A takeover can race against an in-flight worker that has already passed
the pre-send guard. The send pipeline has two final-mile checks
(`src/lib/messaging/send.ts`):

  * re-reads `leads.do_not_automate` immediately before inserting the
    outbound message row,
  * inspects `conversations.human_took_over_at` after the conversation
    upsert.

Either positive results in `skipped: 'human_takeover'`, an audit row with
`skip_reason = 'human_takeover'`, and no provider call. Verified by the
prior takeover-race validation (3/3 pass).

The pre-send guard also catches cancelled enrollments before the send is
even constructed — `enrollment_not_active` is the first check in
`runSendGuard`.

## How a human sees it

### Dealer (`/dealer/inbox`)

  * **Needs Review** tab — open conversations whose last message was
    inbound and that are not yet taken over. Amber row tint, REVIEW pill.
  * Click into the conversation → amber **TakeOverBanner** with a
    "Take Over →" button.
  * Click the button → banner flips to green *"Human Active — automation
    paused"*; sidebar adds a green left-border, green row tint, and a
    **YOU** pill on the row.
  * **Human-Owned** tab lists all conversations the dealer (or any human
    in the tenant) has claimed.

The whole sidebar is rendered tenant-scoped via the layout's `findMany`
on `conversations` filtered by `session.user.tenantId`. The dealer
route group additionally enforces `session.user.role === 'dealer'`.

### Admin (`/inbox`)

Same banner and sidebar component, but the tab set is
All / Awaiting Reply / Replied / Opted Out (no Needs Review / Human-Owned
shortcuts). The Human-Owned styling (YOU pill, green tint) still appears
on every row with `humanTookOverAt` set.

## Verifying takeover on a live tenant

DB-side, after a take-over:

```sql
SELECT
  c.id, c.human_took_over_at, c.taken_over_by,
  l.do_not_automate, l.state,
  e.status, e.stop_reason, e.stopped_at
FROM conversations c
JOIN leads l ON l.id = c.lead_id
LEFT JOIN workflow_enrollments e
  ON e.lead_id = l.id AND e.stopped_at = c.human_took_over_at
WHERE c.id = '<conversation-id>';
```

Expect: `human_took_over_at` populated, `taken_over_by` populated,
`do_not_automate = true`, every active enrollment now `cancelled` with
`stop_reason = 'human_takeover'`.

Send-guard probe (tsx one-shot, no real send):

```
SMS_LIVE_MODE=true npx tsx _validate-takeover-halt.mts
```

(Pattern from the post-deploy validation suite — see commit history.)

## Schema dependencies

  * `conversations.taken_over_by uuid → users(id)` — added by
    `migrations/0019_takeover_by.sql`. The route fails on write if the
    column is missing. The migration is **currently untracked in git
    but applied to production** — see `MIGRATIONS.md`.
  * `users.role` includes `'dealer'` — added by
    `migrations/0017_dealer_role.sql` (also currently untracked).

## Commits

  * `ad917fb` — backend route (cancel-not-pause, doNotAutomate,
    cancel BullMQ jobs)
  * `2ca33c9` — dealer inbox, Human-Owned tab, TakeOverBanner wiring
  * `658e796` — send-pipeline final-mile race guards
  * `658e796` — `skipped: 'human_takeover'` outcome and audit
    `skip_reason = 'human_takeover'`
