# NOC (Network Operations Center) Multisite System

## Goal
Multisite NOC for WAN connectivity, mixed-vendor SNMP, and website checks — customizable React UI + Grafana, deployed behind Dokploy.

## Architecture
- Site Alloy agents: ICMP + multi-device SNMP → Prometheus `remote_write`
- Central: Prometheus, Alertmanager, Blackbox, Grafana, **noc-app** (API + UI in one container)
- Reverse proxy: **Dokploy** (Traefik removed)

## Progress Log
- [x] Traefik removed; Compose uses `noc-app`; internal ports for Prometheus/AM/Blackbox
- [x] Multi-stage root `Dockerfile` builds UI + API into one image
- [x] Multi-device Alloy SNMP template + Malaysia seed sites with `devices[]`
- [x] Dashboard layout API (`/api/dashboards/me`) + devices top-by-alerts + websites routes
- [x] React shell: Dashboard, Maps, Sites, Devices, Alerts, Websites, Settings
- [x] Drag-and-drop dashboard (`react-grid-layout`) + Grafana panel widget
- [x] Leaflet maps + Top Devices table
- [x] README updated for Dokploy single-app deploy

## Local Validation
1. `docker compose up -d --build`
2. Open `http://localhost:8080` — login `admin` / `admin`
3. Edit Dashboard layout, open Maps / Sites / Devices
4. Grafana at `http://localhost:3000`

## Dokploy notes
- Publish `noc-app:8080` and optionally `grafana:3000`
- Set `GRAFANA_PUBLIC_URL` on noc-app to the public Grafana URL
- Keep Prometheus off the public internet
