# DLR Deployment

Deploy DLR to a DLR-controlled Ubuntu 24.04 machine.

## Prerequisites

- Ubuntu 24.04 server with a public IP
- SSH access (root or sudo)
- A domain with a DNS A record pointing to the server's IP
- Telnyx API key and Ed25519 public key
- Telnyx phone number (E.164 format)

## Deploy

Copy the repo to the server, then run:

```bash
sudo ./scripts/bootstrap.sh <your-domain>
```

The script will prompt for:
- Telnyx API key
- Telnyx public key
- Admin email and password
- Telnyx phone number

It installs all dependencies (Postgres, Redis, Node.js, Caddy, pm2), builds the app, runs migrations, seeds the database, configures TLS, and starts all processes.

## Verify

```bash
curl https://<your-domain>/api/webhooks/telnyx -X POST -H 'Content-Type: application/json' -d '{}'
# Should return: {"ok":true}
```

## After deploy

1. Set the Telnyx webhook URL to `https://<your-domain>/api/webhooks/telnyx`
2. Log in at `https://<your-domain>/login`

## Process management

```bash
sudo -u dlr pm2 list        # status
sudo -u dlr pm2 logs         # tail logs
sudo -u dlr pm2 restart all  # restart
```

## Update

Pull new code, rebuild, and restart:

```bash
cd /opt/dlr
sudo -u dlr git pull
sudo -u dlr npm ci
sudo -u dlr npm run build
sudo -u dlr npx drizzle-kit migrate
sudo -u dlr pm2 restart all
```

## Environment

All config is in `/opt/dlr/.env` (permissions 600, owned by dlr user). Edit directly and restart processes to apply changes.
