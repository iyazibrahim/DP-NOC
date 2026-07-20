# NOC (Network Operations Center) Multisite System

## Goal
Multisite NOC for WAN connectivity, mixed-vendor SNMP, and website checks — customizable React UI + Grafana, deployed behind Dokploy.

## Architecture
- Site Alloy agents (NUC): ICMP + SNMP → Prometheus `remote_write` via Cloudflare Tunnel + Access
- Central: Prometheus, Alertmanager, Blackbox, Grafana, **noc-app** (API + UI in one container)
- Reverse proxy: **Dokploy** for UI; **metrics.** is Tunnel → `127.0.0.1:9090` (not Dokploy :443)

## Seed sites
- Digital Penang Office, Digital Library 1, Digital Library 2, Butterworth Digital Library, Batu Maung Digital Library
- Devices start empty; add via NOC UI and/or `sites/templates/site-box/deploy.sh`

## Progress Log
- [x] Traefik removed; Compose uses `noc-app`; internal ports for Prometheus/AM/Blackbox
- [x] Multi-stage root `Dockerfile` builds UI + API into one image
- [x] Dashboard layout API + React shell (Maps / Sites / Devices / Alerts / Websites / Settings)
- [x] Alloy CF Access headers + collector docs
- [x] Penang seed sites (empty devices) + NUC `deploy.sh` / Compose / generate-config
- [x] Sites JSON persistence + API/UI device CRUD
- [x] Fix Alloy blackbox ICMP via `blackbox.yml` + `config_file` (no fragile inline preferred_ip_protocol)
- [x] NUC host metrics via `prometheus.exporter.unix` + host proc/sys/rootfs mounts

## Local Validation
1. `docker compose up -d --build`
2. Open `http://localhost:8080` — login `admin` / `admin`
3. Sites → add a device on a site
4. On a Linux NUC: `cd sites/templates/site-box && ./deploy.sh`

## Dokploy notes
- Publish `noc-app:8080` and optionally `grafana:3000`
- Keep Prometheus on `127.0.0.1:9090`; expose only via Cloudflare Tunnel `metrics.` + Access Service Token
- Alloy collectors: see `docs/ALLOY_COLLECTOR.md`
