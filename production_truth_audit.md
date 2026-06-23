# DLR Production Truth Audit

_Date:_ 2026-06-16  
_Mode:_ Read-only audit only. No DB writes, no password resets, no code edits, no deploys.

## Current production host

### What currently serves `https://dlr-sms.com`
- DNS resolves to Vercel-owned targets/IPs, including `76.76.21.21` and `cname.vercel-dns.com`.
- HTTP response headers from `https://dlr-sms.com` include:
  - `server: Vercel`
  - `x-vercel-id: ...`
  - `x-vercel-cache: ...`
- `vercel alias ls` shows both:
  - `dlr-sms.com`
  - `www.dlr-sms.com`
  aliased to the same Vercel production deployment.
- `vercel inspect` for the aliased deployment shows:
  - `target: production`
  - `status: Ready`
  - deployment URL `bringback-r83xw2zlq-website-hre-utah.vercel.app`
  - aliases include `dlr-sms.com` and `www.dlr-sms.com`

### Conclusion
**Current web production is served by Vercel, not directly by the VPS.**

### Whether the VPS is still involved at all
- For the **web app at `dlr-sms.com`**: no evidence that the VPS is in the live request path.
- For **background worker / legacy operational scripts**: repo docs and process config still reference `/opt/dlr` and `pm2`, so the VPS may still matter for worker/runtime operations.
- The key distinction is:
  - **web serving path:** Vercel
  - **possible worker/ops path:** VPS (per repo docs), not confirmed by this audit via SSH

---

## Current deploy source

### Vercel deployment / alias status
- Active production alias points to:
  - `bringback-r83xw2zlq-website-hre-utah.vercel.app`
- Vercel marks that deployment as `Ready` and `production`.

### Current live commit
- `origin/main` at audit time: `2e9c3f5`
- local `HEAD` at audit time: `2e9c3f5`
- top Vercel production deployment creation time is within minutes of the latest `origin/main` commit time.

### Confidence statement
Vercel CLI did **not** expose Git commit SHA directly in the inspected deployment output, but the deployment timestamp and alias target line up with the latest `origin/main` commit.

### Practical conclusion
**High-confidence current live web commit: `2e9c3f5` (`polish dealer campaign detail page`).**

---

## Current DB source type

### What the app code uses
- The app code reads DB config from `process.env.DATABASE_URL`.
- DB access is initialized from env in `src/lib/db/index.ts`.

### What Vercel shows
Production env metadata contains DB-related variable names such as:
- `DATABASE_URL`
- `DATABASE_POSTGRES_URL`
- `DATABASE_POSTGRES_URL_NON_POOLING`
- `DATABASE_URL_UNPOOLED`
- `DATABASE_NEON_PROJECT_ID`
- other `DATABASE_*` Postgres/Neon-shaped variables

### Important finding
- `vercel env ls` shows the variable names exist for Production.
- `vercel env pull` produced those names **with blank values**.
- This means the live DB credentials appear to be **runtime/integration-provided or otherwise not exportable via normal env pull**.
- `vercel env run` was **not trustworthy** for resolving the live value because it loaded local repo `.env` and `.env.local`, contaminating the result.

### Conclusion
**Current DB source type is most likely a Vercel-managed integration/runtime-injected Postgres/Neon configuration, surfaced to the app as `DATABASE_URL`.**

### What could not be proven safely
This audit could **not** safely extract or verify the actual live DB connection string without risking secret disclosure or mixing in local env values.

---

## VPS status

### What `/opt/dlr` appears to represent now
Based on repo docs/scripts only:
- legacy / historical production deployment surface for the web app
- current or recent worker/runtime surface via `pm2`
- location for operational scripts and env files in the VPS-based model

### What is stale vs current
#### Current
- **Vercel is the live web serving path** for `dlr-sms.com`.

#### Stale / misleading
- Any documentation claiming the live website is currently served from:
  - `/opt/dlr/standalone/`
  - VPS `pm2 dlr-web`
  - or that `/opt/dlr/.env` is the source of truth for the live web app DB

### Summary judgment
**VPS assumptions are stale for web production.**  
The VPS may still matter for worker/ops, but it is not the authoritative source of truth for the live website domain.

---

## Which environment is stale

### Stale environment / stale assumption
- **VPS-based web deployment assumptions** are stale.
- Password resets or DB writes performed only against the VPS-linked DB should be treated as **non-authoritative for live login** unless independently proven to back the Vercel app.

### Current authoritative web environment
- **Vercel production deployment** for `bringback-sms`
- aliased to `dlr-sms.com`

---

## Which DB contains live dealer data

### What could be confirmed
This audit **could not confirm** the exact live DB instance containing:
- `Test Motors Honda`
- `Demo Dealership`
- associated users/campaigns/imports

### Why it could not be confirmed
- Production DB env names exist in Vercel metadata, but values were blank when pulled.
- `vercel env run` was contaminated by local `.env` loading and therefore unsafe to trust as the live DB source.
- No safe, secret-free path in this audit produced a verified live DB URL suitable for read-only SQL.

### Practical conclusion
**The specific DB holding live dealer data remains unresolved in this audit.**  
However, it is clear that the authoritative web app is Vercel-hosted, so the correct DB must be whichever DB Vercel injects into `process.env.DATABASE_URL` at runtime.

---

## Docs and commands now known to be wrong or stale

### Highest-risk stale doc
`CLAUDE.md` currently states, among other things:
- live web app is served from `/opt/dlr/standalone/` on the VPS
- production web deploys happen via `deploy_standalone.command`
- `/opt/dlr/.env` is source of truth for DB / web secrets

These claims are **in conflict with live evidence** from DNS, HTTP headers, and Vercel aliasing.

### Additional stale references / likely stale operational assumptions
Files/scripts that still point to `/opt/dlr` or VPS web deploy assumptions include:
- `CLAUDE.md`
- `scripts/set-campaign-ids.sh`
- `scripts/bootstrap.sh`
- `scripts/deploy-upgrade.sh`
- `scripts/e2e-smoke-test.sh`
- `scripts/ecosystem.config.js`
- comments in `scripts/migrate-local.ts`

### What not to use anymore
Do **not** use the following as the default truth for live web production without re-validation:
- `/opt/dlr/standalone` as the live web runtime
- VPS `pm2 dlr-web` as the live website server
- `/opt/dlr/.env` as the source of truth for live web DB secrets
- password reset or DB mutation workflows that only target the VPS-linked database
- deployment reasoning based on VPS `git status` / `BUILD_ID` / local rsync assumptions for the public site

---

## Exact next safest action to unblock dealer login

1. **Treat Vercel as the source of truth for live web production.**
2. Use a **dashboard-backed secret owner flow** (Vercel UI / Neon integration UI) to identify the actual production DB behind the Vercel project without printing the URL into terminal logs.
3. Once the live DB source is confirmed, perform a **single read-only verification** that:
   - `brian+dealer2@dlr-sms.com` exists
   - role is `dealer`
   - tenant is `Test Motors Honda`
4. Only then perform the one-row password reset against that verified DB.
5. Do **not** attempt further VPS DB resets unless the VPS DB is explicitly proven to be the same database used by the Vercel runtime.

### Safest operational owner path
- Open the Vercel project settings / storage integration with someone authorized to view integration-backed production secrets.
- Verify which storage/integration is bound to `DATABASE_URL` for the production environment.
- Run the reset there, or expose a temporary read-only/controlled ops path if needed.

---

## Risks if stale VPS assumptions continue

- Password resets will keep targeting the wrong DB and fail to affect live login.
- Operational time will be wasted debugging the wrong environment.
- Future production incidents may be mis-triaged because the public site and the assumed runtime differ.
- Docs may cause accidental mutation of stale infrastructure while leaving live production unchanged.
- Any “production verification” done only on the VPS can produce false confidence.

---

## Bottom line

- **Current production host:** Vercel
- **Current deploy source:** Vercel production deployment aliased to `dlr-sms.com`
- **Likely live commit:** `2e9c3f5` (high confidence)
- **Current DB source type:** runtime/integration-injected Vercel Postgres/Neon-style `DATABASE_URL`
- **VPS status:** likely still relevant for worker/ops, but **not** authoritative for the live website
- **Stale environment:** VPS-based web deployment assumptions
- **Critical conclusion:** stop using VPS DB resets as a proxy for live login fixes until the Vercel production DB source is explicitly confirmed
