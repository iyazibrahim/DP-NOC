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
Edit the `config.alloy` template by replacing env vars or exporting them before Alloy starts.

- `CENTRAL_REMOTE_WRITE_URL`: e.g. `http://<VPS_IP>:9090/api/v1/write`
- `SITE_NAME`: used as a label in metrics
- `PING_TARGET_1`: typically a DNS server (e.g. `1.1.1.1`)
- `PING_TARGET_2`: typically the central VPS public IP (or a reliable upstream)
- `SNMP_TARGET_1_IP`: optional, e.g. `192.168.10.1`

## SNMP notes
- Default SNMP auth in this template: SNMPv2c community `public`.
- You must update `snmp.yml` if your devices differ.

