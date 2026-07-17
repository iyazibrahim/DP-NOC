# Multisite NOC System

A lightweight Network Operations Center for monitoring connectivity, network devices, and public websites across multiple sites.

The system uses small Grafana Alloy agents at supported sites, a central Prometheus stack on a VPS, Grafana for detailed investigation, and a custom React wallboard for at-a-glance operations.

## Architecture

```text
Remote site boxes
  ├─ ICMP probes for WAN health
  ├─ SNMP polling for LAN equipment
  └─ Prometheus remote_write
             │
             ▼
Central VPS
  ├─ Prometheus
  ├─ Blackbox Exporter
  ├─ Alertmanager
  ├─ Grafana
  ├─ Node/Express NOC API
  ├─ React wallboard
  └─ Traefik
```

Sites without an agent can still receive public website monitoring from the central VPS. Internal LAN and SNMP visibility requires a site box or a future VPN connection.

## Repository structure

```text
backend/noc-api/           JWT-protected status and alert API
frontend/wallboard/        React and TypeScript NOC wallboard
infra/                     Prometheus, Grafana, Alertmanager, Blackbox configs
sites/                     Site templates and five example site configurations
docker-compose.yml         Central VPS services
workflow.md                Project status and operational notes
```

## Requirements

- Docker Engine with Docker Compose
- Node.js 20 or newer for running the wallboard outside Docker
- A Linux site box for each location requiring local ICMP or SNMP monitoring

## Start the central services

```powershell
docker compose up -d --build
```

Default local endpoints:

- Prometheus: `http://localhost:9090`
- Alertmanager: `http://localhost:9093`
- Grafana: `http://localhost:3000`
- NOC API health: `http://localhost:8080/health`

Development credentials currently configured in Compose:

- NOC API: `admin` / `admin`
- Grafana: `admin` / `admin`

These credentials and the JWT secret must be changed before deployment.

## Start the wallboard

```powershell
cd frontend\wallboard
npm install
$env:VITE_API_BASE_URL = "http://localhost:8080"
$env:VITE_GRAFANA_DASHBOARD_URL = "http://localhost:3000"
npm run dev
```

Open the URL printed by Vite and log in with the NOC API credentials.

Do not place production passwords in `VITE_*` variables. Vite embeds these values into browser assets. Use the interactive login until a secure kiosk-token flow is implemented.

## Configure the five sites

The example registry is stored at:

```text
backend/noc-api/data/seed-sites.json
```

Replace the placeholder site names, coordinates, public addresses, SNMP targets, and website URLs.

Central website probes are configured separately in:

```text
infra/prometheus/prometheus.yml
```

The site IDs and website URLs must remain aligned between these two files.

For a site box:

1. Copy `sites/templates/site-box/config.alloy`.
2. Copy `sites/templates/site-box/snmp.yml` when SNMP is required.
3. Use the corresponding `sites/site-*/env.example` as a template.
4. Set a real central remote-write URL and target addresses.
5. Grant Alloy the Linux raw-socket capability required for ICMP probes.

## Alerts

Prometheus alert rules are located at:

```text
infra/prometheus/rules/noc-site-alerts.yml
```

Configure real Telegram and SMTP values in:

```text
infra/alertmanager/alertmanager.yml
```

The checked-in values are placeholders and must not be used in production.

## Reverse proxy

Traefik defines these development host rules:

- `grafana.noc.local` routes to Grafana.
- `api.noc.local` routes to the NOC API.

Add both names to the local hosts file if you want to use those routes. Direct service ports remain available during development.

## Production security requirements

The current repository is a development scaffold. Before exposing it publicly:

- Put remote write behind HTTPS and authentication.
- Do not expose Prometheus, Alertmanager, or Blackbox Exporter directly.
- Replace all default credentials and JWT secrets.
- Store notification credentials outside Git.
- Add TLS to Traefik.
- Restrict API CORS origins.
- Create a limited wallboard or kiosk identity.
- Set real site coordinates so map markers do not overlap.
- Validate retention, backups, and recovery procedures.

## Development files

The root `.gitignore` excludes dependencies, build output, environment secrets, editor metadata, caches, logs, test reports, temporary files, and local Docker data. Example environment files remain trackable.

