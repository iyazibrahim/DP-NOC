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


- [x] **Synology NAS SNMP wallboard pack (2026-08-19)**
  - Type `nas` is SNMP (`kind: network`), not a collector host
  - `synology_health` module + generate-config extra target (vendor synology / empty)
  - Presets reuse Gauge (volume pie from `/volume*` HOST-RESOURCES, RAID UP/DOWN, CPU/mem/temp), Line chart (LAN), Device stack for several NAS
  - Volume query uses filesystem `/volume*` (not RAID leftover space). Stale collector `snmp.yml` is refreshed from the console image on generate.
  - Collector Console type NAS; vendor chip `synology`
  - See `docs/SNMP_VENDOR_HEALTH.md` and `docs/superpowers/specs/2026-08-19-synology-nas-wallboard-design.md`

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

  - **Login + uptime list + site network layout (2026-10-14)**
    - Login restyled (Welcome back, empty fields, cyan Sign in); auth accepts `OPERATOR_*` via compose interpolation + `ADMIN_*` aliases
    - Website list uptime uses Hetrix report when Prom is 0% but Hetrix is up (Eventree list vs detail mismatch)
    - Site Network tab: per-user/per-site RGL layout (Status / Traffic / Wireless), collapse, Line use card for Today / 7d / 30d
    - Plain-language labels, cyan selected toggles, consistent pill padding, loading skeletons
  - **Site network polish (2026-10-14)**
    - Network cards use the same dashWidget / widgetChrome / widgetInner pattern as the main dashboard
    - Line use shows GB/TB transferred (increase of ifHC*Octets) plus avg %; Today = calendar day in `NOC_TZ` (default Asia/Kuala_Lumpur, resets at midnight); 7d/30d remain rolling
  - **Clients tab (2026-10-14)**
    - Site detail: Overview / Network / **Clients** — total + per-AP client counts
    - **Per-station list:** Cambium `cambiumClientTable` → hostname/MAC/IP/SSID/SNR/link rate + live in/out (`rate(*DataBytes)*8`); Omada MAC-only via `omadaClientInfo`
    - Ops: rebuild **collector-console** (embeds snmp.yml) + Force-apply; Omada per-client bandwidth deferred
  - **Force-apply stale snmp.yml (2026-10-14)**
    - Root cause: volume `snmp.yml` kept old modules; refresh only checked `synology_health`, so Cambium client-table packs never replaced live file; Force apply could no-op while 90s sync held the lock
    - Fix: module markers (`cambiumClientInfo`, `omadaClientInfo`, …) in generate-config + `snmpStaleReason` diagnostics; Force apply waits for in-flight sync
    - Follow-up: false “NAS missing synology_health” when type/vendor did not match generate-config — align stale check with vendor_module (nas|storage + synology*)
  - **AP false-DOWN + Collector Console UX (2026-10-14)**
    - Root cause: multi-target SNMP (`if_mib` + vendor pack) — `parseFirstVectorValue` picked a timed-out target while IF-MIB/ping still OK; status now uses `max(up)`
    - Console: Dashboard connection card, per-device Up/Down from NOC, human SNMP polling copy, closable Diagnostics / Add / Edit modals
  - **SNMP cascade after client-table pack (2026-10-14)**
    - Root cause: Cambium station walk on the 15s `cambium_ap_health` scrape timed out Alloy and starved if_mib for firewall/switch/NAS (no device reconfig)
    - Fix: restore light health modules; station tables on separate `site_snmp_clients` scrape (60s / 45s timeout)
    - Follow-up: stale check requires `site_snmp_clients` when APs present; Clients tab layout (AP + search row); remove Force-apply nag banner
  - **Client list via collector snmpwalk (2026-10-14)**
    - Prom station scrapes stayed empty while scalar totals worked — collector now walks Cambium/Omada tables on the LAN and POSTs `/api/collector/:site/stations`; Clients tab falls back to that cache
    - Console: SNMP polling card opens details modal; edit preserves `access-point` (no forced rewrite to `ap`)
- [x] **Connected clients pagination + Link rate / In / Out (2026-10-14)**
  - Clients tab: `TablePagination` (20/page); resets on AP filter / search
  - Collector `scanClients`: parse Cambium link rate (col 12); byte counters → In/Out bps after 2nd scan (~90s)
  - noc-api: overlay Prom rx/tx rates onto stored stations by MAC when Prom has series
- [x] **Omada client MAC decode (2026-10-14)**
  - Root cause: Omada `macAddress` is OctetString Hex-STRING of ASCII `AA-BB-…`, not 6-byte binary; UI showed raw `"31 38 2D…"`
  - Fix: decode binary (6 bytes) vs ASCII Hex-STRING in collector `formatMac` + noc-api `formatMacLabel`
  - Omada MIB is MAC-only (no hostname/SSID/SNR/link/In/Out via SNMP) — Clients tab notes that when applicable
- [x] **Fortigate Bandwidth overall → Mbps (2026-10-14)**
  - Preset `if_util_max_pct` now returns `max(in,out)` bitrate (unit `bps`) instead of % of `ifHighSpeed`/`ifSpeed`
  - Network status chips: Download/Upload = tagged WAN `rate(ifHC*Octets)*8`; Line in use = same rates as Mbps (not %)
  - Follow-up: tooltip no longer appends `%` to raw bps; chart margins + wider Y-axis so labels/bars are not clipped

## Auth (operator login)
- Wallboard login uses `OPERATOR_USERNAME` / `OPERATOR_PASSWORD` on **noc-app**
- Compose passes them through: `OPERATOR_USERNAME=${OPERATOR_USERNAME:-admin}` (and password)
- If `OPERATOR_*` is still the default `admin`/`admin`, `ADMIN_USER` + `ADMIN_PASSWORD` (or `ADMIN_PASS`) are accepted as aliases — **not** Grafana `GF_SECURITY_ADMIN_*`
- Login form starts empty (no prefilled password)

## HetrixTools
- Env on **noc-app** (Dokploy Environment, then redeploy): `HETRIXTOOLS_API_TOKEN`, optional `HETRIXTOOLS_LOCATIONS=sgp,ams,nyc`, `HETRIXTOOLS_CONTACT_LIST`
- Compose must pass them through: `HETRIXTOOLS_API_TOKEN=${HETRIXTOOLS_API_TOKEN:-}` (commented lines never reach the container even if Dokploy has the var)
- Without token, create/delete/status overlay are no-ops (silent)
- Live overlay: list/detail **and site overall / incidents** prefer Hetrix up when Blackbox disagrees (CF/WAF)
- **History fallback:** website detail fills empty Prom uptime / availability / outages / daily trends from Hetrix `report` + `downtimes` APIs. Also **replaces** Prom history when blackbox is all-failures (`probe_success=0`, e.g. CF/WAF) while Hetrix says up (Eventree case). If daily points missing, synthesize flat weekly/monthly bars from report uptime % or downtime buckets. UI shows Source chip when `metricsSource` is `hetrix` or `mixed`. History responses cached ~3 min.
- **List uptime:** `getWebsiteProbeMetrics` also loads Hetrix report when Prom/status uptime is 0% but Hetrix says up — so Eventree list “Up today” matches detail
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
- **Site-box auto-deploy:** enable Auto Deploy on the site-box Compose app (separate from noc-app); see `docs/DOKPLOY_SITEBOX_AUTODEPLOY.md`. Optional GH Action `.github/workflows/dokploy-sitebox.yml` + secret `DOKPLOY_SITEBOX_WEBHOOK_URLS` when the NUC Dokploy needs an explicit webhook
- [x] **Collector Console half-split layout (2026-10-14)**
  - Left: Dashboard / Setup / Settings; Right: Local devices (sticky pane, scrollable table); stacks on narrow screens
- [x] **Dark scrollbars everywhere (2026-10-14)**
  - Wallboard + Collector Console: `color-scheme: dark`, thin cyan/dark track, hide classic Windows scrollbar arrows
- [x] **Collector Console layout + guided install (2026-10-14)**
  - Dashboard tabs sit inside the status card; status is a 2-column grid; sync message is a banner under the cards; Sync / Force apply / Refresh / Diagnostics share one 36px toolbar
  - Device list is the wider column; Add device matches that toolbar height; names and ids stay on one line; types no longer wrap mid-word
  - Fresh install (`site`, NOC URL, token, or metrics URL missing) opens a 5-step setup guide: connect (live NOC probe), metrics, ping/SNMP community, review, save
  - Setup tab keeps the full form and can reopen the guide; probe is `POST /api/setup/probe`
- [x] **Map tiles + short health notes + stable collector (2026-10-15)**
  - Carto: read `NEXT_PUBLIC_CARTO_API_KEY` on noc-app at runtime; compose forwards it; `GET /api/settings/map` returns tile URL; shared `CartoTileLayer` for Maps / site location
  - Health notes: dedupe aggregated critical messages (`SNMP down (N devices)`); short copy (`Offline`, `Collector offline`, `SNMP down`, `No recent data`); CSS clamp health-card notes to 2 lines
  - Collector liveness: if host heartbeat is missing/`up=0` but site SNMP is still fresh and successful, collector stays healthy (Alloy still polling + remote_write)
- [x] **Carto tile key param fix (2026-10-15)**
  - Watermark persisted because tiles used `?api_key=`; Carto basemaps require `?key=`
  - Frontend only caches tile URLs that include `?key=` so a keyless first response cannot stick
- [x] **Line use Today = calendar day (2026-10-15)**
  - `collectUtilWindows` “1d” uses midnight→now in `NOC_TZ` (default `Asia/Kuala_Lumpur`), not rolling 24h; 7d/30d unchanged
- [x] **Fit-to-screen dashboard + location carousel (2026-10-16)**
  - View mode sizes grid rows to the visible pane (no page scroll); edit mode still scrolls
  - Layout v2: All locations board plus one saved board per location; v1 files migrate on read
  - Arrows, keyboard, and fullscreen Lock / Rotate (15s, 30s, 60s)
- [x] **Ping backup, collector safety, and readable alerts (2026-10-16)**
  - Each local device is pinged beside SNMP. SNMP up stays green. SNMP fail with ping up is an orange warning and a warning incident. Both failing is down, with a device incident.
  - A silent collector pauses device alarms (unknown, one collector incident). A fresh status snapshot covers a stale metrics push.
  - Collector Console Refresh runs a live ping and SNMP check and says Updated or a plain error. Alerts, site lists, websites, the access-point table, and the collector device table page at 20 rows.
  - One local device failing does not mark the location down. The device stays down. The location stays up unless every local device is down.
- [x] **Status words and internet-down (2026-10-19)**
  - Badges are UP, DOWN, or NO DATA. Internet down stays DOWN. A silent collector is NO DATA, because the box can still be on the local network and resumes when the internet returns.
- [x] **Widget settings layout (2026-10-19)**
  - Access-point checkboxes sit beside the name. The resize grip stays at the bottom-right of the open settings instead of floating over the form.
- [x] **Device widgets: health card, AP cluster, bitrate, color (2026-10-19)**
  - Gauge settings open in a panel. Device label is Device. Metric list follows the device. Bandwidth is Kbps / Mbps / Gbps.
  - Device health card and AP cluster (merged clients, radio traffic, SNR). Per-widget color swatch.
- [x] **Collector unknown while LAN checks are up (2026-10-19)**
  - Root cause: collector health waited on host `up` / memory in Prometheus. A fresh Collector Console report (or per-device SNMP/ping) could mark local devices HEALTHY while the collector card stayed UNKNOWN (“Waiting for data”).
  - Fix: if that report or those device checks show SNMP or ping up, the collector and its Devices-page row are healthy. A silent collector with no successful LAN check still pauses device alarms.
- [x] **Client hostname / MAC / IP missing (2026-10-19)**
  - Prometheus client rows only have SNR and byte rates after the lookup panic fix. The page ignored the collector walk whenever those rows existed, so hostname, MAC, and IP stayed blank.
  - A fresh walk that has identity is now the client list. Live SNR and rates still overlay when the walk sends `clientIndex`.
- [x] **SNMP exporter panic stops all metrics (2026-10-19)**
  - Collector diagnostics: `pduValueAsString` / `indexesToLabels` in snmp_exporter v0.26.0. A text lookup (MAC, name, volume label) panics the Alloy process, so internet pings, interface counters, and speed test never arrive.
  - Removed those lookups from `snmp.yml` (`noc-snmp-no-lookups`). Client names still come from the console walk. Force apply after the site-box image is rebuilt so the volume file is replaced.
  - Follow-up: the marker sat above `modules:`, which regenerate strips, so Force apply stayed Stale forever. Marker now lives inside `modules:`. Diagnostics no longer treats `exited without error` as a remote_write failure. The stuck banner includes the real reason.
- [x] **Second DNS field on collector Setup (2026-10-19)**
  - Collector Console Setup now has Ping target 3 (second DNS), default 8.8.8.8, under the WAN DNS and WAN VPS fields. Save writes `PING_TARGET_3` and reloads Alloy.
- [x] **Dashboard network widgets and a second DNS ping (2026-10-19)**
  - Dashboard widgets Line use, Download / upload, AP traffic, and Speed test use the same site network API as the Network tab.
  - Internet DNS is up when either DNS server answers. The second ping is 8.8.8.8 (`PING_TARGET_3`, check `wan_dns2`) beside 1.1.1.1. The central-server ping is unchanged.
  - The second ping starts after the site-box image is rebuilt and Force apply runs. Until then, a failed first DNS still marks DNS down.
- [x] **Uplink follows probe data only (2026-10-19)**
  - Reverted treating “collector reached the NOC” as a healthy uplink. DNS and internet checks are `probe_success` only: no sample stays unknown, `1` is up, `0` or silence is down.
  - A location is not marked healthy while those probes have never reported. Critical collector, website, or local-device state can still mark it down.
- [x] **Line use totals match the daily breakdown (2026-10-21)**
  - Today, 7 days, and 30 days are calendar days in `NOC_TZ` (midnight, Malaysia). Each total is the sum of hourly WAN counter increases for those days, so a missing day stays empty instead of being smeared across the range.
  - The same interface written twice is counted once (`max by (ifIndex)`).
  - 7-day and 30-day cards open a popup: daily download, upload, total, average full day, and busiest day. The popup total is the card total.
- [x] **Today line use, one device widget, richer metrics (2026-10-21)**
  - Today opens the same style of popup: WAN download, upload, and total, the hourly chart, each access point’s volume since midnight, and the highest client. Cambium client volume is counter increase since midnight. Omada has no byte counters, so that row is the live rate.
  - The dashboard catalog offers one Local devices widget. Settings pick List, Stack, Card, or AP cluster. Boards saved as the old SNMP device, stack, or AP cluster types still render.
  - Gauge, line, and bar settings use a grouped metric catalog (Health, Traffic, Ports, Storage, Signal) filtered to the device. Device health can pick its stats from that catalog; a card with no selection keeps its previous three stats.
  - Collector metrics come from the unix exporter already on the NUC. Shared interface metrics (throughput, busiest port, utilization, capacity, ports, errors, discards, bytes today) apply to firewall, switch, AP, NAS, and router. Cambium adds SNR, weak clients, busiest client, and client bytes today.
  - FortiGate and Omada extra numbers are numeric SNMP columns in `snmp.yml`. They show up only after the collector image is rebuilt and Force apply runs.
  - Line-use card labels (Details / Daily) wrap inside the card instead of drawing past the border on a narrow tile.

