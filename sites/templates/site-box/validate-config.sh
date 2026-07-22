#!/usr/bin/env bash
# Fail-closed checks for Alloy v1.5.1 config.alloy (known crash / no-data patterns).
# Usage: ./validate-config.sh [path/to/config.alloy]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="${1:-$SCRIPT_DIR/config.alloy}"

if [[ ! -f "$CFG" ]]; then
  echo "ERROR: config not found: $CFG" >&2
  exit 1
fi

errors=0

fail() {
  echo "ERROR: $*" >&2
  errors=$((errors + 1))
}

# Shell placeholders never expanded → Alloy: invalid duration
if grep -qE '\$\{[A-Za-z0-9_]+\}' "$CFG"; then
  fail "unexpanded shell placeholder \${...} — regenerate with generate-config.sh (Alloy v1.5.1)"
fi

# Alloy v1.5.1 does not support this attribute (newer Alloy only).
# Match assignment only — comments may mention the forbidden name.
if grep -qE '^[[:space:]]*config_merge_strategy[[:space:]]*=' "$CFG"; then
  fail "config_merge_strategy is not supported on grafana/alloy:v1.5.1 — remove it and use full snmp.yml"
fi

# Durations must be numeric, e.g. "15s"
if ! grep -qE 'scrape_interval = "[0-9]+s"' "$CFG"; then
  fail "missing numeric scrape_interval (expected e.g. scrape_interval = \"15s\")"
fi

# Soft checks (warn only) when devices.json has SNMP targets
DEVICES="${SCRIPT_DIR}/devices.json"
if [[ -f "$DEVICES" ]]; then
  count="$(python3 -c "import json; print(len(json.load(open('$DEVICES', encoding='utf-8-sig'))))" 2>/dev/null || echo 0)"
  if [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]]; then
    if ! grep -q 'prometheus.exporter.snmp' "$CFG"; then
      fail "devices.json has $count device(s) but config.alloy has no prometheus.exporter.snmp block"
    fi
    if ! grep -q 'site_snmp_if_mib' "$CFG"; then
      fail "SNMP devices present but job site_snmp_if_mib missing from config.alloy"
    fi
  fi
fi

# Legacy integrations SNMP must never appear in site-box generated config
if grep -qiE 'integrations\.snmp|integrations/snmp|job_name.*=.*"integrations/snmp' "$CFG"; then
  fail "legacy integrations/snmp found in config.alloy — use site-box site_snmp_if_mib only (see CUTOVER_SITEBOX_SNMP.md)"
fi

if [[ "$errors" -gt 0 ]]; then
  echo "validate-config.sh: $errors error(s) in $CFG" >&2
  exit 1
fi

echo "OK: $CFG passes Alloy v1.5.1 crash-pattern checks"
