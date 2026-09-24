#!/usr/bin/env bash
# E2E smoke test: check the 13 Easel routes return 200.
#
# Usage:
#   ./scripts/e2e-smoke.sh           # run against default port 5173
#   PORT=9494 ./scripts/e2e-smoke.sh # custom port
#
# If a server is already listening on the port it is reused and left running
# (handy when you already have `pnpm dev` open). Otherwise one is started with
# `pnpm dev`, falling back to ./node_modules/.bin/agent-native when pnpm is not
# on PATH, and stopped on exit.
#
# Exit 0 if all routes pass, exit 1 if any fail.

set -euo pipefail

PORT="${PORT:-5173}"
BASE_URL="http://localhost:${PORT}"
TIMEOUT_SEC=60
START_TIME=$(date +%s)

# Routes to check (13 key pages)
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
  "/publish"
  "/metrics"
)

echo "=== Easel E2E Smoke Test ==="
echo "Target: ${BASE_URL}"
echo ""

# --- Reuse an already-running server, else start one ---
SERVER_PID=""
REUSED=0

if curl -s -o /dev/null -w "%{http_code}" --max-time 3 "${BASE_URL}/" 2>/dev/null \
     | grep -qE "200|302|304|401"; then
  REUSED=1
  echo "Reusing dev server already listening on ${BASE_URL} (will not stop it)."
else
  if command -v pnpm >/dev/null 2>&1; then
    DEV_CMD=(pnpm dev)
  elif [[ -x ./node_modules/.bin/agent-native ]]; then
    DEV_CMD=(./node_modules/.bin/agent-native dev)
  else
    echo "ERROR: neither pnpm nor ./node_modules/.bin/agent-native is available."
    echo "Start the dev server yourself, then re-run with its port, e.g.:"
    echo "  PORT=9494 ./scripts/e2e-smoke.sh"
    exit 1
  fi

  echo "Starting dev server: ${DEV_CMD[*]} --port ${PORT} --host 127.0.0.1"
  "${DEV_CMD[@]}" --port "${PORT}" --host 127.0.0.1 > /tmp/easel-dev-server.log 2>&1 &
  SERVER_PID=$!
fi

cleanup() {
  # Only stop a server this script started; never kill a reused one.
  [[ -n "${SERVER_PID}" ]] || return 0
  if kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- Wait for server to be ready ---
if [[ "${REUSED}" -eq 0 ]]; then
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
else
  echo "Server is ready (reused)."
fi
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
