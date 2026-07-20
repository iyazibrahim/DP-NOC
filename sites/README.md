# Sites

Catalog (wizard menu): [`catalog.json`](catalog.json)  
Per-site env examples: `site-*/env.example`  
Agent template: [`templates/site-box/`](templates/site-box/) — Docker Compose + `deploy.sh`

## Seed sites (NOC UI)

| id | name |
|---|---|
| `site-1` | Digital Penang Office |
| `site-2` | Digital Library 1 |
| `site-3` | Digital Library 2 |
| `site-4` | Butterworth Digital Library |
| `site-5` | Batu Maung Digital Library |

Devices start empty — add them in the NOC UI and/or via `deploy.sh` on the NUC.

## NUC quick start

```bash
cd sites/templates/site-box
chmod +x deploy.sh generate-config.sh
./deploy.sh
```

Full runbook: [`docs/ALLOY_COLLECTOR.md`](../docs/ALLOY_COLLECTOR.md)

## Domains

- Operators: `noc.` → noc-app  
- Collectors: `metrics.` → Prometheus write via **Cloudflare Tunnel** + Access Service Token  
