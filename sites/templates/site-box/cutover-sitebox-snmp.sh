#!/usr/bin/env bash
# Operator checklist for cutting over from legacy integrations/snmp → site-box.
# Run on the NUC inside the site-box folder after Dokploy redeploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SITE="${SITE_NAME:-site-1}"
DEVICE="${1:-site-1-fw1}"

echo "=== Site-box SNMP cutover checklist ==="
echo "Working dir: $SCRIPT_DIR"
echo "Expected device id: $DEVICE"
echo

echo "1) Containers (need BOTH):"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -E 'NAMES|noc_collector_console|noc_site_alloy' || true
echo

echo "2) Reject legacy integrations/snmp in config.alloy:"
if [[ -f ./config.alloy ]] && grep -qiE 'integrations/snmp|integrations\.snmp' ./config.alloy; then
  echo "FAIL: config.alloy still contains integrations/snmp — delete Dokploy patches and Force apply" >&2
  exit 1
fi
echo "OK: no integrations/snmp in config.alloy (or file missing until generate)"
echo

chmod +x ./generate-config.sh ./validate-config.sh ./repair-alloy.sh ./verify-snmp-queries.sh 2>/dev/null || true

echo "3) Regenerate + validate + restart Alloy..."
export SCRAPE_INTERVAL_SEC="${SCRAPE_INTERVAL_SEC:-15}"
# Prefer SNMP_DEFAULT_COMMUNITY from env / Setup (e.g. FortiSNMP)
export SNMP_DEFAULT_COMMUNITY="${SNMP_DEFAULT_COMMUNITY:-${SNMP_DEFAULT_COMMUNITY:-}}"
./repair-alloy.sh

echo
echo "4) Running config must be site-box SNMP:"
grep -n 'prometheus.exporter.snmp\|site_snmp_if_mib\|auth ' ./config.alloy | head -40 || true
if ! grep -q 'site_snmp_if_mib' ./config.alloy; then
  echo "FAIL: site_snmp_if_mib missing — devices.json empty or generate failed" >&2
  exit 1
fi
echo

echo "=== Grafana prove (wait ~2 min) ==="
echo "PASS when:"
echo "  up{job=\"site_host\",site=\"${SITE}\"} = 1"
echo "  up{job=\"site_snmp_if_mib\",site=\"${SITE}\"} = 1"
echo "  snmp_up{site=\"${SITE}\",device=\"${DEVICE}\"} = 1"
echo "  NOC Sites → Local devices → HEALTHY"
echo
echo "STALE (ignore for health):"
echo "  up{job=\"integrations/snmp/site_1_fw1\"}"
echo
echo "Full guide: CUTOVER_SITEBOX_SNMP.md"
echo "Done."
