# NOC (Network Operations Center) Multisite System

## Goal
Multisite NOC for **collectors**, **uplink / internet**, **local devices**, and **website checks** — React ops UI + Grafana, deployed behind Dokploy.

## Vocabulary (user-facing)
| Term | Meaning |
|---|---|
| Collector | Box running Alloy (NUC, Pi, mini-PC, server) |
| Uplink / Internet | Collector can reach the internet / central server |
| Local devices | Switches/routers/etc. polled via SNMP from the collector |
| Website checks | Public URL checks from the central server (Blackbox + Hetrix failover) |
| Location | Physical site (Digital Penang, libraries, etc.) — not a public website |
| Global / Central | Synthetic site id `global` for central website probes only |

### Incident titles
| Title | Means |
|---|---|
| `Internet DOWN — {location}` | Uplink / WAN at that location |
| `Collector offline — {location}` | Collector box not reporting |
| `Website DOWN — {name}` | Public URL down (after Hetrix failover) |
| `Location health critical — {location}` | Location residual (e.g. local devices) — **not** a website-only issue |

Do **not** use generic “Site DOWN” — it conflates locations and websites.

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
- [x] **Chart axes + full SNMP catalog (2026-07-23)**
  - Y-axis numbers only; unit badge (Kbps/Mbps/Gbps) once in chart header; tooltips keep units
  - IF-MIB presets renamed/expanded: util, capacity (`ifHighSpeed`), interfaces up/down, errors/discards
  - Vendor SNMP modules: Fortinet / Maipu (HOST-RESOURCES) / Cambium / Omada + generate-config selection
  - Wallboard presets filtered by device type/vendor; see `docs/SNMP_VENDOR_HEALTH.md` (Force-apply collectors)
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
  - **Dokploy stale /data → named volume (2026-08-07)**
    - Bind to Dokploy `code/.../site-box` went empty after checkout replace (ENOENT on config.alloy)
    - `noc_sitebox_data` named volume shared Console `/data` + Alloy `/etc/alloy`
    - Console seeds toolkit + regenerates config on boot; `/api/ready` healthgate for Alloy
  - **Website probes duplicate job_name (2026-08-07)**
    - `syncWebsiteProbes` emitted one `job_name: blackbox-website` per URL → Prometheus refused reload
    - Fixed: single scrape job with multiple `static_configs` targets
  - **Website false DOWN / blackbox (2026-08-11)**
    - Eventree showed DOWN with ~23ms latency while browser OK — probe_success=0 from central blackbox
    - Blackbox: disable IPv6 fallback, browser-like UA; UI notes include probe HTTP status code
    - Root cause: Cloudflare Bot Fight 403 to VPS IP (HetrixTools multi-location still OK)
  - **HetrixTools website overlay + sync (2026-08-11)**
    - Optional `HETRIXTOOLS_API_TOKEN` — status overlay prefers Hetrix up/down + uptime %
    - Add/remove/edit website creates/deletes Hetrix monitors (locations default sgp,ams,nyc)
    - Stores `hetrixMonitorId` on site/global website records
  - **Alerts page React crash (2026-08-11)**
    - Alertmanager `/api/v2/alerts` returns `status` as object `{state,inhibited,…}` — UI rendered object → React #31
    - Normalize to `firing`/`resolved` in `alertmanager.ts`
  - **Alloy remote_write out-of-order → local SNMP DOWN (2026-08-11)**
    - Alloy logged `400 out of order sample` to metrics.iyazbrhm.cloud — samples dropped → devices DOWN
    - Central Prometheus: `storage.tsdb.out_of_order_time_window: 6h` in prometheus.yml (not a CLI flag; was wrongly set as --storage.tsdb… and crashed startup)
    - Site-box remote_write: `max_shards=1`, `enable_http2=false` (v1.5.1 still used HTTP/2), `sample_age_limit=5h`, longer backoff/timeout, `noc_site`+`noc_collector` labels
    - Persist Alloy WAL `noc_alloy_wal`; ops wipe volume if OOO storms after downtime (see `docs/ALLOY_COLLECTOR.md`)
    - Log clue: reshard `to=6` means stale config still on default `max_shards=50` — Force apply / rebuild console
  - **Prometheus OOO config fix (2026-08-11)**
    - Moved OOO window from invalid CLI flag into `infra/prometheus/prometheus.yml` `storage.tsdb`  - **Temporary SNMP status bridge (2026-07-22)**
    - While `site_snmp_if_mib` / `snmp_up` empty, NOC Local devices use `up{job=~"integrations/snmp/.*"}`
  - **Dashboard layout null coerce + compact density (2026-07-22)**
    - Fix 400 Invalid layout: RGL `Infinity`/`NaN` serialized as JSON `null` on x/y/w/h
    - Frontend `normalizeLayoutForSave` + backend Zod preprocess coerce null → ints
    - New widgets place at finite `maxBottom` (no more `y: Infinity`)
    - Dashboard **Compact / Comfortable** density toggle (localStorage); denser boards/cards
    - Per-widget “Compact this widget” in settings; shorter add-drawer labels (tooltip only)
  - **Dashboard UX + ops proof (2026-07-23)**
    - Remove SNMP notes/legend + dashboard help subtitle; simplify Site health to overall pill
    - Compact fill/ellipsis fixes; gauges/status `minW: 1`; drop duplicate inner widget titles
    - Website checks: latency ms, 24h uptime %, sparkline; dashboard avg latency
    - Acknowledgeable incidents (`data/runtime/incidents.json`) — open until Ack → History
    - Devices: per-collector Health + Live badge for duplicate inventory rows
  - **Devices inventory UX (2026-07-23)**
    - Devices page: drop Top devices panel; full-width table with search, site/kind filters, 20/page
    - Sites devices: search + pagination; collector Health pill (not SNMP dash)
  - **Retention 30d + monthly report + SNMP util (2026-07-23)**
    - Prometheus default retention **30d**; Settings/docs/flags updated (apply + restart Prom on VPS)
    - Monthly/weekly exports include incident timeline + SNMP util avg/peak
    - Formal A4 HTML report (`report.html`) is the primary deliverable — Settings → View A4 / PDF (`/reports/:id`), browser Print → Save as PDF; JSON retained for API/in-app summary; CSV no longer generated on new runs (legacy JSON can regenerate HTML via `/view`)
    - Hetrix history gap-fill for website detail when blackbox empty
    - Settings → Reports shows in-app monthly summary (uptime, incidents, util)
    - Traffic charts show Kbps/Mbps only; presets `if_util_in_pct` / `if_util_out_pct`


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

  - **False-alarm hardening + website detail (2026-07-27)**
    - Freshness **90s** via `STATUS_METRIC_FRESH_SEC`; Prom `absent_over_time[90s]` + `for: 2m`
    - Uplink **quorum** (both wan_dns + wan_vps); collector offline **inhibits** uplink critical
    - Incidents open after **~90s** sustained critical; recovery needs **2** healthy polls
    - Alert copy shortened: **Needs ack** / **Active**; compact incidents widget
    - Website detail page `/websites/:siteId?url=` with availability/latency charts + outages

  - **Website / Network tab / AP stack (2026-08-05)**
    - Website checks: name + View links to detail from list and site page; external ↗ for live URL
    - Detail: 24h / 7d / 30d ranges, weekly+monthly uptime trend bars, clearer outage timeline (ongoing vs ended)
    - Site detail tabs: Overview | Network — tagged WAN interface (`wanUplink`), traffic charts, AP clients, incidents, speedtest placeholder
    - Dashboard widget `device_stack`: manual multi-select + LED mini-grid (e.g. many APs in one card)
    - WAN picker fix: list interfaces from `ifName`/`ifDescr` metrics (IF-MIB only labels counters with `ifIndex`); manual name entry for FortiGate `wan1`
    - Network tab UX: WAN config moved to Edit site (no big box); bandwidth 24h/7d/30d; dark tooltips + rounded Mbps; AP clients from inventory + Prom site scrape
    - **Network visuals + speedtest (2026-08-05)**
      - Network tab: WAN chart, ISP speedtest chart, AP client/traffic bar+pie, AP table (no incident list)
      - Per-AP IF-MIB in/out + Cambium/Omada client SNMP; Healthy pill aligned with Edit site
      - Site-box `speedtest` service every 15m → textfile metrics via Alloy unix exporter
    - **AP clients empty while traffic works (2026-08-05)**
      - Root cause: Cambium module used PhysAddress48 indexes; E-series expose scalar `.0` → no `cambiumAPTotalClients`
      - Also: Collector Console type `access-point` did not match `generate-config` `ap` gate (now aliased)
      - Fix: scalar OIDs in `snmp.yml`, type aliases, Console option `ap`; replace collector snmp.yml + Force-apply
    - **Network 1h range + AP nickname (2026-08-05)**
      - WAN/speedtest range toggles: 1h / 24h / 7d / 30d
      - Optional device `nickname` — Network charts/AP table prefer nickname over display name
    - **shadcn/NOC kit chrome migration (2026-08-07)**
      - Remaining pages use `PageHeader` / `Button` / `Alert`: Sites, Devices, Alerts, Maps, Settings, Dashboard
      - SiteNetworkPanel: shared `darkTooltipProps` + `MetricChartFrame` / `RangeToggle`
      - DeviceMetricWidgets tooltips aligned to kit dark tooltip tokens
      - `tsc --noEmit` clean
  - **Full wallboard UI framework revamp (2026-08-07)**
    - Tailwind v4 + shadcn/ui (radix-nova) themed Digital Penang (cyan `#00b5e2` / yellow `#f5c400` on near-black)
    - Domain kit under `frontend/wallboard/src/components/noc/`: PageHeader, StatusBadge, MetricChart, OutageTimeline (green+red), RangeToggle, DataTable, KpiStrip, AppSidebar
    - Modal → Dialog; ToastStack → sonner; View actions use `Button asChild` + Link
    - Website charts: dark tooltips + 1-decimal % / integer ms formatters
    - Backend event-level website outages: fine-grained probe series (`15s` / `1m` / `5m`), down if `value < 1`, separate from smoothed chart series
    - Outage table pagination (10/25/50/All); StatusBadge contrast fix for UNKNOWN/Ended on dark UI
  - **Ack reopen fix (2026-08-11)**
    - Root cause: acknowledging an still-firing incident left the sustain timer armed, so the next status poll immediately `upsertOpenIncident`’d a new open row (History spam every few seconds, Resolved = —)
    - Fix: ack of unresolved incidents suppresses that key until the condition recovers; then a later outage must sustain ~90s again before reopening
    - Alerts copy clarified: Ack clears the list, does not change site health

  - **Collector Console Setup wins site/CF (2026-08-12)**
    - Root cause: `readConfig()` always preferred compose/Dokploy `process.env` (`SITE_NAME` default `site-1`), so Setup site-4 never stuck; CF hints said Dokploy-only
    - Fix: most-recent authority via `config-authority.json` — Setup Save stamps + updates live env; Environment fingerprint change on boot wins; same env restart keeps Setup
    - Alloy force-recreates on site/CF/remote_write changes; Setup hints work on Pi without Dokploy

  - **Clearer alerts + Hetrix failover (2026-08-12)**
    - Root cause: Global/Central “Site DOWN” used Blackbox-only overall while Eventree UI showed HEALTHY via Hetrix (CF Bot Fight false alarms)
    - Status: per-URL website evaluation with Hetrix overlay — critical only if Blackbox down **and** Hetrix not up; website domain recovery hysteresis
    - Incidents: `Internet DOWN — {site}`, `Collector offline — {site}`, `Website DOWN — {name}`, `Location health critical — {site}` (no generic Site DOWN); per-URL website keys
    - Website detail: harden Hetrix daily parse + UTC midnight align; synthesize weekly/monthly bars from summary/downtimes when daily array missing

## HetrixTools
- Env on **noc-app** (Dokploy Environment, then redeploy): `HETRIXTOOLS_API_TOKEN`, optional `HETRIXTOOLS_LOCATIONS=sgp,ams,nyc`, `HETRIXTOOLS_CONTACT_LIST`
- Compose must pass them through: `HETRIXTOOLS_API_TOKEN=${HETRIXTOOLS_API_TOKEN:-}` (commented lines never reach the container even if Dokploy has the var)
- Without token, create/delete/status overlay are no-ops (silent)
- Live overlay: list/detail **and site overall / incidents** prefer Hetrix up when Blackbox disagrees (CF/WAF)
- **History fallback:** website detail fills empty Prom uptime / availability / outages / daily trends from Hetrix `report` + `downtimes` APIs. Also **replaces** Prom history when blackbox is all-failures (`probe_success=0`, e.g. CF/WAF) while Hetrix says up (Eventree case). If daily points missing, synthesize flat weekly/monthly bars from report uptime % or downtime buckets. UI shows Source chip when `metricsSource` is `hetrix` or `mixed`. History responses cached ~3 min.
- Check: Settings → Status strip (Hetrix pill), or `sudo docker exec noc_app printenv HETRIXTOOLS_API_TOKEN`
- VPS docker needs `sudo` (or add user to `docker` group) — plain `docker` gets permission denied on `/var/run/docker.sock`

## Dokploy notes
- Publish `noc-app:8080` and optionally `grafana:3000`
- Keep Prometheus on `127.0.0.1:9090`; expose only via Cloudflare Tunnel `metrics.` + Access Service Token
- Prometheus accepts out-of-order remote_write for **6h** via `storage.tsdb.out_of_order_time_window` in `prometheus.yml` (not a CLI flag) so site Alloy WAL replay / CF tunnel lag does not drop SNMP; recreate/reload prometheus after pull
- Optional: `PROMETHEUS_APPLY_CMD=docker restart noc_prometheus` on noc-app (Docker socket required)
- Volumes: `noc_runtime` (sites + retention flags), `noc_exports`, `prometheus_data`
- Site-box: secrets in Dokploy **Environment** only; do not patch live `config.alloy` when Console sync is used
- Site-box SNMP: never patch `integrations/snmp`; use site-box compose only (see CUTOVER_SITEBOX_SNMP.md)
- **Dokploy Compose Path (required):** `docker-compose.site-box.yml` (repo root) — NOT `sites/templates/site-box/docker-compose.yml`
- Runtime config volume: `noc_sitebox_data` (Console `/data` + Alloy `/etc/alloy`) — survives Dokploy `code/` replacement; avoid bind-mounting `sites/templates/site-box` for `/data`
- Console bakes `generate-config.sh` into image (`/opt/sitebox`), seeds the data volume on boot, `/api/ready` gates Alloy start
- Token/devices volume: `noc_sitebox_state`
