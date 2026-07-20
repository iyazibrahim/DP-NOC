# Site box (Alloy) template

Lightweight collector for a NUC / mini-PC at **one** site.

Responsibilities:
1. ICMP probes (WAN health)
2. SNMP polling for local gear (from `devices.json`)
3. Push metrics to central Prometheus via `remote_write` over **HTTPS + Cloudflare Access Service Token**

Full runbook: [`docs/ALLOY_COLLECTOR.md`](../../../docs/ALLOY_COLLECTOR.md)

## Quick deploy (NUC)

```bash
chmod +x deploy.sh generate-config.sh
./deploy.sh
```

Requires: Docker, Docker Compose, python3.

## Files

| File | Role |
|---|---|
| `deploy.sh` | Docker check + site/device wizard + `compose up` |
| `generate-config.sh` | Build `config.alloy` from `devices.json` |
| `docker-compose.yml` | Grafana Alloy (`host` network + `NET_RAW`) |
| `blackbox.yml` | ICMP probe module (used via `config_file`) |
| `devices.json` | SNMP targets for this site |
| `.env` | Secrets + `SITE_NAME` (gitignored) |
| `snmp.yml` | SNMPv2c / if_mib module |

## Outbound connectivity

- HTTPS **443** to `metrics.<your-domain>` (Cloudflare Tunnel)
- No inbound ports required on the site

## After UI device changes

NOC UI device CRUD updates the central registry only. Re-sync the collector:

1. Edit `devices.json` (or re-run `deploy.sh`)
2. `./generate-config.sh && docker compose up -d --force-recreate`

**Never commit real Access token secrets.**
