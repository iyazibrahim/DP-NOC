# Sites

This folder contains v1 seed configuration for 5 example sites.

## Site boxes (Alloy)
For each folder under `sites/site-*`:
- copy `sites/templates/site-box/config.alloy` to your site box
- copy `sites/templates/site-box/snmp.yml` (if you want SNMP)
- set environment variables from `env.example`
- start Alloy with your config

### Why this matters
Your metrics include `SITE_NAME` as the `site` label, so the NOC API + wallboard can aggregate by site id.

## Network-only sites
Network-only locations use the central VPS to probe websites (Blackbox Exporter).
Add/adjust website targets in `infra/prometheus/prometheus.yml` for v1.

