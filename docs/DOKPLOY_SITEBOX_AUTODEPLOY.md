# Site-box auto-deploy on git push (Dokploy)

Central **noc-app** (`docker-compose.yml`) already redeploys on push. Site-box is a **separate** Dokploy Compose app (`docker-compose.site-box.yml`) — it only auto-deploys if that app has Auto Deploy enabled and GitHub can reach that Dokploy.

## 1) Enable Auto Deploy (same host as GitHub can reach)

On the **site-box** Compose service in Dokploy (each NUC / site):

1. Open the site-box app → **General**
2. Confirm:
   - **Repository** = this NOC repo
   - **Branch** = `main` (must match what you push)
   - **Compose Path** = `docker-compose.site-box.yml` (repo root — not `sites/templates/site-box/docker-compose.yml`)
3. Toggle **Auto Deploy** **ON**
4. Save

With the GitHub App connected to Dokploy, a push to `main` should enqueue a site-box deploy the same way noc-app does.

### If pushes still do nothing

1. Site-box app → **Deployments** → copy **Webhook URL**
2. GitHub repo → **Settings → Webhooks → Add webhook**
   - Payload URL = that Dokploy URL
   - Content type = `application/json`
   - Events = **Just the push event**
3. Push a small commit and check Dokploy **Deployments** for a new run

**Branch mismatch** ("Branch Not Match") means Dokploy’s branch ≠ the branch you pushed.

## 2) NUC / LAN Dokploy (common reason auto-deploy fails)

GitHub’s webhook must **reach** Dokploy over the public internet. Central VPS Dokploy usually works; a Dokploy panel only on the NUC LAN often does **not**, so site-box stays manual even with Auto Deploy ON.

Fix options (pick one):

| Option | What to do |
|---|---|
| **A. Public Dokploy URL** | Expose that site’s Dokploy UI/API via Cloudflare Tunnel (or similar), then use Auto Deploy / webhook as above |
| **B. GitHub Action → webhook** | Put each reachable webhook URL in repo secret `DOKPLOY_SITEBOX_WEBHOOK_URLS` (comma-separated). Workflow `.github/workflows/dokploy-sitebox.yml` POSTs on site-box path changes |
| **C. Stay manual** | Redeploy site-box in Dokploy after collector-console / Alloy / snmp.yml changes |

noc-app-only changes do **not** require a site-box redeploy. Site-box rebuild is needed when `sites/templates/site-box/**` or `docker-compose.site-box.yml` change (collector-console image, snmp packs, compose).

## 3) After an auto-deploy

1. Confirm containers: `noc_collector_console` + `noc_site_alloy`
2. Console → **Force apply** if SNMP modules / devices need a regen
3. Named volume `noc_sitebox_data` keeps runtime `config.alloy` across Dokploy `code/` replaces

## Checklist

- [ ] Separate Dokploy Compose app for site-box (not only noc-app)
- [ ] Compose Path = `docker-compose.site-box.yml`
- [ ] Branch = `main`
- [ ] Auto Deploy = ON
- [ ] Dokploy webhook reachable from GitHub (public URL / tunnel), **or** `DOKPLOY_SITEBOX_WEBHOOK_URLS` secret set for the Action
