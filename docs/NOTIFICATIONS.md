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
| SiteUplinkDown | `probe_success` wan = 0 **or** `absent_over_time(...[45s])` | 15s |
| SiteWebsiteDown | website probe = 0 **or** absent 2m | 1m |
| SiteCollectorDown | host `up` = 0 **or** absent memory/`up` 45s | 15s |
| SiteLocalDeviceDown | `snmp_up` = 0 **or** absent 5m | 2m |

Silence (collector stopped) fires uplink/collector alerts within ~60s. Notifications fire after the `for` duration, in addition to the dashboard status change and in-app toast.

## Security

- Bot tokens and SMTP passwords are stored in `data/runtime/notifications.json` on the noc-app volume.
- API responses mask secrets; leave password fields blank to keep existing values.
- Restrict Settings access to operator accounts only.
