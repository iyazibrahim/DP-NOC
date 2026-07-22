# Cut over to site-box SNMP (drop legacy `integrations/snmp`)

**Canonical path only:** `job="site_snmp_if_mib"` + **`up{job="site_snmp_if_mib",device=...}`** (and `snmp_up` when the exporter emits it).

**Important (Alloy v1.5.1):** `prometheus.exporter.snmp` sets `job = "integrations/snmp/" + target_name` automatically. Plain `job_name = "site_snmp_if_mib"` on the scrape is **ignored**. Site-box `generate-config.sh` must include `discovery.relabel "snmp_job"` + `prometheus.relabel "snmp_canonical"` to force `job="site_snmp_if_mib"`. Without that, Grafana only shows `integrations/snmp/site_1_fw1` and looks like “legacy only”.

**Unsupported:** leaving that default job as-is for NOC health (NOC prefers `snmp_up` / `site_snmp_if_mib`).

Host metrics may still use `integrations/unix` dual-read in NOC until all sites use `site_host` — that is separate from SNMP.

## Target (site-1 example)

| Item | Value |
|------|--------|
| Alloy | `grafana/alloy:v1.5.1` via site-box compose |
| SNMP job | `site_snmp_if_mib` (forced via relabel) |
| Device id | `site-1-fw1` @ `192.168.1.1` |
| Community | `FortiSNMP` (Console Default / per-device) |
| NOC status | `snmp_up` **or** `up{job="site_snmp_if_mib",device="site-1-fw1"}` |

## Dokploy cutover checklist (NUC)

1. **Environment** (keep): `CENTRAL_REMOTE_WRITE_URL`, `CF_ACCESS_*`, `SITE_NAME=site-1`, `HOST_DEVICE_ID=site-1-nuc`, ping targets, optional `NOC_API_URL` / `COLLECTOR_TOKEN`.

2. **Patches — delete or replace**
   - Any patch that injects legacy Alloy config with `integrations.snmp` / job names `integrations/snmp/site_1_*`
   - Any hand-edited live `config.alloy` patch (Console sync regenerates it)
   - Keep only: repo-root `docker-compose.site-box.yml` (Dokploy Compose Path) + Environment secrets; optional community note
   - Do **not** use `sites/templates/site-box/docker-compose.yml` as Dokploy Compose Path (`.:/data` mounts monorepo → generate-config missing)

3. **Redeploy** site-box from git with **rebuild** (`collector-console` + `noc_site_alloy`) so `/opt/sitebox/generate-config.sh` includes SNMP job relabel.

4. Confirm containers: `noc_collector_console` **and** `noc_site_alloy`.

5. Open Console `http://<nuc-ip>:8090`
   - Setup → **Default SNMP community** = `FortiSNMP` → Save
   - Local devices: only **`site-1-fw1`** (remove `site-1-firewall1` on NOC if duplicate)
   - **Force apply SNMP**

6. Optional on host: `./repair-alloy.sh` then `./verify-snmp-queries.sh site-1-fw1`

7. Alloy logs must **not** contain `config_merge_strategy` / `invalid duration` / `could not perform the initial load`.
   Config must contain `prometheus.exporter.snmp`, `discovery.relabel "snmp_job"`, and `site_snmp_if_mib`.

## Grafana prove (after ~2 minutes)

```promql
up{job="site_host",site="site-1"}
up{job="site_snmp_if_mib",site="site-1"}
up{job="site_snmp_if_mib",device="site-1-fw1"}
snmp_up{site="site-1",device="site-1-fw1"}
time() - timestamp(up{job="integrations/snmp/site_1_fw1"})
```

Success: `up{job="site_snmp_if_mib",device="site-1-fw1"}` = 1 (fresh). `snmp_up` may also appear; NOC accepts either. Legacy `integrations/snmp/...` age should grow (>60s) after relabel.

Do **not** use legacy series for NOC health once site_snmp_if_mib is fresh.

## Fortinet reminder

```bash
snmpwalk -v2c -c FortiSNMP 192.168.1.1 1.3.6.1.2.1.1.1.0
```

Must respond from the NUC (host IP allowed on FortiGate SNMP). Community must match Console / `snmp.yml`.
