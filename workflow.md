# NOC (Network Operations Center) Multisite System

## Goal
Multisite NOC for WAN connectivity, mixed-vendor SNMP, host metrics, and website checks — customizable React UI + Grafana, deployed behind Dokploy.

## Architecture
- Site Alloy agents (NUC): ICMP + SNMP + host metrics → Prometheus `remote_write` via Cloudflare Tunnel + Access
- Central: Prometheus (28d / 10GB retention), Alertmanager, Blackbox, Grafana, **noc-app** (API + UI)
- Reverse proxy: **Dokploy** for UI; **metrics.** is Tunnel → `127.0.0.1:9090`

## Seed sites (Penang)
- Digital Penang Office, Penang Digital Library 1 & 2, Butterworth Digital Library, Batu Maung Digital Library
- Full addresses and coordinates in `backend/noc-api/data/seed-sites.json`
- Devices start empty; add via NOC UI (server/NUC or network/SNMP)

## Progress Log
- [x] Traefik removed; Compose uses `noc-app`; internal ports for Prometheus/AM/Blackbox
- [x] Multi-stage root `Dockerfile` builds UI + API into one image
- [x] Dashboard layout API + React shell (Maps / Sites / Devices / Alerts / Websites / Settings)
- [x] Alloy CF Access headers + collector docs
- [x] Penang seed sites + NUC `deploy.sh` / Compose / generate-config
- [x] Sites JSON persistence + device CRUD
- [x] Fix Alloy blackbox ICMP via `blackbox.yml` + host metrics via `prometheus.exporter.unix`
- [x] **Full site CRUD** (create/edit/delete, address, Leaflet map picker, reset from seed)
- [x] **Device kinds** (`server` / `network`), LAN status from host + SNMP, Alloy `devices.json` export
- [x] **Retention UI** (~28d / 10GB), shared flags volume, Prometheus entrypoint, `STORAGE_RETENTION.md`
- [x] **Metrics API** (`/api/metrics/*`) + dashboard widgets (recharts chart/gauge/detail + config editor)
- [x] **Weekly/monthly exports** (cron + manual CSV/JSON download in Settings)
- [x] **Notifications UI** (Telegram, SMTP, webhook → Alertmanager YAML)
- [x] **Status detection fix** — stale metrics show critical (down), not unknown; 10s dashboard poll
- [x] **Dashboard layout fix** — widgets no longer disappear while editing (layout poll skips unsaved state)
- [x] **Device auto-discovery** — `GET /api/sites/:id/discovered-devices` from Prometheus + Register UI on site detail
- [x] **UI polish** — dark-themed selects, chart time ranges/tooltips, Grafana widget hints, website site helper text
- [x] **LAN status hint** — warning when NUC metrics exist but no devices registered

## Local Validation
1. `docker compose up -d --build`
2. Open `http://localhost:8080` — login `admin` / `admin`
3. Sites → create site-6 → appears on Maps → delete site-6
4. Settings → change retention → Save → Apply (or restart `noc_prometheus`)
5. Dashboard → Edit → add Device metric chart for `site-1-nuc`
6. Settings → Export now (weekly) → download CSV/JSON

## Dokploy notes
- Publish `noc-app:8080` and optionally `grafana:3000`
- Keep Prometheus on `127.0.0.1:9090`; expose only via Cloudflare Tunnel `metrics.` + Access Service Token
- Optional: `PROMETHEUS_APPLY_CMD=docker restart noc_prometheus` on noc-app (Docker socket required)
- Volumes: `noc_runtime` (sites + retention flags), `noc_exports`, `prometheus_data`
