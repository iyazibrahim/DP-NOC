# Dokploy + Cloudflare Tunnel (no Traefik config for you)

This project does **not** ship Traefik. Dokploy handles routing. Cloudflare Tunnel exposes it.

## Domains you need

| Domain | Target | Port (container / local) |
|---|---|---|
| `noc.iyazbrhm.cloud` | **noc-app** | **8080** |
| `metrics.iyazbrhm.cloud` | **Prometheus** (via tunnel to localhost) | **9090** |
| `grafana.…` (optional) | grafana | **3000** (container) |

Do **not** create public domains for Alertmanager or Blackbox.

`metrics.` must be protected with **Cloudflare Access Service Token** — see [ALLOY_COLLECTOR.md](ALLOY_COLLECTOR.md).

## Fix 404 checklist (NOC UI)

### 1) Prove the container works on the VPS

SSH to the server:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "noc_|NAMES"
curl -sS http://127.0.0.1:8080/health
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
```

Expected:

- `/health` → JSON like `{"ok":true,"service":"noc-app","ui":true,...}`
- `/` → HTTP **200** (login HTML), not 404

If `/health` fails → `noc_app` is not published on host 8080 (or not running).  
If `ui:false` → image was not built with the root `Dockerfile` (rebuild with build context = **repo root**).  
If `/` is 503 with “API only” → same rebuild issue.

### 2) Dokploy domain settings

On the **Compose** app → service **`noc-app`**:

- Domain: `noc.iyazbrhm.cloud`
- Port: **8080** (always the container port, not 80)
- Path: `/` (empty or `/`)

Do not attach the domain to the whole stack randomly — attach it to **noc-app**.

### 3) Cloudflare Tunnel Public Hostname (NOC UI)

In Zero Trust → Networks → Tunnels → your tunnel → Public Hostname:

| Field | Value |
|---|---|
| Subdomain | `noc` |
| Domain | `iyazbrhm.cloud` |
| Type | **HTTP** |
| URL | `localhost:8080` |

Use **HTTP** to localhost (tunnel terminates TLS on Cloudflare’s edge).

Common mistakes:

- Type HTTPS to localhost:8080 → often breaks
- URL `localhost:80` → hits something else / nothing → Cloudflare or proxy 404
- URL includes path like `localhost:8080/noc` → wrong
- Browser opens `https://noc.iyazbrhm.cloud:8080` → don’t add `:8080` in the browser

### 4) DNS

`noc.iyazbrhm.cloud` must be a **CNAME to the tunnel** (proxied / orange cloud), not an A record to the VPS IP (unless you intentionally bypass the tunnel).

### 5) Test from outside

```bash
curl -sS https://noc.iyazbrhm.cloud/health
```

| Result | Meaning |
|---|---|
| JSON with `ok: true` | Tunnel + Dokploy routing OK |
| Cloudflare “404 Not Found” | Tunnel has no matching Public Hostname |
| Connection error | DNS / tunnel down |
| JSON `Not found` with our hint | Reached Node but wrong path |
| `ui: false` | Rebuild image from repo root Dockerfile |

## Metrics hostname (Alloy → Prometheus)

**Tunnel-only** on this project’s VPS (Prometheus is `127.0.0.1:9090`; there is often **no** host `:80/:443` for Dokploy domain routing).

| Field | Value |
|---|---|
| DNS | `metrics` **CNAME → tunnel** (not A → VPS IP) |
| Subdomain | `metrics` |
| Domain | `iyazbrhm.cloud` |
| Type | **HTTP** |
| URL | `127.0.0.1:9090` |

Do **not** open UFW 9090 publicly or point Cloudflare orange-cloud at `VPS:9090`.

Then protect with Cloudflare Access **Service Token** and point Alloy at:

`https://metrics.iyazbrhm.cloud/api/v1/write`

**403** without token = Access OK. **502** with token = origin/tunnel broken.

NUC collector: `sites/templates/site-box/deploy.sh`  
Full steps: **[ALLOY_COLLECTOR.md](ALLOY_COLLECTOR.md)**.

## Rebuild note (Dokploy)

Build context must be the **repository root** (where `Dockerfile` and `frontend/` live), not `backend/noc-api` alone.

```bash
docker compose build --no-cache noc-app
docker compose up -d noc-app
```
