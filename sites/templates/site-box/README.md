# Site box (Alloy) template

This template is for a small always-on device at each site (Raspberry Pi / mini-PC).

Responsibilities:
1. Probe local & WAN health (ICMP ping)
2. Optional: poll local network gear via SNMP
3. Push metrics to the central VPS via Prometheus `remote_write` (HTTPS recommended, HTTP for local testing)

## Required outbound connectivity
- TCP 443 (or your remote_write HTTP port) from site box to the central VPS

## Required permissions for ICMP
ICMP probing requires raw socket access. On Linux you typically need:
- grant `cap_net_raw` to the Alloy binary/container, or run with appropriate capabilities

## Environment variables
Export these before starting Alloy (see `sites/site-*/env.example`):

- `CENTRAL_REMOTE_WRITE_URL`: e.g. `http://<VPS_IP>:9090/api/v1/write` (prefer HTTPS via Dokploy in production)
- `SITE_NAME`: site id label (must match NOC seed registry)
- `PING_TARGET_1` / `PING_TARGET_2`: WAN ICMP targets
- Per device (repeat `_2`, `_3`, …):
  - `SNMP_DEVICE_N_ID`, `SNMP_DEVICE_N_IP`, `SNMP_DEVICE_N_VENDOR`

Labels pushed with SNMP metrics: `site`, `device`, `vendor`.

## SNMP notes
- Default auth: SNMPv2c community `public` (`public_v2` in `snmp.yml`).
- Cross-vendor module: minimal `if_mib` (interface status/traffic).
- Comment out unused `snmp_device_N` blocks in `config.alloy` if a site has fewer devices.

