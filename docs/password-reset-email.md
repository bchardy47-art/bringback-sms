# Password Reset Email — Production Setup

The forgot-password flow stores tokens in the database and works end-to-end.
Email delivery uses the **Resend HTTP API** — no Gmail App Passwords or SMTP
configuration required.

---

## Why Resend instead of Gmail SMTP

Gmail SMTP (port 465 / `smtps://`) is unreliable from Vercel serverless
functions: Google blocks or rejects connections from cloud IP ranges, and
authentication fails silently. Resend sends over HTTPS and is designed for
exactly this use case.

---

## Environment variables needed

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key (starts with `re_`) |
| `EMAIL_FROM` | Bare sender address for the `From:` header |

> **Important:** `EMAIL_FROM` must be a bare email address — do NOT include a
> display name like `Dead Lead Revival <addr>`. Each email function in the
> codebase prepends its own display name (e.g. `DLR Security <brian@dlr-sms.com>`).

---

## Step 1 — Create a Resend account and verify dlr-sms.com

1. Sign up at [resend.com](https://resend.com) (free: 3,000 emails/month).
2. Go to **Domains** → **Add Domain** → enter `dlr-sms.com`.
3. Resend will give you DNS records to add (typically 3: SPF, DKIM, DMARC).
4. Add those records in your DNS provider (wherever dlr-sms.com DNS is managed).
5. Click **Verify** in the Resend dashboard. Status should turn green.

---

## Step 2 — Create an API key

1. In Resend → **API Keys** → **Create API Key**.
2. Name it `dlr-production`.
3. Permission: **Sending access** (not full access).
4. Copy the key — it starts with `re_` and is shown only once.

---

## Step 3 — Add env vars in Vercel

1. Open [vercel.com](https://vercel.com) → **bringback-sms** project →
   **Settings** → **Environment Variables**.
2. Add two variables scoped to **Production**:

**`RESEND_API_KEY`**
```
re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Mark as **Sensitive**.

**`EMAIL_FROM`**
```
brian@dlr-sms.com
```

3. Click **Save** for each variable.
4. **Remove `SMTP_URL`** if it is still present — it is no longer used and
   its presence as a Vercel env var causes log suppression when error messages
   contain secrets.
5. Go to **Deployments** → latest Production deployment → **⋯** → **Redeploy**
   to pick up the new vars without a code push.

---

## Step 4 — Test after redeploy

1. Navigate to `https://dlr-sms.com/forgot-password`.
2. Enter a dealer email address that exists in the database.
3. Check inbox (and spam) within a few minutes.

---

## Troubleshooting

### Check Vercel logs

```
Vercel → bringback-sms → Logs → search "reset-password-email"
```

Look for:
- `[reset-password-email] Sent reset link to …` — success
- `[reset-password-email] Password reset email skipped: RESEND_API_KEY … not configured` — env var missing
- `[reset-password-email] Send failed for …` — Resend returned an error (check Resend dashboard logs)
- `[reset-password-email] Unexpected error for …` — network or SDK error

### Check the Resend dashboard

Resend → **Emails** → filter by recipient or date. Each send attempt is logged
with delivery status: `sent`, `delivered`, `bounced`, `complained`, or `failed`.

If status is `failed` with a domain-related error, `dlr-sms.com` is not yet
verified in Resend. Complete Step 1 above.

### Verify the token was created (even without email)

If email is not yet configured, tokens are still written to the DB:

```sql
-- Run in Neon SQL Editor:
SELECT u.email, prt.created_at, prt.expires_at, prt.used_at
FROM password_reset_tokens prt
JOIN users u ON u.id = prt.user_id
ORDER BY prt.created_at DESC
LIMIT 5;
```

A row with `used_at IS NULL` and `expires_at` in the future means the flow
is working — only the email delivery is missing.

### Local development without Resend

Leave `RESEND_API_KEY` unset in `.env.local`. When a reset is requested the
server prints the raw reset URL to the console:

```
[reset-password-email] Dev reset URL for user@example.com:
  http://localhost:3000/reset-password?token=<64-hex-chars>
```

Open that URL directly to test the complete reset flow without sending email.

---

## Security notes

- Raw tokens are **never stored** in the database — only their SHA-256 hash.
- Each token expires after **60 minutes** and is single-use (`used_at` is stamped on redemption).
- The forgot-password endpoint always returns the same generic message regardless of whether the email exists (prevents account enumeration).
- `RESEND_API_KEY` in `.env.example` is a placeholder — never commit a real key.
