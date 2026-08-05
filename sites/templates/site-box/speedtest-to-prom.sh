#!/usr/bin/env bash
# Run Ookla speedtest and write Prometheus textfile metrics for Alloy unix exporter.
# Env: SITE_NAME, TEXTFILE_DIR (default /var/lib/node_exporter/textfile), INTERVAL_SEC (0 = once)
set -euo pipefail

SITE_NAME="${SITE_NAME:-unknown}"
TEXTFILE_DIR="${TEXTFILE_DIR:-/var/lib/node_exporter/textfile}"
INTERVAL_SEC="${INTERVAL_SEC:-900}"
OUT="${TEXTFILE_DIR}/noc_speedtest.prom"
TMP="$(mktemp)"
JSON="$(mktemp)"

cleanup() {
  rm -f "$TMP" "$JSON"
}
trap cleanup EXIT

write_fail() {
  local msg="${1:-speedtest failed}"
  mkdir -p "$TEXTFILE_DIR"
  cat >"$TMP" <<EOF
# HELP noc_speedtest_up 1 if last speedtest succeeded
# TYPE noc_speedtest_up gauge
noc_speedtest_up{site="${SITE_NAME}"} 0
# HELP noc_speedtest_last_error_info Always 1; error in label (truncated)
# TYPE noc_speedtest_last_error_info gauge
noc_speedtest_last_error_info{site="${SITE_NAME}",error="$(echo "$msg" | tr -c 'A-Za-z0-9._:-' '_' | cut -c1-80)"} 1
EOF
  mv "$TMP" "$OUT"
}

run_once() {
  mkdir -p "$TEXTFILE_DIR"
  if ! command -v speedtest >/dev/null 2>&1; then
    write_fail "speedtest binary missing"
    return 1
  fi

  if ! speedtest --accept-license --accept-gdpr -f json >"$JSON" 2>/dev/null; then
    write_fail "speedtest command failed"
    return 1
  fi

  # Prefer jq; fall back to python3
  local down_bps up_bps ping_ms now
  now="$(date +%s)"
  if command -v jq >/dev/null 2>&1; then
    down_bps="$(jq -r '.download.bandwidth // empty' "$JSON")"
    up_bps="$(jq -r '.upload.bandwidth // empty' "$JSON")"
    ping_ms="$(jq -r '.ping.latency // empty' "$JSON")"
  elif command -v python3 >/dev/null 2>&1; then
    down_bps="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("download",{}).get("bandwidth",""))' "$JSON")"
    up_bps="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("upload",{}).get("bandwidth",""))' "$JSON")"
    ping_ms="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("ping",{}).get("latency",""))' "$JSON")"
  else
    write_fail "jq or python3 required to parse json"
    return 1
  fi

  # Ookla JSON bandwidth is already bytes/sec
  if [[ -z "$down_bps" || -z "$up_bps" ]]; then
    write_fail "parse empty bandwidth"
    return 1
  fi

  # Convert bytes/sec → bits/sec for NOC charts
  down_bps="$(awk -v b="$down_bps" 'BEGIN { printf "%.0f", b*8 }')"
  up_bps="$(awk -v b="$up_bps" 'BEGIN { printf "%.0f", b*8 }')"
  ping_ms="$(awk -v p="${ping_ms:-0}" 'BEGIN { printf "%.2f", p }')"

  cat >"$TMP" <<EOF
# HELP noc_speedtest_download_bps ISP download rate bits per second
# TYPE noc_speedtest_download_bps gauge
noc_speedtest_download_bps{site="${SITE_NAME}"} ${down_bps}
# HELP noc_speedtest_upload_bps ISP upload rate bits per second
# TYPE noc_speedtest_upload_bps gauge
noc_speedtest_upload_bps{site="${SITE_NAME}"} ${up_bps}
# HELP noc_speedtest_ping_ms ISP ping latency milliseconds
# TYPE noc_speedtest_ping_ms gauge
noc_speedtest_ping_ms{site="${SITE_NAME}"} ${ping_ms}
# HELP noc_speedtest_last_success_timestamp Unix time of last successful speedtest
# TYPE noc_speedtest_last_success_timestamp gauge
noc_speedtest_last_success_timestamp{site="${SITE_NAME}"} ${now}
# HELP noc_speedtest_up 1 if last speedtest succeeded
# TYPE noc_speedtest_up gauge
noc_speedtest_up{site="${SITE_NAME}"} 1
EOF
  mv "$TMP" "$OUT"
  echo "speedtest ok site=${SITE_NAME} down=${down_bps}bps up=${up_bps}bps ping=${ping_ms}ms"
}

if [[ "${INTERVAL_SEC}" == "0" ]]; then
  run_once
  exit $?
fi

while true; do
  run_once || true
  sleep "$INTERVAL_SEC"
done
