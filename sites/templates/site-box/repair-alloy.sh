#!/usr/bin/env bash
# One-shot repair: regenerate config.alloy (Alloy v1.5.1 contract) and restart Alloy.
# Run on the NUC inside the site-box folder.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export SCRAPE_INTERVAL_SEC="${SCRAPE_INTERVAL_SEC:-15}"

echo "=== Repair Alloy config (grafana/alloy:v1.5.1) ==="
echo "Working dir: $SCRIPT_DIR"

chmod +x ./generate-config.sh ./validate-config.sh 2>/dev/null || true

./generate-config.sh ./devices.json ./config.alloy
./validate-config.sh ./config.alloy

echo
echo "scrape_interval lines:"
grep -n scrape_interval ./config.alloy || true
echo "SNMP block:"
grep -n 'prometheus.exporter.snmp\|site_snmp_if_mib\|config_merge' ./config.alloy || echo "(none — empty devices.json?)"

echo
echo "Restarting noc_site_alloy..."
docker restart noc_site_alloy

echo
echo "Waiting 5s..."
sleep 5
LOGS="$(docker logs noc_site_alloy --tail 40 2>&1 || true)"
echo "$LOGS"

if echo "$LOGS" | grep -qiE 'invalid duration|config_merge_strategy|could not perform the initial load|unrecognized attribute'; then
  echo
  echo "ERROR: Alloy still failing to load config — check Dokploy Patches overwrite generate-config.sh / snmp.yml" >&2
  exit 1
fi

echo
echo "Done. Prove SNMP in Grafana Explore (site-box only, wait ~60s):"
echo '  1) up{job="site_host",site="site-1"}'
echo '  2) up{job="site_snmp_if_mib"}'
echo '  3) up{job="site_snmp_if_mib",device="site-1-fw1"}'
echo '  4) snmp_up{site="site-1",device="site-1-fw1"}  # optional — NOC also accepts (3)'
echo
echo "Config must include discovery.relabel snmp_job (else job stays integrations/snmp/<target>)."
echo "If (2) empty: regenerate/Force apply with updated generate-config.sh — see CUTOVER_SITEBOX_SNMP.md"
echo "If (2)=1 and device down: Fortinet community / UDP 161 (Default SNMP community e.g. FortiSNMP)."
