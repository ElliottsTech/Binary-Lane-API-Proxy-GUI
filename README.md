# Binary Lane API Proxy GUI

<img width="1173" height="573" alt="dyn-8e2701f16cf24646b933b8edfe6b1faf" src="https://github.com/user-attachments/assets/79715d08-2949-4ae7-b7a8-58f5d69ca5a6" />
<img width="1182" height="884" alt="image" src="https://github.com/user-attachments/assets/deedfce8-8377-497a-b57e-5184768378bd" />


A passkey-secured web GUI for managing the [BinaryLane JWT-scoped API proxy](https://support.binarylane.com.au/support/solutions/articles/11000137421) — the APISIX-based proxy that protects your BinaryLane API token behind JWT-authenticated, role-scoped access.

This GUI lets you manage **consumers** (the JWT identities used by scripts/services) and their **role assignments** (readonly / support / billing / admin, etc.) through a browser. Login is **passkey-only** (WebAuthn) — no passwords.

> **Prerequisite:** You must already have deployed the BinaryLane JWT-scoped API proxy (APISIX + etcd in Docker). This GUI sits beside it and drives its Admin API. See the BinaryLane support article linked above.

## What it does

| Page | Function |
| --- | --- |
| `/setup` | One-time first-admin passkey enrollment |
| `/` (login) | Passkey login (Touch ID / Windows Hello / security key) |
| `/users` | List consumers + roles; add new (shows JWT secret once) |
| `/users/:name` | Edit roles (checkboxes), mint a test JWT, delete |
| `/audit` | Audit log: logins, role changes, consumer create/delete, route redeploys |

The master BinaryLane token is **never** exposed to the browser — it stays in the APISIX proxy's config. This GUI only manages consumer identities and role assignments; the master token is injected by APISIX's `proxy-rewrite` plugin on the proxy host.

## How it works

```
Browser ──https──> Reverse proxy (e.g. HAProxy/Nginx/Caddy)
                      │  path-split on the same hostname:
                      ├── /v2/*  ──────────> APISIX :9080   (the BL proxy)
                      └── /*     ──────────> bl-api-proxy-admin :7100  (this app)
                                                    │
                          bl-api-proxy-admin container (node:22-slim)
                          ├── Express API   (/api/*)
                          ├── React SPA     (static, Vite-built)
                          ├── @simplewebauthn/server   (passkey ceremonies)
                          ├── SQLite        (data/admin.db: users, passkeys, audit)
                          └── APISIX client ──> http://bl-apisix:9180 (shared docker net)
```

**Stack:** Node 22 + Express + React (Vite) + `@simplewebauthn` + better-sqlite3 + iron-session.

## Requirements

- Docker + Docker Compose
- The BinaryLane JWT-scoped API proxy (APISIX + etcd) deployed and running
- A reverse proxy terminating TLS for a hostname (WebAuthn **requires** HTTPS; `localhost` also counts as secure for local dev)
- `python3` available in the proxy container (the APISIX image includes it) — used by the redeploy feature to run the Lua policy generator

## Quick start

### 1. Clone

```bash
git clone https://github.com/ElliottsTech/Binary-Lane-API-Proxy-GUI.git bl-api-proxy-admin
cd bl-api-proxy-admin
```

### 2. Generate `.env`

The helper script reads the APISIX admin key + BinaryLane master token from your proxy project's `.env` and generates fresh session/bootstrap secrets:

```bash
./bootstrap-env.sh /path/to/bl-api-proxy bl-api.yourdomain.com
```

| Arg | Default | Purpose |
| --- | --- | --- |
| `path-to-proxy` | `../bl-api-proxy` | Where you installed the APISIX proxy (for reading its `.env`) |
| `hostname` | `bl-api.example.com` | The public HTTPS domain your reverse proxy serves |

Or fill in `.env` manually by copying `.env.example`. See [Environment variables](#environment-variables-env) below.

### 3. Start

```bash
docker compose up -d --build
curl http://127.0.0.1:7100/health   # → {"ok":true}
```

### 4. Configure your reverse proxy

This app must be served over **HTTPS** on the same hostname as the APISIX proxy, with `/v2/*` routed to APISIX and everything else routed here. Example HAProxy config:

```haproxy
frontend ft_bl_api
    bind *:443 ssl crt /path/to/cert.pem alpn h2,http/1.1
    mode http

    acl is_bl_api path_beg /v2
    use_backend bk_bl_apisix if is_bl_api
    default_backend bk_bl_admin

backend bk_bl_apisix
    mode http
    server apisix your-host:9080 check

backend bk_bl_admin
    mode http
    http-request set-header X-Forwarded-Proto https
    server admin your-host:7100 check
```

The app reads `X-Forwarded-Proto` to detect TLS. **Passkey enrollment/login will not work over plain HTTP** (browsers block WebAuthn on insecure origins except `localhost`).

### 5. Enroll the first admin passkey

```bash
grep ADMIN_BOOTSTRAP_TOKEN .env
```

Visit `https://bl-api.yourdomain.com/setup`, enter that token + a username, and create a passkey. The token is burned after first use — subsequent visits to `/setup` get a 409. After that, all logins go through `/` (passkey prompt).

## Environment variables (`.env`)

| Var | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | yes | Encrypts the session cookie (32+ hex chars) |
| `ADMIN_BOOTSTRAP_TOKEN` | yes | One-time token for first admin enrollment |
| `ADMIN_KEY` | yes | APISIX admin API key (from the proxy's `.env`) |
| `BL_API_TOKEN` | yes | Master BinaryLane token (for route redeploy `proxy-rewrite` header) |
| `RP_ID` | yes | WebAuthn relying-party ID — your domain (e.g. `bl-api.example.com`) |
| `ORIGIN` | yes | Full HTTPS origin (e.g. `https://bl-api.example.com`) |
| `APISIX_ADMIN_URL` | no | APISIX admin base URL (default `http://bl-apisix:9180/apisix/admin`) |
| `ROLES_JSON` | yes | In-container path to the proxy's `roles.json` |
| `POLICY_GENERATOR` | yes | In-container path to the proxy's `generate-policy-lua.py` |
| `PROXY_DIR` | no | Host path to the proxy project (compose variable substitution) |
| `APISIX_NETWORK` | no | External docker network name (default `bl-api-proxy_apisix-net`) |

## Operations

```bash
# Rebuild after code changes
docker compose up -d --build

# View logs
docker logs bl-api-proxy-admin -f

# Health check
curl http://127.0.0.1:7100/health

# Reset everything (wipe users/passkeys/audit — re-run setup)
docker compose stop bl-api-proxy-admin && rm -f data/admin.db* && docker compose start bl-api-proxy-admin
```

## Security notes

- **No passwords.** Passkey-only after bootstrap. Login is phishing-resistant (origin-bound via WebAuthn).
- **Server-side encrypted session cookie** (`iron-session`), not a client-stored JWT.
- **Audit log** records every login, role change, consumer create/delete, and route redeploy.
- The **master BinaryLane token** stays in `.env` / APISIX config and is never sent to the browser.
- Per-credential **counter checks** protect against replay.

## License

MIT — see [LICENSE](LICENSE).
