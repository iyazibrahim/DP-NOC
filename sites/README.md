# Sites

Per-site Alloy env templates: `site-*/env.example`  
Agent template: `templates/site-box/` (multi-device SNMP)

Site IDs and coordinates must match [`backend/noc-api/data/seed-sites.json`](../backend/noc-api/data/seed-sites.json) and Blackbox targets in [`infra/prometheus/prometheus.yml`](../infra/prometheus/prometheus.yml).

## Dokploy deploy

Only **noc-app** needs a public domain for operators. Site boxes push metrics to Prometheus (prefer HTTPS remote_write in production).
