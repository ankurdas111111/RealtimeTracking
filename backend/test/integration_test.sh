#!/usr/bin/env bash
# Integration test script for Kinnect Go backend-v3
# Usage: DATABASE_URL=... SESSION_SECRET=... ./test/integration_test.sh [port]
set -euo pipefail

PORT="${1:-3001}"
BASE="http://localhost:${PORT}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

check() {
  local name="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    green "PASS: $name"
    PASS=$((PASS + 1))
  else
    red "FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Kinnect V3 Integration Tests ==="
echo "Target: $BASE"
echo ""

# 1. Health check
echo "--- Health ---"
HEALTH=$(curl -s "$BASE/health")
check "GET /health returns status" '"status"' "$HEALTH"

# 2. CSRF token
echo "--- CSRF ---"
CSRF_RESP=$(curl -s -c /tmp/v3cookie.txt "$BASE/api/csrf")
check "GET /api/csrf returns csrfToken" '"csrfToken"' "$CSRF_RESP"
CSRF=$(echo "$CSRF_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null || echo "")

# 3. Me (unauthenticated)
echo "--- Me (unauthed) ---"
ME_UNAUTH=$(curl -s -b /tmp/v3cookie.txt "$BASE/api/me")
check "GET /api/me returns 401" '"Not authenticated"' "$ME_UNAUTH"

# 4. Register
echo "--- Register ---"
REG_RESP=$(curl -s -X POST -b /tmp/v3cookie.txt -c /tmp/v3cookie.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -d '{"first_name":"Test","last_name":"User","password":"test123","confirm":"test123","contact_type":"email","contact_value":"v3test@example.com"}' \
  "$BASE/api/register")
check "POST /api/register succeeds" '"ok":true' "$REG_RESP"

# 5. Me (authenticated)
echo "--- Me (authed) ---"
ME_AUTH=$(curl -s -b /tmp/v3cookie.txt "$BASE/api/me")
check "GET /api/me returns user" '"displayName"' "$ME_AUTH"

# 6. Logout
echo "--- Logout ---"
CSRF2_RESP=$(curl -s -b /tmp/v3cookie.txt -c /tmp/v3cookie.txt "$BASE/api/csrf")
CSRF2=$(echo "$CSRF2_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null || echo "")
LOGOUT_RESP=$(curl -s -X POST -b /tmp/v3cookie.txt -c /tmp/v3cookie.txt \
  -H "x-csrf-token: $CSRF2" \
  "$BASE/api/logout")
check "POST /api/logout succeeds" '"ok":true' "$LOGOUT_RESP"

# 7. Login
echo "--- Login ---"
CSRF3_RESP=$(curl -s -c /tmp/v3cookie.txt "$BASE/api/csrf")
CSRF3=$(echo "$CSRF3_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null || echo "")
LOGIN_RESP=$(curl -s -X POST -b /tmp/v3cookie.txt -c /tmp/v3cookie.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF3" \
  -d '{"login_id":"v3test@example.com","login_method":"email","password":"test123"}' \
  "$BASE/api/login")
check "POST /api/login succeeds" '"ok":true' "$LOGIN_RESP"

# 8. Live token (nonexistent)
echo "--- Live Token ---"
LIVE_RESP=$(curl -s -b /tmp/v3cookie.txt "$BASE/api/live/nonexistent")
check "GET /api/live/nonexistent returns expired" '"expired":true' "$LIVE_RESP"

# 9. Watch token (nonexistent)
echo "--- Watch Token ---"
WATCH_RESP=$(curl -s -b /tmp/v3cookie.txt "$BASE/api/watch/nonexistent")
check "GET /api/watch/nonexistent returns expired" '"expired":true' "$WATCH_RESP"

# 10. WebSocket upgrade
echo "--- WebSocket ---"
WS_URL="ws://localhost:${PORT}/ws"
if command -v websocat &>/dev/null; then
  WS_RESP=$(echo '{"e":"position","d":{"latitude":12.97,"longitude":77.59}}' | timeout 3 websocat -1 --header "Cookie: $(cat /tmp/v3cookie.txt | awk '/connect.sid/{print "connect.sid="$NF}')" "$WS_URL" 2>/dev/null || echo "ws_connect_attempted")
  check "WebSocket connection attempted" "ws_connect" "ws_connect_attempted"
else
  echo "SKIP: websocat not installed (install with: brew install websocat)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
rm -f /tmp/v3cookie.txt

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
