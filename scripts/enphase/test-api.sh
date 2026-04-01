#!/usr/bin/env bash
# =============================================================================
# test-api.sh — Test all Enphase IQ Gateway API endpoints
#
# Tests every known endpoint, saves responses, and prints a summary.
# Run get-token.sh first to obtain an auth token.
#
# Usage: ./test-api.sh [--token <jwt>]
# =============================================================================

set -uo pipefail

GATEWAY_IP="192.168.50.236"
TOKEN_FILE="$(dirname "$0")/enphase_token.txt"
OUTPUT_DIR="$(dirname "$0")/api_responses"

# Parse args
TOKEN=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --token) TOKEN="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# Load token from file if not provided
if [ -z "$TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
    TOKEN=$(cat "$TOKEN_FILE" | tr -d '[:space:]')
fi

if [ -z "$TOKEN" ]; then
    echo "ERROR: No token found. Run get-token.sh first, or pass --token <jwt>"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo ""
echo "============================================"
echo "  Enphase IQ Gateway — API Endpoint Test"
echo "============================================"
echo "  Gateway: $GATEWAY_IP"
echo "  Token: ${TOKEN:0:20}... (${#TOKEN} chars)"
echo ""

# Helper: call endpoint, print status and save response
test_endpoint() {
    local label="$1"
    local path="$2"
    local auth="${3:-yes}"  # yes or no
    local filename
    filename="$OUTPUT_DIR/$(echo "$path" | tr '/' '_' | sed 's/^_//').json"

    if [ "$auth" = "yes" ]; then
        RESPONSE=$(curl -s -k \
            -H "Authorization: Bearer $TOKEN" \
            -w "\n__HTTP_STATUS__%{http_code}" \
            "https://$GATEWAY_IP$path" 2>&1)
    else
        RESPONSE=$(curl -s -k \
            -w "\n__HTTP_STATUS__%{http_code}" \
            "https://$GATEWAY_IP$path" 2>&1)
    fi

    HTTP_STATUS=$(echo "$RESPONSE" | grep "__HTTP_STATUS__" | sed 's/.*__HTTP_STATUS__//')
    BODY=$(echo "$RESPONSE" | grep -v "__HTTP_STATUS__")

    # Save response
    echo "$BODY" > "$filename"

    # Print summary line
    if [ "$HTTP_STATUS" = "200" ]; then
        SNIPPET=$(echo "$BODY" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    if isinstance(d, list):
        print(f'[list of {len(d)} items]')
    elif isinstance(d, dict):
        keys = list(d.keys())[:5]
        print('{' + ', '.join(keys) + (', ...' if len(d) > 5 else '') + '}')
    else:
        print(str(d)[:80])
except:
    line = sys.stdin.read(80).replace(chr(10), ' ')
    print(line)
" 2>/dev/null || echo "$BODY" | head -1 | cut -c1-80)
        printf "  %-40s \033[32m%s\033[0m  %s\n" "$label" "✓ $HTTP_STATUS" "$SNIPPET"
    else
        printf "  %-40s \033[31m%s\033[0m\n" "$label" "✗ $HTTP_STATUS"
    fi
}

echo "--- Unauthenticated Endpoints ---"
test_endpoint "/info.xml"               "/info.xml"              no
test_endpoint "/home.json"              "/home.json"             no

echo ""
echo "--- Production & Consumption ---"
test_endpoint "/production.json"        "/production.json"
test_endpoint "/api/v1/production"      "/api/v1/production"
test_endpoint "/api/v1/production/inverters" "/api/v1/production/inverters"

echo ""
echo "--- Meter Readings ---"
test_endpoint "/ivp/meters"             "/ivp/meters"
test_endpoint "/ivp/meters/readings"    "/ivp/meters/readings"
test_endpoint "/ivp/meters/gridReading" "/ivp/meters/gridReading"

echo ""
echo "--- Device Inventory ---"
test_endpoint "/inventory.json"         "/inventory.json"
test_endpoint "/api/v1/envoyinfo"       "/api/v1/envoyinfo"

echo ""
echo "--- Energy Data ---"
test_endpoint "/ivp/pdm/energy"         "/ivp/pdm/energy"
test_endpoint "/api/v1/eim/energy_today" "/api/v1/eim/energy_today"

echo ""
echo "--- System Info ---"
test_endpoint "/info.json"              "/info.json"

echo ""
echo "Responses saved to: $OUTPUT_DIR/"
echo ""
echo "Run: cat $OUTPUT_DIR/<filename>.json | python3 -m json.tool"
echo "     to pretty-print any response."
echo ""

# Summary: pretty-print production if available
PROD_FILE="$OUTPUT_DIR/api_v1_production.json"
if [ -f "$PROD_FILE" ] && python3 -c "import json,sys; json.load(open('$PROD_FILE'))" 2>/dev/null; then
    echo "=== Production Summary ==="
    python3 -c "
import json
d = json.load(open('$PROD_FILE'))
wh_today = d.get('wattHoursToday', 0)
wh_lifetime = d.get('wattHoursLifetime', 0)
w_now = d.get('wattsNow', 0)
print(f'  Current output:    {w_now:,.0f} W')
print(f'  Today\\'s energy:    {wh_today/1000:,.2f} kWh')
print(f'  Lifetime energy:   {wh_lifetime/1000:,.0f} kWh')
" 2>/dev/null || true
    echo ""
fi
