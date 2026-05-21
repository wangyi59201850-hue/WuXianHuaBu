# Local Bridge

This project now supports a local Dreamina CLI bridge.

## What it does

- The public site keeps running on Cloudflare.
- A user can run a local bridge on their own Windows computer.
- When enabled in the site UI, Dreamina CLI related requests are sent to `http://127.0.0.1:3210`.
- Cloud APIs still stay on the cloud side unless the page switches to local CLI mode.

## Start the bridge

```bash
npm install
npm run bridge:start
```

Default bridge address:

```text
http://127.0.0.1:3210
```

## Optional environment variables

```env
LOCAL_BRIDGE_PORT=3210
LOCAL_BRIDGE_ALLOWED_ORIGINS=https://www.wybottle.com,https://wybottle.com
```

## Current local endpoints

- `GET /health`
- `POST /api/cli_bootstrap`
- `GET /api/cli_meta`
- `GET /api/credit`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/browsers`
- `GET /api/credential_health`
- `POST /api/generate`
- `GET /api/tasks`
- `GET /api/query_task`
- `GET /api/generated/latest`
- `POST /api/generated/sync`
- `GET /api/generated/file`

## Notes

- This bridge is designed for local loopback use only.
- It currently assumes the user trusts `wybottle.com` / `www.wybottle.com`.
- It is a practical MVP, not a hardened enterprise agent.
