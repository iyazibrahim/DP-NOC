# Alert notifications

NOC routes Prometheus alerts through **Alertmanager**. Configure delivery channels in **Settings → Alert notifications**.

## Supported channels

| Channel | Fields |
|---|---|
| **Telegram** | Bot token, chat ID (numeric, e.g. `-1001234567890`) |
| **SMTP email** | To, from, smarthost (`host:587`), optional username/password |
| **Webhook** | HTTPS URL (Slack-compatible hooks, custom integrations) |

Enable one or more channels, **Save notifications**, then **Apply to Alertmanager**.

## Apply on VPS

Alertmanager reads `alertmanager.yml` from the shared `noc_runtime` volume. On Dokploy, optionally set:

```env
ALERTMANAGER_APPLY_CMD=docker restart noc_alertmanager
```

Without this, save still writes the config — restart the Alertmanager service manually.

## Alert rules (Prometheus)

| Alert | Condition | `for` |
|---|---|---|
| SiteUplinkDown | **both** `wan_dns` and `wan_vps` failed/absent `[90s]` (quorum) | **2m** |
| SiteWebsiteDown | website probe = 0 **or** absent 2m | 1m |
| SiteCollectorDown | host `up` = 0 **or** absent memory/`up` **90s** | **2m** |
| SiteLocalDeviceDown | `snmp_up` = 0 **or** absent 5m | 2m |

**Inhibit:** `SiteCollectorDown` suppresses `SiteUplinkDown` for the same `site` (metrics path failure ≠ proven WAN down).

Target page time ~**2 minutes** for sustained outages. Collector ICMP scrape must stay **15s–30s** (not Alloy’s ~60s default). In-app incidents also require ~**90s** sustained critical before opening.

## Security

- Bot tokens and SMTP passwords are stored in `data/runtime/notifications.json` on the noc-app volume.
- API responses mask secrets; leave password fields blank to keep existing values.
- Restrict Settings access to operator accounts only.
