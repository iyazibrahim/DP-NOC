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
| SiteWANDown | `probe_success` wan_dns or wan_vps = 0 | 2m |
| SiteWebsiteDown | website probe = 0 | 2m |
| SiteHostDown | NUC `up{job="site_host"}` = 0 | 3m |
| SiteSNMPDown | `snmp_up` = 0 | 5m |

Notifications fire after the `for` duration, in addition to the dashboard status change.

## Security

- Bot tokens and SMTP passwords are stored in `data/runtime/notifications.json` on the noc-app volume.
- API responses mask secrets; leave password fields blank to keep existing values.
- Restrict Settings access to operator accounts only.
