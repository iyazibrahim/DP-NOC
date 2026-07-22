# Alloy site collector (Collector → Prometheus)

```text
Collector box (NUC / Pi / mini-PC / server)
  → Alloy (uplink pings + host metrics + SNMP)
  → Prometheus (central)
       ├─→ React dashboard
       └─→ Grafana
```

## Identity contract (required)

| Concept | Env / label | Example |
|---|---|---|
| Site | `SITE_NAME` = Prometheus `site` = React site id | `site-1` |
| Collector | `HOST_DEVICE_ID` = Prometheus `device` (preferred) | `site-1-nuc` |

**Preferred (this repo template):** `job=site_host`, `device=$HOST_DEVICE_ID`, `site=$SITE_NAME`.

**Legacy Alloy integrations** (still supported by the React app):
- Host metrics: `job=integrations/unix`, often only `instance=<hostname>` (no `device`)
- Uplink: `job=integrations/blackbox/ping_*`, `check=wan_dns|wan_vps`

If ICMP scrape is left at Alloy’s default (~60s) while NOC freshness is 45s (30–60s detection), uplink will flicker DOWN every minute even though the collector is fine. **Required:** set ICMP `scrape_interval` to **15s–30s** on the collector (this repo’s template and `generate-config.sh` default to **15s**).

The wallboard refreshes status every **~5s**; that only updates the UI. Detection still depends on scrape + 45s freshness (~30–60s). Do **not** set scrape to 60s.

If you use a legacy integrations config, add a relabel so series also carry `device="$HOST_DEVICE_ID"`. Until then, the app adopts the collector using the hostname `instance` value.

Do **not** point Alloy at `noc.iyazbrhm.cloud` (that is the UI on port 8080).

Do **not** attach `metrics.` as a Dokploy domain on port 9090 when the VPS has **no listener on :80/:443**. Use Tunnel → `127.0.0.1:9090` and DNS **CNAME to the tunnel** (not A → VPS IP).

---

## 1. Cloudflare: metrics hostname + Access Service Token

### 1a. Tunnel Public Hostname

Zero Trust → Networks → Tunnels → your tunnel → Public Hostname:

| Field | Value |
|---|---|
| Subdomain | `metrics` |
| Domain | `iyazbrhm.cloud` |
| Type | **HTTP** |
| URL | `127.0.0.1:9090` |

DNS: `metrics.iyazbrhm.cloud` **CNAME to the tunnel** (proxied).

### 1b. Access application (required for safety)

Zero Trust → Access → Applications → Add application:

- Application type: **Self-hosted**
- Application domain: `metrics.iyazbrhm.cloud`
- Policy: allow **Service Auth** / **Service Token** only  
  (do not use “Allow everyone”)

### 1c. Create Service Token

Zero Trust → Access → Service Auth → Service Tokens → Create:

- Copy **Client ID** → `CF_ACCESS_CLIENT_ID`
- Copy **Client Secret** → `CF_ACCESS_CLIENT_SECRET`

Store only on site boxes (env / systemd). Never commit to git. Rotate if leaked.

### 1d. Proof Access works (403 vs 502)

| Response | Meaning |
|---|---|
| **403** (browser, no token) | Access is working — anonymous blocked |
| **502** (with Service Token) | Access passed; **origin** unreachable (tunnel URL / DNS / Prometheus) |
| **200** (with token) | Ready for Alloy |

```bash
# Anonymous — expect 403 (or Access login), not 200
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://metrics.iyazbrhm.cloud/-/ready

# With token — expect 200 once tunnel → 127.0.0.1:9090 is correct
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "CF-Access-Client-Id: YOUR_ID" \
  -H "CF-Access-Client-Secret: YOUR_SECRET" \
  https://metrics.iyazbrhm.cloud/api/v1/status/config
```

On the VPS, Prometheus must answer: `curl -sS http://127.0.0.1:9090/-/ready`

---

## 2. Deploy Alloy on a collector (recommended)

One Alloy instance = **one site** (pick from the catalog).

```bash
cd sites/templates/site-box
chmod +x deploy.sh generate-config.sh
./deploy.sh
```

The script:

1. Checks Docker / Compose
2. Lets you select a site (Digital Penang Office, libraries, …)
3. Asks for Access token + ping targets
4. Lets you add zero or more SNMP devices → `devices.json`
5. Generates `config.alloy` and runs `docker compose up -d`

Dokploy on the NUC: point an app at this folder’s `docker-compose.yml` **after** `.env` exists (or run `deploy.sh` on the host once).

Re-generate after editing devices:

```bash
./generate-config.sh
docker compose up -d --force-recreate
```

`SITE_NAME` must match seed ids (`site-1` … `site-5`) in `backend/noc-api/data/seed-sites.json`.

Mirror the same devices in the **NOC UI** (Sites → site → Add device). With a **collector token**, open **Collector Console** on the site box (`http://<collector-ip>:8090`), paste the token, and save — inventory sync runs automatically every ~90s. Legacy: `./sync-devices.sh` or cron still works.

### Collector Console (recommended)

After `docker compose up --build` (or Dokploy deploy), open **http://\<collector-lan-ip\>:8090** on the site LAN:

1. **Setup** — site id, NOC URL, collector token, CF Access credentials, SNMP community, ping targets
2. **Dashboard** — Alloy status, last sync, device list, **Sync now**
3. **Settings** — sync interval, view `config.alloy` / Alloy logs

The console pulls `GET /api/collector/:siteId/devices.json`, writes `devices.json`, regenerates `config.alloy`, and recreates Alloy. No SSH or cron required.

**Dokploy:** expose port **8090** on the LAN only — do not publish the collector console to the public internet.

If Dokploy shows only `noc_site_alloy`, your **Patches** still override `docker-compose.yml` with the old one-service file. Delete or update that patch to include `collector-console`, ensure `collector-console/` is in the git source, then rebuild. See [`sites/templates/site-box/README.md`](../sites/templates/site-box/README.md).

### Legacy inventory sync (shell)

1. In NOC UI: Sites → site → **Generate token** (Collector inventory sync)
2. On the site box `.env`:
   - `NOC_API_URL=https://your-noc-host`
   - `COLLECTOR_TOKEN=<token from UI>`
   - `SITE_NAME=<same as site id>`
3. Run `./sync-devices.sh` once, or cron / `./sync-devices.sh --loop`
4. On change, the script regenerates `config.alloy` and recreates the Alloy container

Endpoint: `GET /api/collector/:siteId/devices.json` with `Authorization: Bearer <token>`.

### Manual / binary install (optional)

See older binary + systemd notes below if you are not using Docker.

```bash
sudo mkdir -p /etc/alloy
# copy config.alloy, snmp.yml, env
```

ICMP on bare metal:

```bash
sudo setcap cap_net_raw+ep "$(command -v alloy)"
```

---

## 3. SNMP on the LAN

- Device allows SNMPv2c community matching `snmp.yml` (`public` by default)
- UDP **161** reachable from the site box
- Devices come from `devices.json` via `generate-config.sh` (not hardcoded `SNMP_DEVICE_2` blocks)

### NUC host (CPU / memory / disk)

Site-box always scrapes the **NUC itself** via `prometheus.exporter.unix` (labels: `site`, `device=HOST_DEVICE_ID`, `role=site-box`).

Docker Compose must mount host `/` at `/rootfs` (read-only) — see `sites/templates/site-box/docker-compose.yml`.

**Dokploy:** add volume ` /:/rootfs:ro ` on the alloy service, then redeploy.

Verify on the VPS:

```bash
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=up{job="site_host",site="site-1"}'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=node_memory_MemAvailable_bytes{site="site-1"}'
```

Grafana Explore examples:

```promql
100 - (avg by (device) (rate(node_cpu_seconds_total{mode="idle",site="site-1",device="site-1-nuc"}[5m])) * 100)
node_memory_MemAvailable_bytes{site="site-1",device="site-1-nuc"} / node_memory_MemTotal_bytes{site="site-1",device="site-1-nuc"}
```

Add `site-1-nuc` as a **server** device in the NOC UI for inventory (LAN status still uses SNMP; host health is in Grafana).

Optional: if you set `NOC_API_URL` (and optionally `NOC_OPERATOR_TOKEN` or `NOC_OPERATOR_USERNAME` / `NOC_OPERATOR_PASSWORD`) before running `sites/templates/site-box/deploy.sh`, the script will auto-register this collector host in the NOC inventory.

---

## 4. Verify the collector works

### On the NUC

```bash
docker logs -f noc_site_alloy
# Look for remote_write errors (403 = bad/missing Access token; 502 = metrics origin)
```

### On the VPS

```bash
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=probe_success'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=probe_success{site="site-1"}'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=snmp_up{site="site-1"}'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=up{job="site_host",site="site-1"}'
```

### In the NOC UI

Open **Sites** → site should leave WAN `unknown` once `probe_success` series exist.

---

## 5. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser **403** on metrics. | Expected without token |
| curl + token **502** | Tunnel not → `127.0.0.1:9090`, or DNS A→VPS (no :443) |
| Alloy 403 | Wrong/missing `CF_ACCESS_*` or Access policy |
| Alloy crash: `preferred_ip_protocol not found` | Old inline blackbox YAML — use `config_file = "blackbox.yml"` (site-box mounts `blackbox.yml`). Redeploy with updated files; Dokploy must not keep a stale `config.alloy`. |
| `probe_success` missing | ICMP / `NET_RAW` / wrong `PING_TARGET_*` |
| `snmp_up` missing | Community, UDP 161, empty `devices.json` |
| `stat /rootfs/proc: no such file` | Missing host volume `/:/rootfs:ro` on alloy (Dokploy) |
| Series under wrong site | `SITE_NAME` ≠ seed registry id |
| Writing to noc. domain | Wrong URL — use `metrics.` + `/api/v1/write` |

---

## Security reminders

- Keep Prometheus published only as `127.0.0.1:9090` on the VPS
- Never allow anonymous Access on `metrics.`
- Rotate Service Tokens if a site box is lost or a secret was pasted in chat
- Change SNMP community from `public` in production
