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
  - **Faster uplink detection (2026-07-21)**
    - Freshness **45s** (30–60s target): silence = DOWN; uplink forces overall DOWN
    - **Prerequisite:** collector ICMP scrape 15–30s (template `scrape_interval = 15s`). 60s default + 45s freshness = minute flicker false alarms
    - Alerts `absent_over_time[45s]` + `for: 15s`; gauges aligned; toast; CPU freshness guard
  - **Ops UX redesign (2026-07-21)**
    - Custom dashboard widget names (`config.title`) in settings
    - Maps right rail: site uplink + collectors + hotspots (click focuses map)
    - Site detail Bento layout; Add device / website / edit site via modal
    - Devices: hide empty “New devices found” card
    - Website checks: table-first + Add/Edit modal
  - **UX polish (2026-07-21)**
    - Modal typing bug fixed (focus no longer jumps to ×)
    - Site detail: health full-width; map+devices equal row; websites compact; map invalidateSize
    - Alerts page: live status incidents + Alertmanager section
    - Settings: tabbed single-column (Notifications / Storage / Exports / Advanced)
  - **Digital Penang branding + Settings bento (2026-07-21)**
    - Logo in sidebar + login; accent cyan `#00b5e2` + yellow `#f5c400`
    - Settings bento cards open Configure modals (Detection read-only)
  - **Command center + SNMP sync (2026-07-21)**
    - Dashboard/Maps **Fullscreen** command-center mode (hide sidebar/chrome, lock grid, clock bar)
    - Status poll **5s** (freshness stays **45s**; scrape default in `generate-config.sh` **15s**)
    - Local devices SNMP signal board widget; live SNMP column on Devices / site detail
    - Interface traffic presets (`if_in_bps` / `if_out_bps`)
    - Collector pull sync: site token + `GET /api/collector/:siteId/devices.json` + `sync-devices.sh`

  - **Collector Console web UI (2026-07-21)**
    - `sites/templates/site-box/collector-console/` — LAN setup UI on port **8090**
    - Auto-sync inventory from NOC API (~90s), regenerate `config.alloy`, recreate Alloy
    - Replaces manual `sync-devices.sh` / cron for operators (shell script kept for legacy)
    - NOC Sites page updated to point operators to Collector Console
  - **Collector add-device → NOC (2026-07-22)**
    - Dashboard form pushes SNMP devices to `POST /api/collector/:siteId/devices`
    - NOC upserts inventory; collector pulls + reloads Alloy
    - Sync now still pulls devices already on NOC
  - **Dokploy redeploy resilience (2026-07-22)**
    - Alloy uses Dokploy Environment (not only `.env` file) so metrics survive redeploy
    - Named volume `noc_sitebox_state` persists token/devices; console bootstraps Setup from env
  - **SNMP stabilize / Alloy v1.5.1 contract (2026-07-22)**
    - Pin `grafana/alloy:v1.5.1`; ban `config_merge_strategy`; full `snmp.yml` only
    - Fail-closed `validate-config.sh` + harder `generate-config.sh` / Console regenerate
    - Dokploy ops: Environment-only secrets; ban live `config.alloy` patches when sync is used
    - Console: Metrics push + SNMP scrape hint; crash/unsafe config warnings
    - `repair-alloy.sh` / `verify-snmp-queries.sh` — 3-query Grafana prove list
  - **Per-device SNMP communities (2026-07-22)**
    - Optional `snmpCommunity` on NOC network devices + collector `devices.json`
    - Console Add device field; Setup = **Default SNMP community**
    - `generate-config.sh` writes `auth_<deviceId>` in `snmp.yml` + Alloy target `auth`
  - **Cut over site-box SNMP / drop integrations/snmp (2026-07-22)**
    - Docs + Console ban `integrations/snmp` (no `snmp_up` → NOC UNKNOWN)
    - Canonical: `job=site_snmp_if_mib` + `snmp_up`
    - `CUTOVER_SITEBOX_SNMP.md` + `cutover-sitebox-snmp.sh`
  - **Dokploy /data mount fix (2026-07-22)**
    - Root `docker-compose.site-box.yml` mounts `./sites/templates/site-box:/data`
    - Console image bakes toolkit; detects monorepo-mounted `/data`
  - **Temporary SNMP status bridge (2026-07-22)**
    - While `site_snmp_if_mib` / `snmp_up` empty, NOC Local devices use `up{job=~"integrations/snmp/.*"}`

## Local Validation
1. `docker compose up -d --build`
2. Open `http://localhost:8080` — login `admin` / `admin`
3. Sites → confirm Collector vs Uplink columns
4. Devices → “New devices found” / auto-adopt when host metrics exist
5. Dashboard → Edit → add Collector chart (CPU / memory) for a registered collector
6. Dashboard → **Fullscreen** — chrome hidden; Esc / Exit to leave
7. Sites → site → Generate collector token; open Collector Console `http://<collector-ip>:8090`, paste token, save
8. Grafana → folder NOC → “NOC — Collector & Uplink”
9. Site-box cutover: delete Dokploy legacy SNMP patches → rebuild → Default community FortiSNMP → Force apply → `./cutover-sitebox-snmp.sh site-1-fw1` → Grafana `snmp_up=1`

## Dokploy notes
- Publish `noc-app:8080` and optionally `grafana:3000`
- Keep Prometheus on `127.0.0.1:9090`; expose only via Cloudflare Tunnel `metrics.` + Access Service Token
- Optional: `PROMETHEUS_APPLY_CMD=docker restart noc_prometheus` on noc-app (Docker socket required)
- Volumes: `noc_runtime` (sites + retention flags), `noc_exports`, `prometheus_data`
- Site-box: secrets in Dokploy **Environment** only; do not patch live `config.alloy` when Console sync is used
- Site-box SNMP: never patch `integrations/snmp`; use site-box compose only (see CUTOVER_SITEBOX_SNMP.md)
- **Dokploy Compose Path (required):** `docker-compose.site-box.yml` (repo root) — NOT `sites/templates/site-box/docker-compose.yml` (that `.:/data` mounts monorepo → `generate-config.sh not found`)
- Console bakes `generate-config.sh` into image (`/opt/sitebox`) and auto-detects nested `sites/templates/site-box` under `/data`
