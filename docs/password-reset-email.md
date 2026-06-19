# Password Reset Email — Production Setup

The forgot-password flow stores tokens in the database and works end-to-end.
The only missing piece in production is SMTP configuration.

---

## Why no email arrives

The app reads two environment variables at runtime:

| Variable    | Purpose                                        |
|-------------|------------------------------------------------|
| `SMTP_URL`  | Full SMTP connection string (nodemailer format) |
| `EMAIL_FROM`| Display name + address for the From header     |

If either is absent the email is silently skipped and the server logs:

```
[reset-password-email] Password reset email skipped: SMTP_URL or EMAIL_FROM is not configured.
```

The user still sees the generic success message ("If that email exists…") — this is intentional to prevent email enumeration.

---

## Step 1 — Generate a Gmail App Password

1. Sign in to [myaccount.google.com](https://myaccount.google.com).
2. Security → 2-Step Verification (must be enabled).
3. Security → App passwords → create one named "DLR SMTP".
4. Copy the 16-character password (shown only once).

Use your **App Password**, not your normal Google password.  
App Passwords bypass 2FA and work with SMTP; normal passwords do not.

---

## Step 2 — Add env vars in Vercel

1. Open [vercel.com](https://vercel.com) → **DLR project** → **Settings** → **Environment Variables**.
2. Add two variables scoped to **Production** (and optionally Preview):

**`SMTP_URL`**
```
smtps://brian%40dlr-sms.com:YOUR_APP_PASSWORD@smtp.gmail.com:465
```
- Replace `YOUR_APP_PASSWORD` with the 16-char App Password from Step 1.
- The `@` in the email address **must** be `%40` (URL-encoded).
- Port 465 = TLS; nodemailer handles the TLS upgrade automatically.

**`EMAIL_FROM`**
```
Dead Lead Revival <brian@dlr-sms.com>
```

3. Click **Save** for each variable.
4. Go to **Deployments** → click the three-dot menu on the latest Production deployment → **Redeploy** (this picks up the new env vars without a code push).

---

## Step 3 — Test after redeploy

1. Navigate to `https://dlr-sms.com/login`.
2. Click **Forgot your password?**
3. Enter a dealer email address that exists in the database.
4. Check inbox (and spam folder) within a few minutes.

---

## Troubleshooting

### Check server logs (Vercel)

```
Vercel → DLR project → Deployments → latest → Functions → View logs
```

Look for either:
- `[reset-password-email] Sent reset link to …` — success
- `[reset-password-email] Password reset email skipped: SMTP_URL or EMAIL_FROM is not configured.` — env vars still missing
- `[reset-password-email] Send failed for …` — SMTP error (wrong password, blocked port, etc.)

### Verify the token was created (even without email)

If SMTP is not yet configured, tokens are still written to the DB. Confirm with:

```sql
-- On the VPS:
ssh root@67.205.143.71 -i keys/dlr-vps

psql $DATABASE_URL -c "
  SELECT user_id, expires_at, used_at, created_at
  FROM password_reset_tokens
  ORDER BY created_at DESC
  LIMIT 5;
"
```

A row with `used_at IS NULL` and `expires_at` in the future means the flow is working — only the email delivery is missing.

### Local development without SMTP

Leave `SMTP_URL` and `EMAIL_FROM` unset in `.env.local`.  
When a reset is requested the server prints the raw reset URL to the console:

```
[reset-password-email] Dev reset URL for user@example.com:
  http://localhost:3000/reset-password?token=<64-hex-chars>
```

Open that URL directly to test the complete reset flow without sending any email.

---

## Security notes

- Raw tokens are **never stored** in the database — only their SHA-256 hash.
- Each token expires after **60 minutes** and is single-use (`used_at` is stamped on redemption).
- The forgot-password endpoint always returns the same generic message regardless of whether the email exists (prevents account enumeration).
- `GOOGLE_APP_PASSWORD` in `.env.example` is a placeholder — never commit a real credential.
