# Synology NAS wallboard pack

**Date:** 2026-08-19  
**Status:** Approved (operator screen now, TV layout later)

## Problem

SNMP is already polling a Synology NAS, but the wallboard has no NAS health pack. Type `nas` is stored as `kind: server`, so it looks like a collector (node CPU/disk) instead of an SNMP device. There is no Synology module in `snmp.yml`, no presets, and no vendor hook in `generate-config.sh`.

## Decision

Follow the Fortinet / Cambium pattern. **No new widget types.** Operators add the same catalog widgets they already use:

| Need | Existing widget | Preset |
|---|---|---|
| NAS online | SNMP device **or** Gauge / online | `snmp_up` |
| Volume used vs free | Gauge / online (already draws a % pie) | `nas_vol_free_pct` |
| RAID health | Gauge / online (UP/DOWN) | `nas_raid_ok` |
| CPU / memory | Gauge | `nas_cpu_pct`, `nas_mem_pct` |
| Temperature | Gauge | `nas_temp_c` (system), `nas_disk_temp_max_c` (hottest disk) |
| Failed disks | Gauge (count) | `nas_disk_failed` |
| LAN in/out | Line chart | `if_in_bps`, `if_out_bps` |
| Several NAS boxes | Device stack / Local devices board | existing SNMP status |

Out of scope for this pack: SMART tables, NFS/SMB sessions, per-share IOPS, a per-disk LED widget (that would be a new type). TV layout later = fewer of these same widgets, larger.

## Identity

- Device **type** `nas`, **kind** `network` (SNMP IP + community, like firewall/AP).
- **Vendor** `synology` (also `syno`; empty/generic on type `nas` still attaches the module, same as FortiGate).
- Collector scrapes `if_mib` plus extra module `synology_health`.

## Metrics (SYNOLOGY + HOST-RESOURCES + UCD)

| Series | OID / source | Use |
|---|---|---|
| `synoSystemStatus` | `1.3.6.1.4.1.6574.1.1` (1=ok, 2=failed) | scrape only |
| `synoTemperature` | `1.3.6.1.4.1.6574.1.2` | system °C |
| `synoDiskStatus` | `1.3.6.1.4.1.6574.2.1.1.5` | failed count (≥4) |
| `synoDiskTemperature` | `1.3.6.1.4.1.6574.2.1.1.6` | max disk °C |
| `synoRaidStatus` | `1.3.6.1.4.1.6574.3.1.1.3` | RAID ok unless 11 degrade / 12 crashed |
| `synoRaidFreeSize` / `synoRaidTotalSize` | `.4` / `.5` | volume free % |
| `hrProcessorLoad` | HOST-RESOURCES | CPU % |
| `memTotalReal` / `memAvailReal` | UCD `2021.4.5` / `.6` | memory used % |

## Wallboard mapping

Presets are `kind: network`, `deviceTypes: ["nas"]`, `vendors: ["synology", "syno"]`, with the same empty-vendor exception as Fortinet.

`nas_vol_free_pct` is **free** percent so the existing gauge pie (teal = used, gray = free) matches Disk free.

`nas_raid_ok` is a 0/1 series and is listed in the gauge boolean set next to `snmp_up`.

## Apply

Same ops as other vendor packs: replace collector `snmp.yml` from template, set type `nas` + vendor `synology`, Force-apply Alloy.
