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
| **Dashboard** | Alloy status, last sync, device list, Sync now |
| **Setup** | NOC URL, collector token, CF Access, SNMP community, ping targets |
| **Settings** | Sync interval, view `config.alloy`, Alloy logs |

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
