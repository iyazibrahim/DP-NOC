# Site box (Alloy) template — **Collector**

Lightweight collector for a NUC / mini-PC / Pi / server at **one** site.

**Alloy pin:** `grafana/alloy:v1.5.1` only. Do not bump mid-incident. This version has **no** `config_merge_strategy`; SNMP uses a **full** `snmp.yml` (auths + if_mib metrics).

Responsibilities:
1. Uplink / internet ICMP probes
2. SNMP polling for local devices (from `devices.json`)
3. **Host metrics** on the collector itself (CPU, memory, disk via `prometheus.exporter.unix`)
4. Push metrics to central Prometheus via `remote_write` over **HTTPS + Cloudflare Access Service Token**

Labels: set `SITE_NAME=site-1` and `HOST_DEVICE_ID=site-1-nuc` so React can auto-adopt the collector. See identity contract in [`docs/ALLOY_COLLECTOR.md`](../../../docs/ALLOY_COLLECTOR.md).

## Quick deploy (NUC)

```bash
chmod +x deploy.sh generate-config.sh sync-devices.sh validate-config.sh repair-alloy.sh verify-snmp-queries.sh cutover-sitebox-snmp.sh
./deploy.sh
docker compose up -d --build
```

Requires: Docker, Docker Compose, python3.

Then open **Collector Console**: `http://<nuc-lan-ip>:8090` — paste collector token from NOC UI, save. Sync runs automatically.

## Dokploy operating rules (non-negotiable)

### Compose Path

Set Dokploy **Compose Path** to the **repo-root** file:

```text
docker-compose.site-box.yml
```

Do **not** use `sites/templates/site-box/docker-compose.yml` in Dokploy. That file uses `.:/data`, and Dokploy’s working directory is the monorepo root — `/data` becomes the whole repo and Console fails with `generate-config.sh not found`.

### Environment only (survives redeploy)

Set **once** in Dokploy → **Environment** — never rely on a Setup-written `.env` in the git checkout alone:

```text
CENTRAL_REMOTE_WRITE_URL=https://metrics.iyazbrhm.cloud/api/v1/write
CF_ACCESS_CLIENT_ID=...
CF_ACCESS_CLIENT_SECRET=...
SITE_NAME=site-1
HOST_DEVICE_ID=site-1-nuc
PING_TARGET_1=1.1.1.1
PING_TARGET_2=...
NOC_API_URL=https://noc.iyazbrhm.cloud
COLLECTOR_TOKEN=nocc_...
SCRAPE_INTERVAL_SEC=15
```

Compose mounts named volume `noc_sitebox_state` for token/devices backup.

### Patches — what is allowed

| Patch | Allowed? |
|---|---|
| `docker-compose.yml` (two services: console + alloy v1.5.1) | Yes, if matching git |
| `snmp.yml` community string only | Yes |
| `generate-config.sh` / `validate-config.sh` from git | Yes (keep in sync) |
| Live `config.alloy` | **No** once Collector Console sync / Force apply is used — sync regenerates it and will overwrite your patch |

If Patches still ship an old `generate-config.sh` with `config_merge_strategy` or quoted `${SCRAPE_INTERVAL_SEC}`, Alloy crashes and **SNMP never reaches Prometheus** while host metrics may still work.

After updating generators: delete conflicting patches → redeploy → on NUC run `./repair-alloy.sh`.

**Cut over from legacy SNMP:** if Grafana shows `job="integrations/snmp/..."` and no `snmp_up`, follow [`CUTOVER_SITEBOX_SNMP.md`](CUTOVER_SITEBOX_SNMP.md). Do not patch integrations SNMP back in.

## Why SNMP “never sends data”

Host metrics (`up{job="site_host"}`) can be UP while SNMP is empty. Empty `up{job="site_snmp_if_mib"}` means the SNMP scrape job never ran (bad/missing config, Alloy crash, or still on legacy `integrations/snmp`), not Fortinet yet.

Prove in Grafana after repair (wait ~60s):

1. `up{job="site_host",site="site-1"}`
2. `up{job="site_snmp_if_mib"}` ← gate (must be this job, not `integrations/snmp`)
3. `snmp_up{site="site-1"}` then exact `device` id (e.g. `site-1-fw1`, no spaces)

Local check: `./verify-snmp-queries.sh site-1-fw1`

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
| `generate-config.sh` | Build `config.alloy` from `devices.json` (v1.5.1-safe) |
| `validate-config.sh` | Fail-closed crash-pattern checks before Alloy restart |
| `repair-alloy.sh` | Regenerate + validate + restart Alloy; print Grafana checklist |
| `verify-snmp-queries.sh` | Local generate/validate + print site-box prove queries |
| `CUTOVER_SITEBOX_SNMP.md` | Drop legacy `integrations/snmp` → site-box `site_snmp_if_mib` + `snmp_up` |
| `cutover-sitebox-snmp.sh` | NUC checklist: reject legacy config, repair Alloy, print Grafana prove |
| `sync-devices.sh` | Legacy shell sync (console calls same logic internally) |
| `docker-compose.yml` | Collector Console + Grafana Alloy **v1.5.1** |
| `blackbox.yml` | ICMP probe module (used via `config_file`) |
| `devices.json` | SNMP targets for this site (synced from NOC API) |
| `.env` | Secrets + `SITE_NAME` (gitignored) |
| `snmp.yml` | SNMPv2c if_mib module; auths rewritten by `generate-config.sh` (default + per-device) |

## Collector Console

| Page | Purpose |
|---|---|
| **Dashboard** | Add SNMP device → NOC, Alloy status, Metrics push, SNMP scrape hint, Sync / Force apply |
| **Setup** | NOC URL, collector token, CF Access, **Default SNMP community**, ping targets |
| **Settings** | Sync interval, view `config.alloy`, Alloy logs |

Green **Alloy Running** does **not** mean Prometheus has `snmp_up`. Use the **SNMP scrape** card hint and Grafana.

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

With Collector Console configured, devices sync automatically (~90s). Use **Sync now** on the dashboard for immediate pull. Prefer **`docker restart noc_site_alloy`** (Console does this) over recreate so Dokploy Environment stays intact.

Legacy: `./sync-devices.sh` or cron. Without sync: edit `devices.json`, then `./generate-config.sh && ./validate-config.sh && docker restart noc_site_alloy`.

**Never commit real Access token secrets.**
