# Network-only site monitoring (no site box)

If a remote location cannot run a small always-on box, you can still monitor:
- Website uptime / TLS expiry / HTTP latency (from the central VPS)
- WAN connectivity (optionally, by ICMP/HTTP probes from the central VPS)

This is implemented via:
- `blackbox_exporter` on the central VPS

## How to add URLs for a new network-only site
1. Add your site name and website URLs in the NOC API seed data (v1: in `src/noc-api/` when we get there).
2. Update the Blackbox exporter module targets:
   - Either by editing `infra/blackbox/blackbox.yml` for the initial prototype
   - Or, after the API exists, generating targets automatically from the NOC API registry (future)

## What you will see in the wallboard
- A “network-only” site card with:
  - Website probes (up/down, latency trend)
  - A derived overall status based on probe failures

## Limitations
- You will not have local LAN/SNMP visibility until a site box is installed.

