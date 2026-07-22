#!/usr/bin/env bash
# One-shot repair: regenerate config.alloy with valid scrape intervals and restart Alloy.
# Run on the NUC inside the site-box folder (or: docker exec into collector-console and call generate).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export SCRAPE_INTERVAL_SEC="${SCRAPE_INTERVAL_SEC:-15}"

echo "=== Repair Alloy config ==="
echo "Working dir: $SCRIPT_DIR"

if [[ ! -x ./generate-config.sh ]]; then
  chmod +x ./generate-config.sh || true
fi

./generate-config.sh ./devices.json ./config.alloy

echo
echo "scrape_interval lines:"
grep -n scrape_interval ./config.alloy || true

if grep -q '\${SCRAPE_INTERVAL_SEC}' ./config.alloy; then
  echo "ERROR: still broken — update generate-config.sh from git and re-run"
  exit 1
fi

echo
echo "Restarting noc_site_alloy..."
docker restart noc_site_alloy

echo
echo "Waiting 3s..."
sleep 3
docker logs noc_site_alloy --tail 25 2>&1 || true

echo
echo "Done. In Grafana Explore try (in order):"
echo '  up{job="site_host",site="site-1"}          # collector host'
echo '  up{job="site_snmp_if_mib"}                 # SNMP scrape running?'
echo '  snmp_up{site="site-1"}                     # device poll result'
echo
echo "If snmp.yml community is not 'public', edit snmp.yml to match Fortinet, then re-run this script."
