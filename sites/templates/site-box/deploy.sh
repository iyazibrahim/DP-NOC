#!/usr/bin/env bash
# Site collector (NUC today) / site-box Alloy deployer (one site at a time).
# 1) Checks Docker
# 2) Lets you pick a catalog site
# 3) Collects CF Access + optional SNMP devices
# 4) Generates config.alloy and starts docker compose
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CATALOG="$REPO_ROOT/sites/catalog.json"
cd "$SCRIPT_DIR"

echo "=== NOC site Alloy deployer ==="
echo "Working dir: $SCRIPT_DIR"
echo

# --- 1) Docker preflight ---
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found. Install Docker Engine first."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: cannot talk to Docker daemon (is it running? are you in the docker group?)."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "ERROR: docker compose plugin not found."
  exit 1
fi

echo "OK: Docker is available."
echo

# --- 2) Pick site ---
if [[ ! -f "$CATALOG" ]]; then
  echo "ERROR: catalog not found at $CATALOG"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 required to read catalog / write devices.json"
  exit 1
fi

mapfile -t SITE_LINES < <(python3 - "$CATALOG" <<'PY'
import json, sys
for i, s in enumerate(json.load(open(sys.argv[1])), 1):
    print(f"{i}|{s['id']}|{s['name']}")
PY
)

echo "Select ONE site for this NUC collector:"
for line in "${SITE_LINES[@]}"; do
  idx="${line%%|*}"
  rest="${line#*|}"
  sid="${rest%%|*}"
  name="${rest#*|}"
  echo "  $idx) $name ($sid)"
done
echo
read -r -p "Site number: " CHOICE

SITE_ID=""
SITE_NAME_LABEL=""
for line in "${SITE_LINES[@]}"; do
  idx="${line%%|*}"
  if [[ "$idx" == "$CHOICE" ]]; then
    rest="${line#*|}"
    SITE_ID="${rest%%|*}"
    SITE_NAME_LABEL="${rest#*|}"
    break
  fi
done

if [[ -z "$SITE_ID" ]]; then
  echo "ERROR: invalid selection"
  exit 1
fi

echo "Selected: $SITE_NAME_LABEL ($SITE_ID)"
echo

# --- 3) Credentials / ping ---
read -r -p "CENTRAL_REMOTE_WRITE_URL [https://metrics.iyazbrhm.cloud/api/v1/write]: " RW_URL
RW_URL="${RW_URL:-https://metrics.iyazbrhm.cloud/api/v1/write}"

read -r -p "CF_ACCESS_CLIENT_ID: " CF_ID
read -r -p "CF_ACCESS_CLIENT_SECRET: " CF_SECRET
if [[ -z "$CF_ID" || -z "$CF_SECRET" ]]; then
  echo "ERROR: Cloudflare Access Service Token id/secret are required."
  exit 1
fi

read -r -p "PING_TARGET_1 (DNS) [1.1.1.1]: " PING1
PING1="${PING1:-1.1.1.1}"
read -r -p "PING_TARGET_2 (VPS) [139.99.88.174]: " PING2
PING2="${PING2:-139.99.88.174}"

# --- 4) Devices ---
DEVICES_TMP="$(mktemp)"
echo "[]" > "$DEVICES_TMP"
echo
echo "Add SNMP devices for this site (leave blank ID to finish)."
echo "Prefer managing devices in the NOC UI — this box can pull inventory with COLLECTOR_TOKEN."
echo

while true; do
  read -r -p "Device id (e.g. ${SITE_ID}-sw1, empty=done): " DID
  if [[ -z "$DID" ]]; then
    break
  fi
  read -r -p "  Name [Device]: " DNAME
  DNAME="${DNAME:-Device}"
  read -r -p "  Type (switch/router/firewall/ap) [switch]: " DTYPE
  DTYPE="${DTYPE:-switch}"
  read -r -p "  SNMP IP: " DIP
  if [[ -z "$DIP" ]]; then
    echo "  skipped (no IP)"
    continue
  fi
  read -r -p "  Vendor [generic]: " DVENDOR
  DVENDOR="${DVENDOR:-generic}"

  python3 - "$DEVICES_TMP" "$DID" "$DNAME" "$DTYPE" "$DIP" "$DVENDOR" <<'PY'
import json, sys
path, did, name, typ, ip, vendor = sys.argv[1:7]
devs = json.load(open(path))
devs.append({"id": did, "name": name, "type": typ, "snmpIp": ip, "vendor": vendor})
with open(path, "w") as f:
    json.dump(devs, f, indent=2)
    f.write("\n")
PY
  echo "  + added $DID ($DIP)"
done

cp "$DEVICES_TMP" "$SCRIPT_DIR/devices.json"
rm -f "$DEVICES_TMP"

# --- 5) Write .env + config ---
read -r -p "NOC_API_URL for inventory sync (empty=skip auto-sync) [https://noc.example.com]: " NOC_URL
NOC_URL="${NOC_URL:-}"
read -r -p "COLLECTOR_TOKEN from NOC UI (Sites → site → Generate token, empty=skip): " COLLECTOR_TOKEN
COLLECTOR_TOKEN="${COLLECTOR_TOKEN:-}"

cat > "$SCRIPT_DIR/.env" <<EOF
CENTRAL_REMOTE_WRITE_URL=$RW_URL
CF_ACCESS_CLIENT_ID=$CF_ID
CF_ACCESS_CLIENT_SECRET=$CF_SECRET
SITE_NAME=$SITE_ID
HOST_DEVICE_ID=${SITE_ID}-nuc
PING_TARGET_1=$PING1
PING_TARGET_2=$PING2
NOC_API_URL=$NOC_URL
COLLECTOR_TOKEN=$COLLECTOR_TOKEN
SCRAPE_INTERVAL_SEC=15
SYNC_INTERVAL_SEC=90
EOF

chmod +x "$SCRIPT_DIR/generate-config.sh" "$SCRIPT_DIR/sync-devices.sh" \
  "$SCRIPT_DIR/validate-config.sh" "$SCRIPT_DIR/repair-alloy.sh" \
  "$SCRIPT_DIR/verify-snmp-queries.sh" "$SCRIPT_DIR/cutover-sitebox-snmp.sh" 2>/dev/null || true
"$SCRIPT_DIR/generate-config.sh" "$SCRIPT_DIR/devices.json" "$SCRIPT_DIR/config.alloy"

if [[ -n "$NOC_URL" && -n "$COLLECTOR_TOKEN" ]]; then
  echo
  echo "Pulling devices from NOC API..."
  NOC_API_URL="$NOC_URL" SITE_NAME="$SITE_ID" COLLECTOR_TOKEN="$COLLECTOR_TOKEN" \
    "$SCRIPT_DIR/sync-devices.sh" || echo "WARNING: initial sync failed (token/URL?). Continue anyway."
fi

echo
echo "Starting Alloy..."
"${COMPOSE[@]}" up -d

# --- 6) Optional: register this collector host in NOC inventory ---
HOST_DEVICE_ID="${SITE_ID}-nuc"
if [[ -n "${NOC_API_URL:-}" ]]; then
  NOC_API_URL="${NOC_API_URL%/}"
  echo
  echo "NOC inventory sync: attempting to register ${HOST_DEVICE_ID}..."

  if ! command -v curl >/dev/null 2>&1; then
    echo "  WARNING: curl not found; skipping NOC registration."
  else
    NOC_TOKEN="${NOC_OPERATOR_TOKEN:-}"
    if [[ -z "$NOC_TOKEN" ]]; then
      NOC_USER="${NOC_OPERATOR_USERNAME:-admin}"
      NOC_PASS="${NOC_OPERATOR_PASSWORD:-admin}"
      if [[ -z "${NOC_OPERATOR_USERNAME:-}" ]]; then
        read -r -p "NOC operator username [admin]: " NOC_USER
        NOC_USER="${NOC_USER:-admin}"
      fi
      if [[ -z "${NOC_OPERATOR_PASSWORD:-}" ]]; then
        read -r -s -p "NOC operator password [admin]: " NOC_PASS
        echo
        NOC_PASS="${NOC_PASS:-admin}"
      fi

      LOGIN_RESP="$(curl -sS -X POST "${NOC_API_URL}/api/auth/login" \
        -H "content-type: application/json" \
        -d "{\"username\":\"${NOC_USER}\",\"password\":\"${NOC_PASS}\"}")"
      NOC_TOKEN="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('token',''))" <<< "$LOGIN_RESP")"
    fi

    if [[ -z "$NOC_TOKEN" ]]; then
      echo "  WARNING: could not obtain NOC JWT token; skipping."
    else
      REGISTER_BODY="$(python3 -c "import json; print(json.dumps({
        'id': '${HOST_DEVICE_ID}',
        'name': '${SITE_NAME_LABEL} collector',
        'type': 'server',
        'kind': 'server',
        'hostMetricId': '${HOST_DEVICE_ID}',
        'vendor': 'generic'
      }))")"

      HTTP_CODE="$(curl -sS -o /dev/null -w "%{http_code}" \
        -X POST "${NOC_API_URL}/api/sites/${SITE_ID}/devices" \
        -H "authorization: Bearer ${NOC_TOKEN}" \
        -H "content-type: application/json" \
        -d "${REGISTER_BODY}")"

      if [[ "$HTTP_CODE" == "201" ]]; then
        echo "  Registered collector host successfully."
      elif [[ "$HTTP_CODE" == "409" ]]; then
        echo "  Already registered (409)."
      else
        echo "  NOC registration failed (HTTP ${HTTP_CODE})."
      fi
    fi
  fi
fi

echo
echo "=== Done ==="
echo "Site:    $SITE_NAME_LABEL ($SITE_ID)"
echo "Devices: $(python3 -c "import json; print(len(json.load(open('$SCRIPT_DIR/devices.json'))))")"
echo "Compose: ${COMPOSE[*]} -f $SCRIPT_DIR/docker-compose.yml"
echo
echo "Next:"
echo "  1) Open Collector Console: http://<this-host-ip>:8090"
echo "     Paste collector token from NOC UI (Sites → this site → Generate token)."
echo "     Save — inventory sync runs automatically (no sync-devices.sh / cron needed)."
echo "  2) Ensure metrics. tunnel → http://127.0.0.1:9090 on the VPS + Access token works (curl 200)."
echo "  3) If host inventory is missing: register this collector host in NOC UI."
echo "     Device id is ${SITE_ID}-nuc (type server)."
echo "  4) Logs: docker logs -f noc_site_alloy"
echo
echo "Legacy: ./sync-devices.sh still works if you prefer shell/cron over the console."
echo
echo "Dokploy: create an app from this folder's docker-compose.yml after .env exists."
