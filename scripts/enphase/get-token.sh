#!/usr/bin/env bash
# =============================================================================
# get-token.sh — Obtain a local JWT token for Enphase IQ Gateway
#
# The Enphase IQ Gateway (firmware D7.x+) requires a JWT Bearer token for all
# data API endpoints. This script walks you through getting a 1-year owner token.
#
# Device: 192.168.50.236 (serial 202315086671)
# =============================================================================

set -euo pipefail

GATEWAY_IP="192.168.50.236"
GATEWAY_SERIAL="202315086671"
TOKEN_FILE="$(dirname "$0")/enphase_token.txt"
TOKEN_ENDPOINT="https://entrez.enphaseenergy.com/tokens"

echo ""
echo "============================================"
echo "  Enphase IQ Gateway — Local Token Setup"
echo "============================================"
echo ""
echo "This script obtains a local JWT token for:"
echo "  Gateway: $GATEWAY_IP (serial $GATEWAY_SERIAL)"
echo ""
echo "You will need your Enphase Enlighten account credentials."
echo ""

# Step 1: Get credentials
read -rp "Enlighten email address: " ENLIGHTEN_EMAIL
read -rsp "Enlighten password: " ENLIGHTEN_PASSWORD
echo ""

echo ""
echo "Step 1: Logging into Enphase Enlighten..."

# Login to Enlighten and get session cookie
LOGIN_RESPONSE=$(curl -s -c /tmp/enphase_cookies.txt \
    -X POST "https://enlighten.enphaseenergy.com/login/login.json" \
    -H "Content-Type: application/json" \
    -d "{\"user\": {\"email\": \"$ENLIGHTEN_EMAIL\", \"password\": \"$ENLIGHTEN_PASSWORD\"}}" \
    2>&1)

# Check if login succeeded
if echo "$LOGIN_RESPONSE" | grep -q '"success":false'; then
    echo "ERROR: Login failed. Check your Enlighten credentials."
    echo "Response: $LOGIN_RESPONSE"
    exit 1
fi

echo "  Login successful."

# Extract session_id from the login response JSON
SESSION_ID=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null || echo "")

if [ -z "$SESSION_ID" ]; then
    # Try extracting from cookies
    SESSION_ID=$(grep "_enlighten_4_session" /tmp/enphase_cookies.txt 2>/dev/null | awk '{print $NF}' || echo "")
fi

if [ -z "$SESSION_ID" ]; then
    echo ""
    echo "Could not extract session_id automatically."
    echo "Please:"
    echo "  1. Open Chrome/Firefox"
    echo "  2. Log into https://enlighten.enphaseenergy.com"
    echo "  3. Open DevTools → Application → Cookies → enlighten.enphaseenergy.com"
    echo "  4. Copy the value of '_enlighten_4_session'"
    echo ""
    read -rp "Paste session_id here: " SESSION_ID
fi

echo ""
echo "Step 2: Requesting local API token from Enphase..."

# Request the local JWT token
TOKEN_RESPONSE=$(curl -s \
    -X POST "$TOKEN_ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\": \"$SESSION_ID\", \"serial_num\": \"$GATEWAY_SERIAL\", \"username\": \"$ENLIGHTEN_EMAIL\"}" \
    2>&1)

# Check for error
if echo "$TOKEN_RESPONSE" | grep -qi "error\|invalid\|unauthorized"; then
    echo "ERROR: Token request failed."
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

# The token is returned as a plain string (not JSON)
TOKEN=$(echo "$TOKEN_RESPONSE" | tr -d '[:space:]')

if [ -z "$TOKEN" ] || [ ${#TOKEN} -lt 100 ]; then
    echo "ERROR: Got unexpected token response:"
    echo "$TOKEN_RESPONSE"
    exit 1
fi

echo "  Token received! (${#TOKEN} characters)"

# Save token to file
echo "$TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

echo ""
echo "Step 3: Verifying token against gateway..."

VERIFY=$(curl -s -k \
    -H "Authorization: Bearer $TOKEN" \
    "https://$GATEWAY_IP/api/v1/production" 2>&1)

if echo "$VERIFY" | grep -q "wattHoursToday\|wattHoursLifetime\|production"; then
    echo "  SUCCESS! Token verified — API is accessible."
    echo ""
    echo "Token saved to: $TOKEN_FILE"
    echo ""
    echo "Run ./test-api.sh to explore all available endpoints."
else
    echo "  Warning: Could not verify token (gateway may be unreachable or token invalid)."
    echo "  Raw response: ${VERIFY:0:200}"
    echo ""
    echo "Token saved to: $TOKEN_FILE (may still be valid — try test-api.sh)"
fi

echo ""
echo "Note: This token is valid for 1 year (owner token)."
echo "      Keep enphase_token.txt secure — it grants full local API access."
echo ""

# Clean up
rm -f /tmp/enphase_cookies.txt
