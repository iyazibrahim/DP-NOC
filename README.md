# Multisite NOC System

Lightweight NOC for multisite WAN health, mixed-vendor SNMP devices, and public website probes.

- **Site boxes:** Grafana Alloy pushes ICMP + SNMP metrics to Prometheus (`remote_write`)
- **Central stack:** Prometheus, Alertmanager, Blackbox, Grafana, unified **noc-app** (API + React UI)
- **Deploy:** Dokploy reverse proxy (no Traefik)

## Architecture

```text
Site Alloy (SNMP/ICMP) --remote_write--> Prometheus
                                         ├─ Alertmanager
                                         ├─ Grafana (charts)
                                         └─ noc-app (Express API + React UI)
Dokploy --> noc.example.com  (noc-app)
Dokploy --> grafana.example.com  (optional)
```

## Quick start (local)

```powershell
docker compose up -d --build
```

Open:

- NOC app: `http://localhost:8080` (login `admin` / `admin`)
- Grafana: `http://localhost:3001` (admin / admin) — host port `3001` avoids conflicts with apps already on `3000`

Prometheus / Alertmanager / Blackbox are bound to `127.0.0.1` only.

## Dokploy

1. Deploy this Compose stack (or equivalent) on your VPS.
2. Point Dokploy domains:
   - `noc.example.com` → container `noc_app` port `8080`
   - `grafana.example.com` → container `noc_grafana` port `3000` (optional)
3. Do **not** publish Prometheus publicly. Prefer authenticating remote_write later (HTTPS + token).
4. Set env on `noc-app`:
   - `GRAFANA_PUBLIC_URL=https://grafana.example.com`
   - Strong `JWT_SECRET`, `OPERATOR_PASSWORD`

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
