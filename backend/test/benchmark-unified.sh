#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3001}"
USERS="${2:-10}"
DURATION="${3:-20}"
INTERVAL="${4:-250}"

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

node "$ROOT_DIR/scripts/unified-benchmark.mjs" \
  --name v3 \
  --url "http://localhost:${PORT}" \
  --protocol ws \
  --users "$USERS" \
  --duration "$DURATION" \
  --interval "$INTERVAL"
