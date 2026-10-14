# SNMP vendor health packs

Each network device always scrapes **`if_mib`**. `generate-config.sh` adds **one extra SNMP target** (same IP/auth/`device` label) when type + vendor match.

| Device type | Vendor (normalized) | Extra module | Metrics |
|---|---|---|---|
| `firewall` | `fortinet` / `fortigate` / empty | `fortigate_health` | `fgSysCpuUsage`, `fgSysMemUsage`, `fgSysSesCount` |
| `nas` | `synology` / `syno` / empty / `generic` | `synology_health` | `synoTemperature`, `synoDisk*`, `synoRaid*`, `hrProcessorLoad`, `memTotalReal` / `memAvailReal` |
| `switch` | `maipu` | `maipu_health` | HOST-RESOURCES `hrProcessorLoad`, `hrStorage*` |
| `ap` | `cambium` | `cambium_ap_health` (15s) + `cambium_clients` (60s) | Health: CPU + total clients. Stations: `cambiumClientInfo` / SNR / Tx\|Rx bytes on slow scrape |
| `ap` | `omada` / `tp-link` / `tplink` | `omada_ap_health` (15s) + `omada_clients` (60s) | Health: `omadaClientCount`. MAC rows on slow scrape when supported |

**NAS wallboard:** Type `nas` is an SNMP device (`kind: network`). Dashboard uses the same Gauge / Line chart / Bar / SNMP device / Device stack widgets as firewalls and APs. Volume free % uses the existing gauge pie (teal = used). RAID uses the UP/DOWN gauge. LAN traffic is IF-MIB `if_in_bps` / `if_out_bps`.

**Network / Clients tabs:** Site → Network shows AP client bars/pies from totals. Site → **Clients** lists per-station rows from the **slow** `site_snmp_clients` job (`cambium_clients` / `omada_clients`). Do **not** put station walks on the 15s health path — that timed out Alloy and made firewall/switch/NAS look DOWN. Inventory: `type=ap` (or `access-point`) + vendor; Force-apply after updating collector-console.

## Ops: apply on collectors

1. **Rebuild and redeploy collector-console** (image embeds `/opt/sitebox/snmp.yml`). Redeploying only noc-app is not enough for new SNMP packs.
2. **Force apply** in Collector Console (regenerate `config.alloy` + refresh stale `snmp.yml` modules from the image + restart Alloy).
3. Set **type** and **vendor** correctly on each device in Sites (e.g. firewall + fortinet, AP + cambium).
4. Prove with `snmpget`/`snmpwalk` on the collector LAN, then Prometheus series, then wallboard charts.

`generate-config.sh` rewrites **auths** and replaces the `modules:` block when the image template has newer markers (`synology_health`, `cambiumClientInfo`, `omadaClientInfo`, …) that the volume `snmp.yml` lacks. Diagnostics show `snmpStaleReason` if Force apply still reports Stale.

If Force apply says “Sync already in progress”, wait a few seconds and click again (the 90s sync loop can hold the lock).

## OID notes

### FortiGate (verified enterprise OIDs)

- CPU %: `1.3.6.1.4.1.12356.101.4.1.3` (`fgSysCpuUsage`)
- Memory %: `1.3.6.1.4.1.12356.101.4.1.4` (`fgSysMemUsage`)
- Sessions: `1.3.6.1.4.1.12356.101.4.1.8` (`fgSysSesCount`)

### Cambium cnPilot

- CPU: `1.3.6.1.4.1.17713.22.1.1.1.6.0`
- Clients (total): `1.3.6.1.4.1.17713.22.1.1.1.14.0`
- Station table (`cambiumClientTable`): module **`cambium_clients`**, scrape job `site_snmp_clients` every **60s** (timeout 45s)
  - Prom series: `cambiumClientInfo`, `cambiumClientSNR`, `cambiumClientTxDataBytes`, `cambiumClientRxDataBytes`
  - Live bandwidth: `rate(cambiumClient*DataBytes[5m])*8`

E-series (E410 etc.) expose AP health as **scalar `.0`**. The **client table** is Integer32-indexed (`clientIndex`).

Collector Console may store type as `access-point`; Alloy accepts that as AP.

### Omada / TP-Link EAP

- Clients (total): `1.3.6.1.4.1.11863.10.1.1.1` on **`omada_ap_health`** (15s) — model/firmware dependent.
- Station MAC table: module **`omada_clients`** (60s) → `omadaClientInfo`. No per-client SNMP bandwidth.

### Synology NAS (verified DSM SNMP OIDs)

Enable **SNMP service** on the NAS (Control Panel → Terminal & SNMP). Community must match the collector default or the per-device field.

- System status: `1.3.6.1.4.1.6574.1.1` (`synoSystemStatus` — 1 Normal, 2 Failed)
- Temperature °C: `1.3.6.1.4.1.6574.1.2` (`synoTemperature`)
- Disk status: `1.3.6.1.4.1.6574.2.1.1.5` (`synoDiskStatus` — 4/5 = failed)
- Disk temperature: `1.3.6.1.4.1.6574.2.1.1.6` (`synoDiskTemperature`)
- RAID status: `1.3.6.1.4.1.6574.3.1.1.3` (`synoRaidStatus` — 11 Degrade, 12 Crashed)
- RAID free/total: `1.3.6.1.4.1.6574.3.1.1.4` / `.5` (`synoRaidFreeSize` / `synoRaidTotalSize`)
- CPU: HOST-RESOURCES `hrProcessorLoad`
- Memory: UCD `memTotalReal` / `memAvailReal` (`1.3.6.1.4.1.2021.4.5` / `.6`)

Wallboard presets: `nas_vol_free_pct` (HOST-RESOURCES `/volume*` free %, RAID size fallback), `nas_raid_ok`, `nas_cpu_pct`, `nas_mem_pct`, `nas_temp_c`, `nas_disk_temp_max_c`, `nas_disk_failed`, plus IF-MIB traffic.

**Stale collector `snmp.yml`:** named volume keeps old modules. Rebuild **collector-console**, then Force apply (or restart Console). generate-config pulls `synology_health` from the image `/opt/sitebox/snmp.yml` when the live file is missing it.

### Maipu switch

Private MIBs vary by model. Baseline uses **HOST-RESOURCES-MIB**. After a live `snmpwalk` on your Maipu, add enterprise OIDs under `maipu_health` in `sites/templates/site-box/snmp.yml` and document them here.
