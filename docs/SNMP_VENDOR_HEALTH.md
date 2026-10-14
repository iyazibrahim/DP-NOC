# SNMP vendor health packs

Each network device always scrapes **`if_mib`**. `generate-config.sh` adds **one extra SNMP target** (same IP/auth/`device` label) when type + vendor match.

| Device type | Vendor (normalized) | Extra module | Metrics |
|---|---|---|---|
| `firewall` | `fortinet` / `fortigate` / empty | `fortigate_health` | `fgSysCpuUsage`, `fgSysMemUsage`, `fgSysSesCount` |
| `nas` | `synology` / `syno` / empty / `generic` | `synology_health` | `synoTemperature`, `synoDisk*`, `synoRaid*`, `hrProcessorLoad`, `memTotalReal` / `memAvailReal` |
| `switch` | `maipu` | `maipu_health` | HOST-RESOURCES `hrProcessorLoad`, `hrStorage*` |
| `ap` | `cambium` | `cambium_ap_health` | `cambiumAPCPUUtilization`, `cambiumAPTotalClients`, `cambiumClientInfo` / `SNR` / `Tx|RxDataBytes` (station table) |
| `ap` | `omada` / `tp-link` / `tplink` | `omada_ap_health` | `omadaClientCount`, `omadaClientInfo` (MAC table when supported) |

**NAS wallboard:** Type `nas` is an SNMP device (`kind: network`). Dashboard uses the same Gauge / Line chart / Bar / SNMP device / Device stack widgets as firewalls and APs. Volume free % uses the existing gauge pie (teal = used). RAID uses the UP/DOWN gauge. LAN traffic is IF-MIB `if_in_bps` / `if_out_bps`.

**Network / Clients tabs:** Site → Network shows AP client bars/pies from totals. Site → **Clients** lists per-station rows from `cambiumClient*` (full fields + bandwidth) and `omadaClientInfo` (MAC only). Inventory must use `type=ap` and the matching vendor; Force-apply so Alloy scrapes the vendor module. Omada OID is fragile — empty series means walk the AP and update `omada_ap_health` if needed.

## Ops: apply on collectors

1. Redeploy / refresh the site-box template so `snmp.yml` includes the new modules.
2. **Force apply** (regenerate `config.alloy` + restart Alloy) so vendor targets appear.
3. Set **type** and **vendor** correctly on each device in Sites (e.g. firewall + fortinet).
4. Prove with `snmpget`/`snmpwalk` on the collector LAN, then Prometheus series, then wallboard charts.

`generate-config.sh` rewrites **auths** only and **preserves** the `modules:` block already in `snmp.yml`. If a volume still has an old `snmp.yml` (IF-MIB only), replace it from the image/template before Force-apply.

## OID notes

### FortiGate (verified enterprise OIDs)

- CPU %: `1.3.6.1.4.1.12356.101.4.1.3` (`fgSysCpuUsage`)
- Memory %: `1.3.6.1.4.1.12356.101.4.1.4` (`fgSysMemUsage`)
- Sessions: `1.3.6.1.4.1.12356.101.4.1.8` (`fgSysSesCount`)

### Cambium cnPilot

- CPU: `1.3.6.1.4.1.17713.22.1.1.1.6.0`
- Clients (total): `1.3.6.1.4.1.17713.22.1.1.1.14.0`
- Station table (`cambiumClientTable`): `1.3.6.1.4.1.17713.22.1.3.1`
  - Index / MAC / IP / name / SSID / OS / hw mode / SNR / TxRate / Tx|Rx data bytes
  - Prom series: `cambiumClientInfo` (labels `mac`, `client_ip`, `client_name`, `ssid`, `client_os`, `hw_mode`, `tx_rate`), `cambiumClientSNR`, `cambiumClientTxDataBytes`, `cambiumClientRxDataBytes`
  - Live bandwidth: `rate(cambiumClient*DataBytes[5m])*8`

E-series (E410 etc.) expose AP health as **scalar `.0`**, not MAC-indexed rows. Older templates used `PhysAddress48` indexes and produced **empty** `cambiumAPTotalClients` while IF-MIB traffic still worked. The **client table** is Integer32-indexed (`clientIndex`), not scalar.

Collector Console historically stored type as `access-point`; Alloy only attached `cambium_ap_health` for type `ap`. Both are accepted now. Existing devices with type `access-point` get the module after Force-apply; prefer renaming type to `ap` in Sites.

After pulling a new `snmp.yml` with the station walk: **Force apply** collectors so Alloy rescrapes `cambium_ap_health`.

### Omada / TP-Link EAP

- Clients (total): `1.3.6.1.4.1.11863.10.1.1.1.0` — **model/firmware dependent**. Empty series = unsupported; UI shows unknown (does not crash).
- Station MAC table: `1.3.6.1.4.1.11863.10.1.1.2.1` → `omadaClientInfo` with `mac` label. Public MIB does **not** expose per-client SNR or byte counters; Clients tab shows MAC + AP only for Omada.

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
