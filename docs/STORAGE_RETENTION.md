# Prometheus storage and retention

Central Prometheus on the VPS stores all site metrics via `remote_write`. On a **40GB VPS**, cap TSDB growth so logs and other services keep headroom.

## Defaults

| Setting | Default | Purpose |
|---|---|---|
| `retention.time` | **28d** | Keep roughly 2–4 weeks of history |
| `retention.size` | **10GB** | Hard cap on TSDB disk use |
| Scrape interval (Alloy) | **60s** | Host, ICMP, SNMP |

These defaults are applied at Prometheus **container start** via `prometheus-retention.flags` on the shared `noc_runtime` volume.

## UI control (Settings → Storage)

1. **Save** — writes `data/runtime/retention.json` and regenerates `prometheus-retention.flags`.
2. **Apply to Prometheus** — runs `PROMETHEUS_APPLY_CMD` if set (typically `docker restart noc_prometheus` on the VPS).

Prometheus must **restart** to pick up new retention flags; a noc-app rebuild is not required.

### VPS apply command

On Dokploy/VPS, optionally mount the Docker socket and set on `noc-app`:

```env
PROMETHEUS_APPLY_CMD=docker restart noc_prometheus
```

Without this, save still persists config; restart the Prometheus service manually from Dokploy after changing retention.

## Scrape intervals (NUC Alloy)

Retention settings also store recommended scrape intervals. On each NUC, set before running `generate-config.sh`:

```bash
export SCRAPE_INTERVAL_SEC=60   # match Settings → Storage
./generate-config.sh
docker compose restart
```

Separate env vars can be used per job in a future release; today one interval applies to ICMP, host, and SNMP scrapes.

## Monitoring disk use

Settings shows:

- Configured retention time and size cap
- Live TSDB stats from Prometheus `/api/v1/status/tsdb` when reachable
- `prometheus_tsdb_storage_blocks_bytes` when available

A daily job logs a warning if TSDB size approaches the configured cap.

## Export file retention

Weekly and monthly report files under `data/exports/` are pruned automatically: **last 12** of each period.

## Disaster recovery

- **Sites:** Settings → “Reset sites from seed” (operator only) restores Penang seed locations.
- **Prometheus data:** TSDB lives in Docker volume `prometheus_data`. Back up that volume before major retention changes if you need historical archives.
