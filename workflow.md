# NOC (Network Operations Center) Multisite System

## Goal
Multisite NOC for **collectors**, **uplink / internet**, **local devices**, and **website checks** — React ops UI + Grafana, deployed behind Dokploy.

## Vocabulary (user-facing)
| Term | Meaning |
|---|---|
| Collector | Box running Alloy (NUC, Pi, mini-PC, server) |
| Uplink / Internet | Collector can reach the internet / central server |
| Local devices | Switches/routers/etc. polled via SNMP from the collector |
| Website checks | Public URL checks from the central server |

## Architecture
```text
Collector box → Alloy → Prometheus (central)
                     ├─→ React (noc-app)
                     └─→ Grafana
```
- Site Alloy agents: uplink ICMP + SNMP + host metrics → Prometheus `remote_write` via Cloudflare Tunnel + Access
- Central: Prometheus, Alertmanager, Blackbox (website checks), Grafana, **noc-app**
- React and Grafana both read Prometheus (same labels / presets)

## Identity contract
- `SITE_NAME` = Prometheus `site` = React site id (e.g. `site-1`)
- Preferred: `HOST_DEVICE_ID` = Prometheus `device` = React device id (e.g. `site-1-nuc`)
- Legacy integrations Alloy: `job=integrations/unix` + `instance=<hostname>` still auto-adopted

## Seed sites (Penang)
- Digital Penang Office, Penang Digital Library 1 & 2, Butterworth Digital Library, Batu Maung Digital Library
- Full addresses and coordinates in `backend/noc-api/data/seed-sites.json`
- Devices start empty; collectors auto-adopt from Prometheus; network gear via UI + `devices.json`

## Progress Log
- [x] Traefik removed; Compose uses `noc-app`; internal ports for Prometheus/AM/Blackbox
- [x] Multi-stage root `Dockerfile` builds UI + API into one image
- [x] Dashboard layout API + React shell
- [x] Alloy CF Access headers + collector docs
- [x] Penang seed sites + collector `deploy.sh` / Compose / generate-config
- [x] Sites JSON persistence + device CRUD
- [x] Device auto-discovery + auto-sync
- [x] **Collector-first clarity (2026-07-21)**
  - Root cause: live collector uses `job=integrations/unix` + `instance` (no `device`); discovery only looked for `job=site_host` + `device`
  - Discovery / metrics / status accept template + legacy integrations labels
  - Status split: Collector / Uplink / Local devices / Website checks
  - Plain-language UI rename; responsive shell redesign (teal ops theme)
  - Default dashboard includes collector CPU chart + memory/disk gauges
  - Grafana provisioned dashboard `noc-collector-uplink` aligned with React presets
  - Alert names/summaries use Collector / Uplink / Local device wording
  - **Dashboard UX (2026-07-21)**
    - Free grid placement (`compactType=null`) + taller drop zone so empty monitor space is usable
    - Map zoom/center persisted in sessionStorage; fit-bounds only once (no reset on 10s poll)
    - Map resize invalidates Leaflet size; resize handle z-index above map
    - Widget settings via ⚙ toggle (no need to resize to see options)
    - Charts/gauges flex-fit without needless scrollbars; themed scrollbars
    - **Dashboard UX follow-up**
      - List widgets scroll again (site overview shows all 5 sites)
      - Grid width measured after mount (fixes ~70% usable area / stuck 1200px)
      - Drag/resize apply on stop only + collision prevention (less “watery” spreading)
      - New widgets: Sites signal board, Uplink status, Collector status, bar chart
      - Uplink/probe gauges show green UP / red DOWN (not 1.0)

## Local Validation
1. `docker compose up -d --build`
2. Open `http://localhost:8080` — login `admin` / `admin`
3. Sites → confirm Collector vs Uplink columns
4. Devices → “New devices found” / auto-adopt when host metrics exist
5. Dashboard → Edit → add Collector chart (CPU / memory) for a registered collector
6. Grafana → folder NOC → “NOC — Collector & Uplink”

## Dokploy notes
- Publish `noc-app:8080` and optionally `grafana:3000`
- Keep Prometheus on `127.0.0.1:9090`; expose only via Cloudflare Tunnel `metrics.` + Access Service Token
- Optional: `PROMETHEUS_APPLY_CMD=docker restart noc_prometheus` on noc-app (Docker socket required)
- Volumes: `noc_runtime` (sites + retention flags), `noc_exports`, `prometheus_data`
