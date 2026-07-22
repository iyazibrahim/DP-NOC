# Cut over to site-box SNMP (drop legacy `integrations/snmp`)

**Canonical path only:** `job="site_snmp_if_mib"` + metric **`snmp_up`**.

**Unsupported:** Grafana Agent/Alloy **`integrations/snmp/*`** (may show `ifDescr` / `up=1` but **no `snmp_up`** → NOC Local devices stay UNKNOWN).

Host metrics may still use `integrations/unix` dual-read in NOC until all sites use `site_host` — that is separate from SNMP.

## Target (site-1 example)

| Item | Value |
|------|--------|
| Alloy | `grafana/alloy:v1.5.1` via site-box compose |
| SNMP job | `site_snmp_if_mib` |
| Device id | `site-1-fw1` @ `192.168.1.1` |
| Community | `FortiSNMP` (Console Default / per-device) |
| NOC status | `snmp_up{site="site-1",device="site-1-fw1"}` |

## Dokploy cutover checklist (NUC)

1. **Environment** (keep): `CENTRAL_REMOTE_WRITE_URL`, `CF_ACCESS_*`, `SITE_NAME=site-1`, `HOST_DEVICE_ID=site-1-nuc`, ping targets, optional `NOC_API_URL` / `COLLECTOR_TOKEN`.

2. **Patches — delete or replace**
   - Any patch that injects legacy Alloy config with `integrations.snmp` / job names `integrations/snmp/site_1_*`
   - Any hand-edited live `config.alloy` patch (Console sync regenerates it)
   - Keep only: site-box `docker-compose.yml` (console + alloy) matching git; optional community note

3. **Redeploy** site-box from git with **rebuild** (`collector-console` + `noc_site_alloy`).

4. Confirm containers: `noc_collector_console` **and** `noc_site_alloy`.

5. Open Console `http://<nuc-ip>:8090`
   - Setup → **Default SNMP community** = `FortiSNMP` → Save
   - Local devices: only **`site-1-fw1`** (remove `site-1-firewall1` on NOC if duplicate)
   - **Force apply SNMP**

6. Optional on host: `./repair-alloy.sh` then `./verify-snmp-queries.sh site-1-fw1`

7. Alloy logs must **not** contain `config_merge_strategy` / `invalid duration` / `could not perform the initial load`.
   Config must contain `prometheus.exporter.snmp` and `site_snmp_if_mib`.

## Grafana prove (after ~2 minutes)

```promql
up{job="site_host",site="site-1"}
up{job="site_snmp_if_mib",site="site-1"}
snmp_up{site="site-1",device="site-1-fw1"}
```

Success: scrape `up` = 1 and **`snmp_up` = 1**. NOC Sites → Local devices → HEALTHY.

Legacy should go stale (no new points):

```promql
up{job="integrations/snmp/site_1_fw1"}
```

Do **not** use that series for NOC health.

## Fortinet reminder

```bash
snmpwalk -v2c -c FortiSNMP 192.168.1.1 1.3.6.1.2.1.1.1.0
```

Must respond from the NUC (host IP allowed on FortiGate SNMP). Community must match Console / `snmp.yml`.
