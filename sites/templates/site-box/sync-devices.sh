#!/usr/bin/env bash
# Pull network device inventory from NOC API and refresh Alloy SNMP targets.
# Env: NOC_API_URL, SITE_NAME (or SITE_ID), COLLECTOR_TOKEN
# Optional: SYNC_INTERVAL_SEC (when run with --loop), SCRAPE_INTERVAL_SEC
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NOC_API_URL="${NOC_API_URL:-}"
SITE_ID="${SITE_NAME:-${SITE_ID:-}}"
COLLECTOR_TOKEN="${COLLECTOR_TOKEN:-}"
DEVICES_FILE="${DEVICES_FILE:-$SCRIPT_DIR/devices.json}"
ETAG_FILE="${ETAG_FILE:-$SCRIPT_DIR/.devices.etag}"
LOOP=0

if [[ "${1:-}" == "--loop" ]]; then
  LOOP=1
fi

if [[ -z "$NOC_API_URL" || -z "$SITE_ID" || -z "$COLLECTOR_TOKEN" ]]; then
  echo "sync-devices: set NOC_API_URL, SITE_NAME, and COLLECTOR_TOKEN"
  exit 1
fi

NOC_API_URL="${NOC_API_URL%/}"

sync_once() {
  local url="${NOC_API_URL}/api/collector/${SITE_ID}/devices.json"
  local tmp
  tmp="$(mktemp)"
  local headers
  headers="$(mktemp)"
  local curl_args=(-sS -D "$headers" -o "$tmp"
    -H "Authorization: Bearer ${COLLECTOR_TOKEN}"
    -H "Accept: application/json"
  )
  if [[ -f "$ETAG_FILE" ]]; then
    curl_args+=(-H "If-None-Match: $(cat "$ETAG_FILE")")
  fi

  local code
  code="$(curl "${curl_args[@]}" -w "%{http_code}" "$url" || true)"

  if [[ "$code" == "304" ]]; then
    rm -f "$tmp" "$headers"
    echo "sync-devices: unchanged (304)"
    return 0
  fi

  if [[ "$code" != "200" ]]; then
    echo "sync-devices: fetch failed HTTP ${code}"
    cat "$tmp" 2>/dev/null || true
    rm -f "$tmp" "$headers"
    return 1
  fi

  local etag
  etag="$(grep -i '^etag:' "$headers" | head -1 | sed 's/[Ee][Tt][Aa][Gg]:[[:space:]]*//' | tr -d '\r')"
  if [[ -n "$etag" ]]; then
    printf '%s' "$etag" > "$ETAG_FILE"
  fi

  if [[ -f "$DEVICES_FILE" ]] && cmp -s "$tmp" "$DEVICES_FILE"; then
    rm -f "$tmp" "$headers"
    echo "sync-devices: content identical"
    return 0
  fi

  mv "$tmp" "$DEVICES_FILE"
  rm -f "$headers"
  echo "sync-devices: wrote $(python3 -c "import json; print(len(json.load(open('$DEVICES_FILE'))))" 2>/dev/null || echo '?') device(s)"

  if [[ -x "$SCRIPT_DIR/generate-config.sh" ]]; then
    "$SCRIPT_DIR/generate-config.sh" "$DEVICES_FILE" "$SCRIPT_DIR/config.alloy"
  else
    bash "$SCRIPT_DIR/generate-config.sh" "$DEVICES_FILE" "$SCRIPT_DIR/config.alloy"
  fi

  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --force-recreate alloy
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --force-recreate alloy
  else
    echo "sync-devices: regenerate done — recreate Alloy manually if needed"
  fi
}

if [[ "$LOOP" -eq 1 ]]; then
  INTERVAL="${SYNC_INTERVAL_SEC:-90}"
  echo "sync-devices: looping every ${INTERVAL}s"
  while true; do
    sync_once || true
    sleep "$INTERVAL"
  done
else
  sync_once
fi
