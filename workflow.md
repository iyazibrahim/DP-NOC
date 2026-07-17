# NOC (Network Operations Center) Multisite System

## Goal
Create a multisite NOC dashboard and monitoring system for:
1) Network connectivity (WAN/LAN health for each site)
2) Website uptime/latency checks

You prefer:
- Centralized monitoring (harder to run full agents at every site)
- A UI that you can customize (Grafana/React-style), not “stock Zabbix screens”

## v1 Scope (5 sites)
Included:
- WAN/link health per site (ICMP/ping, latency/loss)
- Local LAN device checks (SNMP/ICMP) for sites that have a small always-on box
- Public website checks (HTTP(S) uptime + latency) from the central VPS
- Alerts routed to Telegram + email (via Alertmanager)
- TV wallboard: status map + site cards + alert ticker

Explicitly excluded for v1:
- Full host CPU/RAM/disk inventory per server/VM
- Full Zabbix deployment
- Deep SNMP discovery for every possible device
- Bidirectional VPN mesh (future)

## Architecture (chosen)
Sites with a box run a lightweight metrics agent that pushes outbound to the central VPS.
The VPS runs:
- Prometheus (storage + alert rules)
- Alertmanager (Telegram/email)
- Grafana (dashboards + drill-down graphs)
- Blackbox exporter (website uptime/latency checks)
- NOC API (site registry + aggregated status + wallboard endpoints)
- React wallboard (custom look/feel, map + status + links to Grafana)

## Build Plan / To-dos
1. Central services: `docker-compose.yml` (Prometheus, Grafana, Alertmanager, Blackbox, reverse proxy)
2. Site agent template: Grafana Alloy config for SNMP/ICMP + `remote_write` to the VPS
3. NOC API: Node/Express + JWT + endpoints for wallboard
4. React wallboard: map + per-site cards + alert ticker + Grafana links
5. Alert rules: Prometheus rules + Alertmanager Telegram/email config for 5-site v1
6. Validation: run docker stack locally, seed 5 sites, smoke-test the wallboard endpoints

## Operational Notes
- Prefer outbound-only connectivity from sites (avoid inbound firewall complexity).
- Treat “network-only” sites as “external view” until a site box exists.
- Each site is configured as a unit (name, location, watched websites, optional SNMP targets).

## Progress Log
 - [x] Central VPS stack scaffolded (`docker-compose.yml`, Prometheus/Grafana/Alertmanager/Blackbox)
 - [x] Alloy site-box templates added (`sites/templates/site-box/`)
 - [x] NOC API scaffolded + integrated into Compose (`backend/noc-api/`)
 - [x] React wallboard scaffolded (`frontend/wallboard/`)
 - [x] Prometheus alert rules + Alertmanager Telegram/email placeholders configured
 - [x] Seeded 5 example sites with `sites/site-*/env.example`
 - [x] Validation (manual checklist created)

## Local Validation (expected)
1. Central stack
   - `cd C:\Users\IyazIbrahim\Desktop\Project\NOC`
   - `docker compose up -d --build`
   - Open:
     - Prometheus: `http://localhost:9090`
     - Grafana: `http://localhost:3000`
     - NOC API health: `http://localhost:8080/health`
2. JWT login (default compose creds)
   - Username/password: `admin / admin`
3. Wallboard
   - `cd C:\Users\IyazIbrahim\Desktop\Project\NOC\frontend\wallboard`
   - `npm install`
   - Run with env (example):
     - `set VITE_API_BASE_URL=http://localhost:8080`
     - `set VITE_WALLBOARD_USERNAME=admin`
     - `set VITE_WALLBOARD_PASSWORD=admin`
     - `set VITE_GRAFANA_DASHBOARD_URL=http://localhost:3000`
   - `npm run dev`

## Notes
- Website and alerting labels require the `check="website"` convention (already wired in Prometheus rules + NOC API).
- Reverse proxy (Traefik) host rules:
  - `grafana.noc.local` -> Grafana
  - `api.noc.local` -> NOC API
  Add entries to your `hosts` file pointing both hostnames to `127.0.0.1`.

## Documentation and repository hygiene
- [x] Added the root `README.md` with architecture, setup, site configuration, and production-security guidance.
- [x] Added the root `.gitignore` for dependencies, generated builds, secrets, editor files, caches, logs, temporary files, and local service data.
- [x] Preserved trackable `.env.example` and `env.example` templates while ignoring real environment files.

