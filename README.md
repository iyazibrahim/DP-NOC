# Multisite NOC System

Lightweight NOC for multisite WAN health, mixed-vendor SNMP devices, and public website probes.

- **Site boxes:** Grafana Alloy pushes ICMP + SNMP metrics to Prometheus (`remote_write`)
- **Central stack:** Prometheus, Alertmanager, Blackbox, Grafana, unified **noc-app** (API + React UI)
- **Deploy:** Dokploy reverse proxy (no Traefik)

## Architecture

```text
Site Alloy (SNMP/ICMP)
  --HTTPS + CF Access Service Token-->
metrics.example.com → Tunnel → Prometheus :9090
                                         ├─ Alertmanager
                                         ├─ Grafana (charts)
                                         └─ noc-app (Express API + React UI)
Dokploy/Tunnel --> noc.example.com      (noc-app :8080)
Dokploy/Tunnel --> metrics.example.com  (Prometheus :9090 + Access)
Dokploy/Tunnel --> grafana.example.com  (optional)
```

## Quick start (local)

```powershell
docker compose up -d --build
```

Open:

- NOC app: `http://localhost:8080` (login `admin` / `admin`)
- Grafana: `http://localhost:3001` (admin / admin) — host port `3001` avoids conflicts with apps already on `3000`

Prometheus / Alertmanager / Blackbox are bound to `127.0.0.1` only.

## Dokploy + Cloudflare Tunnel

See [`docs/DOKPLOY_CLOUDFLARE.md`](docs/DOKPLOY_CLOUDFLARE.md).

Quick rules:

- `noc.` → **noc-app** port **8080**
- `metrics.` → **Prometheus** `127.0.0.1:9090` + **Access Service Token** (for Alloy)
- Optional Grafana domain
- Rebuild from **repo root** Dockerfile so UI is included (`/health` should show `"ui":true`)

## Site Alloy collectors

See [`docs/ALLOY_COLLECTOR.md`](docs/ALLOY_COLLECTOR.md).

Summary:

1. Cloudflare Tunnel: `metrics.` CNAME → tunnel → `http://127.0.0.1:9090` + Access Service Token
2. On a NUC: `cd sites/templates/site-box && ./deploy.sh` (checks Docker, picks one site, adds devices)
3. Or Dokploy on the NUC: deploy that folder’s `docker-compose.yml` after `.env` exists
4. Verify: `probe_success{site="site-N"}` in Prometheus

Seed sites: Digital Penang Office, Digital Library 1 & 2, Butterworth, Batu Maung (devices empty until you add them in UI / deploy wizard).


## Local UI development

```powershell
# Terminal 1 — API
cd backend\noc-api
npm install
npm run dev

# Terminal 2 — Vite (proxies /api → :8080)
cd frontend\wallboard
npm install
npm run dev
```

## NOC UI

Sidebar:

| Page | Purpose |
|---|---|
| Dashboard | Drag-and-drop widgets (`react-grid-layout`) + Grafana panel embeds |
| Maps | Leaflet map + top devices by alerts |
| Sites | Site list and detail (WAN / LAN / websites / devices) |
| Devices | Inventory + alert ranking |
| Alerts | Alertmanager feed |
| Websites | Blackbox probe status |
| Settings | Grafana URL display + layout reset |

## Site agents

See [`sites/templates/site-box/README.md`](sites/templates/site-box/README.md) and `sites/site-*/env.example`.

Labels: `site`, `device`, `vendor` on SNMP metrics.

## Security

Change default credentials before production. Do not expose Prometheus write without TLS/auth.
