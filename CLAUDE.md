# CLAUDE.md

Project-local notes for Claude Code sessions. Keep short and runbook-style.

## Production deploy truth

- The live web app is served from `/opt/dlr/standalone/` on the VPS, not from `/opt/dlr/`. The standalone tree is a self-contained Next.js bundle produced by `next build` with `output: 'standalone'`.
- Production web deploys happen via `./deploy_standalone.command`: it builds locally (the 1 GB VPS OOMs on `next build`), rsyncs `.next/standalone/` → `/opt/dlr/standalone/`, and `pm2 restart dlr-web`.
- The VPS git repo at `/opt/dlr` is **not** the authoritative runtime for the web app. Its `HEAD` and working tree can drift from what's actually serving traffic.
- To compare local ⇄ GitHub ⇄ production runtime, compare the **deployed standalone BUILD_ID**, not `/opt/dlr`'s git HEAD:
  - local: `cat .next/BUILD_ID`
  - prod: `cat /opt/dlr/standalone/.next/BUILD_ID` (or grep `buildId":"…"` in served HTML)

## Practical rules

- **Do not** `git pull` inside `/opt/dlr` as a deploy. That repo is for the worker source tree only; the web app ignores it.
- Use `./deploy_standalone.command` as the normal web deploy path. One-time bootstrap (already done) lives in `deploy_standalone_bootstrap.command`.
- Preserve `/opt/dlr/.env` at all times. It's the source of truth for Stripe/Telnyx/DB/NextAuth secrets and is symlinked from `/opt/dlr/standalone/.env`.
- Preserve `/opt/dlr/standalone/`. It is the live web runtime and is untracked by git on purpose.
- If `/opt/dlr` shows modified/untracked files, that's **repo hygiene** (worker-source cleanup), not evidence that web production is stale. Verify staleness via BUILD_ID, not `git status`.

## Worker note

- The BullMQ worker (`dlr-worker` in pm2) still runs from `/opt/dlr/` via `tsx worker.ts`. It reads `worker.ts` + `src/lib/`.
- `deploy_standalone.command` rsyncs `src/lib/` and `worker.ts` from local into `/opt/dlr/` so the worker stays current, but does **not** automatically restart `dlr-worker` (its uptime is preserved across web deploys).
- Web runtime and worker source share the same SHA after a deploy, but they're separate deployment surfaces: a stale `/opt/dlr/src/lib/` is a worker problem, not a web problem.

## Cleanup note

- If `/opt/dlr` gets dirty, clean it carefully — never with a blanket `git clean -fdx`. Always preserve `standalone/`, `.env`, `.env.bak*`, `.predeploy-*`:

  ```bash
  cd /opt/dlr
  git fetch origin
  git reset --hard <deployed-sha>
  git clean -fd -e standalone -e .env -e ".env.bak*" -e ".predeploy-*"
  ```

- Dry-run with `git clean -nd …` first. Snapshot `.env` and the dirty diff before any destructive action.

## VPS access

VPS is `root@67.205.143.71`, SSH key at `keys/dlr-vps`. Repo-local `*.command` scripts already SSH with that key. See `reference_dlr_vps_observability.md` in Claude memory for the longer cheatsheet (pm2 process names, Caddy access-log jq slices, test dealer creds).

