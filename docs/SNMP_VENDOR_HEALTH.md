# SNMP vendor health packs

Each network device always scrapes **`if_mib`**. `generate-config.sh` adds **one extra SNMP target** (same IP/auth/`device` label) when type + vendor match.

| Device type | Vendor (normalized) | Extra module | Metrics |
|---|---|---|---|
| `firewall` | `fortinet` / `fortigate` / empty | `fortigate_health` | `fgSysCpuUsage`, `fgSysMemUsage`, `fgSysSesCount` |
| `switch` | `maipu` | `maipu_health` | HOST-RESOURCES `hrProcessorLoad`, `hrStorage*` |
| `ap` | `cambium` | `cambium_ap_health` | `cambiumAPCPUUtilization`, `cambiumAPTotalClients` |
| `ap` | `omada` / `tp-link` / `tplink` | `omada_ap_health` | `omadaClientCount` |

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

- CPU: `1.3.6.1.4.1.17713.22.1.1.1.6`
- Clients: `1.3.6.1.4.1.17713.22.1.1.1.14`

### Omada / TP-Link EAP

- Clients: `1.3.6.1.4.1.11863.10.1.1.1` — **model/firmware dependent**. Empty series = unsupported; UI shows unknown (does not crash).

### Maipu switch

Private MIBs vary by model. Baseline uses **HOST-RESOURCES-MIB**. After a live `snmpwalk` on your Maipu, add enterprise OIDs under `maipu_health` in `sites/templates/site-box/snmp.yml` and document them here.
