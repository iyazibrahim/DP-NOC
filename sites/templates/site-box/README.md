# Site box (Alloy) template — **Collector**

Lightweight collector for a NUC / mini-PC / Pi / server at **one** site.

Responsibilities:
1. Uplink / internet ICMP probes
2. SNMP polling for local devices (from `devices.json`)
3. **Host metrics** on the collector itself (CPU, memory, disk via `prometheus.exporter.unix`)
4. Push metrics to central Prometheus via `remote_write` over **HTTPS + Cloudflare Access Service Token**

Labels: set `SITE_NAME=site-1` and `HOST_DEVICE_ID=site-1-nuc` so React can auto-adopt the collector. See identity contract in [`docs/ALLOY_COLLECTOR.md`](../../../docs/ALLOY_COLLECTOR.md).

## Quick deploy (NUC)

```bash
chmod +x deploy.sh generate-config.sh sync-devices.sh
./deploy.sh
docker compose up -d --build
```

Requires: Docker, Docker Compose, python3.

Then open **Collector Console**: `http://<nuc-lan-ip>:8090` — paste collector token from NOC UI, save. Sync runs automatically.

## Dokploy (why you only see `noc_site_alloy`)

This compose defines **two** containers:

| Container | Role |
|---|---|
| `noc_collector_console` | Web UI on port **8090** + auto-sync |
| `noc_site_alloy` | SNMP / ICMP / host metrics |

If Dokploy shows only Alloy, your **Patches → `docker-compose.yml`** is still the old Alloy-only file and overrides git.

**Fix:**

1. Push this repo (including `sites/templates/site-box/collector-console/`) to the git remote Dokploy uses.
2. In Dokploy → Sitebox → **Patches** → edit `sites/templates/site-box/docker-compose.yml`:
   - Either **delete** that patch so git’s compose is used, or
   - Replace the patch contents with the full two-service compose from this repo.
3. Redeploy with **rebuild** (Collector Console uses `build: ./collector-console`).
4. Confirm Containers tab shows **both** `noc_collector_console` and `noc_site_alloy`.
5. On the NUC LAN, open `http://<nuc-ip>:8090` (do **not** put 8090 on a public Cloudflare domain).

Build context must be the **site-box** folder (where `docker-compose.yml` and `collector-console/` live), not the monorepo root.

## Files

| File | Role |
|---|---|
| `collector-console/` | **Web UI + API** — setup, auto-sync, Alloy management (port 8090) |
| `deploy.sh` | Docker check + site/device wizard + `compose up` |
| `generate-config.sh` | Build `config.alloy` from `devices.json` |
| `sync-devices.sh` | Legacy shell sync (console calls same logic internally) |
| `docker-compose.yml` | Collector Console + Grafana Alloy (`host` network + `NET_RAW`) |
| `blackbox.yml` | ICMP probe module (used via `config_file`) |
| `devices.json` | SNMP targets for this site (synced from NOC API) |
| `.env` | Secrets + `SITE_NAME` (gitignored) |
| `snmp.yml` | SNMPv2c / if_mib module |

## Collector Console

| Page | Purpose |
|---|---|
| **Dashboard** | Add SNMP device → NOC, Alloy status, last sync, device list, Sync now |
| **Setup** | NOC URL, collector token, CF Access, SNMP community, ping targets |
| **Settings** | Sync interval, view `config.alloy`, Alloy logs |

Add devices on the collector page; they register on NOC and Alloy starts SNMP polling after sync.

LAN only — do not expose port 8090 to the public internet.

## Host metrics (NUC CPU / RAM / disk)

Alloy collects Linux host metrics with `prometheus.exporter.unix`. **You must bind-mount the NUC root filesystem** into the container:

| Host path | Container path | Mode |
|---|---|---|
| `/` | `/rootfs` | read-only |

In Dokploy: add a **volume** on the alloy service: ` /:/rootfs:ro `

Without this mount you will see: `stat /rootfs/proc: no such file or directory`.

Set `HOST_DEVICE_ID` (default `{SITE_NAME}-nuc`, e.g. `site-1-nuc`) so series are labeled for Grafana:

```promql
node_cpu_seconds_total{site="site-1", device="site-1-nuc"}
node_memory_MemAvailable_bytes{site="site-1", device="site-1-nuc"}
```

Add the same id in NOC UI (Sites → Add device, type `server`) for inventory.

## Outbound connectivity

- HTTPS **443** to `metrics.<your-domain>` (Cloudflare Tunnel)
- No inbound ports required on the site (collector console is LAN-only)

## After UI device changes

With Collector Console configured, devices sync automatically (~90s). Use **Sync now** on the dashboard for immediate pull.

Legacy: `./sync-devices.sh` or cron. Without sync: edit `devices.json` or re-run `deploy.sh`, then `./generate-config.sh && docker compose up -d --force-recreate alloy`.

**Never commit real Access token secrets.**
