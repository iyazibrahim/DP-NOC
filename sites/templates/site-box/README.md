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
```

Requires: Docker, Docker Compose, python3.

## Files

| File | Role |
|---|---|
| `deploy.sh` | Docker check + site/device wizard + `compose up` |
| `generate-config.sh` | Build `config.alloy` from `devices.json` |
| `sync-devices.sh` | Pull SNMP inventory from NOC UI (`COLLECTOR_TOKEN`) |
| `docker-compose.yml` | Grafana Alloy (`host` network + `NET_RAW`) |
| `blackbox.yml` | ICMP probe module (used via `config_file`) |
| `devices.json` | SNMP targets for this site (cache when sync is enabled) |
| `.env` | Secrets + `SITE_NAME` (gitignored) |
| `snmp.yml` | SNMPv2c / if_mib module |

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
- No inbound ports required on the site

## After UI device changes

With `COLLECTOR_TOKEN` + `NOC_API_URL` set, run `./sync-devices.sh` (or cron / `--loop`). The UI is the source of truth for SNMP targets.

Without sync: edit `devices.json` or re-run `deploy.sh`, then `./generate-config.sh && docker compose up -d --force-recreate`.

**Never commit real Access token secrets.**
