#!/usr/bin/env bash
# E2E smoke test: start dev server, check 12 routes return 200.
#
# Usage:
#   ./scripts/e2e-smoke.sh          # run against default port 5173
#   PORT=3000 ./scripts/e2e-smoke.sh # custom port
#
# Exit 0 if all routes pass, exit 1 if any fail.

set -euo pipefail

PORT="${PORT:-5173}"
BASE_URL="http://localhost:${PORT}"
TIMEOUT_SEC=60
START_TIME=$(date +%s)

# Routes to check (12 key pages)
ROUTES=(
  "/"
  "/home"
  "/profile"
  "/ideas"
  "/calendar"
  "/outputs"
  "/trends"
  "/quality"
  "/skills"
  "/settings"
  "/dashboard"
  "/database"
)

echo "=== Easel E2E Smoke Test ==="
echo "Target: ${BASE_URL}"
echo ""

# --- Start dev server in background ---
echo "Starting dev server..."
pnpm dev --port "${PORT}" --host 127.0.0.1 > /tmp/easel-dev-server.log 2>&1 &
SERVER_PID=$!

cleanup() {
  if kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- Wait for server to be ready ---
echo "Waiting for server to be ready (timeout: ${TIMEOUT_SEC}s)..."
READY=0
while [[ $(( $(date +%s) - START_TIME )) -lt ${TIMEOUT_SEC} ]]; do
  if curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/" 2>/dev/null | grep -q "200\|302\|304\|401"; then
    READY=1
    break
  fi
  sleep 1
done

if [[ ${READY} -eq 0 ]]; then
  echo "ERROR: Server did not become ready within ${TIMEOUT_SEC}s"
  echo "Last 20 lines of server log:"
  tail -20 /tmp/easel-dev-server.log
  exit 1
fi

echo "Server is ready. Took $(( $(date +%s) - START_TIME ))s."
echo ""

# --- Check routes ---
echo "Checking routes..."
echo ""

PASS=0
FAIL=0
FAILED_ROUTES=()

for route in "${ROUTES[@]}"; do
  # Follow redirects (-L), get final status code
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 "${BASE_URL}${route}" 2>/dev/null || echo "000")

  if [[ "${STATUS}" == "200" ]]; then
    echo "  ✓ ${route} → ${STATUS}"
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${route} → ${STATUS}"
    FAIL=$((FAIL + 1))
    FAILED_ROUTES+=("${route}")
  fi
done

echo ""
echo "=== Results ==="
echo "  Pass: ${PASS}/${#ROUTES[@]}"
echo "  Fail: ${FAIL}"

if [[ ${FAIL} -gt 0 ]]; then
  echo ""
  echo "Failed routes:"
  for route in "${FAILED_ROUTES[@]}"; do
    echo "  - ${route}"
  done
  echo ""
  echo "Server log (last 40 lines):"
  tail -40 /tmp/easel-dev-server.log
  exit 1
fi

echo ""
echo "All ${PASS} routes passed ✅"
exit 0
