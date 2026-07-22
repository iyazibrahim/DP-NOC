#!/usr/bin/env bash
# Local + operator checklist: prove config is Alloy-safe and print Grafana queries.
# Does not call Prometheus (run Grafana queries on the NUC/VPS after repair).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SITE="${SITE_NAME:-site-1}"
DEVICE_HINT="${1:-}"

chmod +x ./generate-config.sh ./validate-config.sh 2>/dev/null || true

echo "=== verify SNMP path (Alloy v1.5.1) ==="

# Ensure sample device for dry-run if empty and VERIFY_SAMPLE=1
if [[ "${VERIFY_SAMPLE:-0}" == "1" ]]; then
  echo '[{"id":"site-1-firewall1","name":"firewall1","snmpIp":"192.168.1.1","type":"firewall","vendor":"fortinet"}]' > ./devices.json
fi

./generate-config.sh ./devices.json ./config.alloy
./validate-config.sh ./config.alloy

echo
echo "Required blocks:"
grep -nE 'scrape_interval|prometheus.exporter.snmp|site_snmp_if_mib|config_merge' ./config.alloy || true

if grep -qE '^[[:space:]]*config_merge_strategy[[:space:]]*=' ./config.alloy; then
  echo "FAIL: config_merge_strategy present" >&2
  exit 1
fi

DEVICE_COUNT="$(python3 -c "import json; print(len(json.load(open('devices.json'))))" 2>/dev/null || echo 0)"
echo
echo "devices.json count: $DEVICE_COUNT"
if [[ "$DEVICE_COUNT" -gt 0 ]] && ! grep -q 'prometheus.exporter.snmp' ./config.alloy; then
  echo "FAIL: devices present but no SNMP exporter" >&2
  exit 1
fi

echo
echo "=== Grafana Explore (after Alloy healthy on NUC) ==="
echo "1) up{job=\"site_host\",site=\"${SITE}\"}"
echo "2) up{job=\"site_snmp_if_mib\"}"
echo "3) snmp_up{site=\"${SITE}\"}"
if [[ -n "$DEVICE_HINT" ]]; then
  echo "4) snmp_up{site=\"${SITE}\",device=\"${DEVICE_HINT}\"}"
else
  echo "4) snmp_up{site=\"${SITE}\",device=\"<exact-id-from-devices.json>\"}"
fi
echo
echo "Gate: (2) must return a series before (3)/(4). Empty (2) = SNMP scrape not running."
echo "On NUC: ./repair-alloy.sh then wait ~60s and run the queries above."
echo "OK: local generate + validate passed"
