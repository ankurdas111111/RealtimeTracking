#!/usr/bin/env bash
# Benchmark comparison: V2 (NestJS) vs V3 (Go)
# Usage: ./test/benchmark.sh [v3_port] [v2_port]
set -euo pipefail

V3_PORT="${1:-3001}"
V2_PORT="${2:-3000}"
ITERATIONS=100

echo "=== Kinnect Backend Benchmark ==="
echo "V3 (Go):    http://localhost:$V3_PORT"
echo "V2 (NestJS): http://localhost:$V2_PORT"
echo "Iterations: $ITERATIONS"
echo ""

bench_endpoint() {
  local label="$1" url="$2" n="$3"
  local total=0 min=999999 max=0

  for i in $(seq 1 "$n"); do
    t=$(curl -s -o /dev/null -w "%{time_total}" "$url" 2>/dev/null || echo "0")
    ms=$(echo "$t * 1000" | bc 2>/dev/null || echo "0")
    ms_int=${ms%.*}
    total=$((total + ms_int))
    if [ "$ms_int" -lt "$min" ]; then min=$ms_int; fi
    if [ "$ms_int" -gt "$max" ]; then max=$ms_int; fi
  done

  avg=$((total / n))
  printf "%-25s avg=%dms  min=%dms  max=%dms\n" "$label" "$avg" "$min" "$max"
}

echo "--- /health endpoint ---"
if curl -s "http://localhost:$V3_PORT/health" > /dev/null 2>&1; then
  bench_endpoint "V3 /health" "http://localhost:$V3_PORT/health" "$ITERATIONS"
else
  echo "V3 not running on port $V3_PORT"
fi

if curl -s "http://localhost:$V2_PORT/health" > /dev/null 2>&1; then
  bench_endpoint "V2 /health" "http://localhost:$V2_PORT/health" "$ITERATIONS"
else
  echo "V2 not running on port $V2_PORT"
fi

echo ""
echo "--- /api/csrf endpoint ---"
if curl -s "http://localhost:$V3_PORT/api/csrf" > /dev/null 2>&1; then
  bench_endpoint "V3 /api/csrf" "http://localhost:$V3_PORT/api/csrf" "$ITERATIONS"
fi

if curl -s "http://localhost:$V2_PORT/api/csrf" > /dev/null 2>&1; then
  bench_endpoint "V2 /api/csrf" "http://localhost:$V2_PORT/api/csrf" "$ITERATIONS"
fi

echo ""
echo "--- Memory usage ---"
if curl -s "http://localhost:$V3_PORT/health" > /dev/null 2>&1; then
  V3_HEALTH=$(curl -s "http://localhost:$V3_PORT/health")
  echo "V3: $(echo "$V3_HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('memoryMB',{}); print(f'RSS={m.get(\"rss\",\"?\")}MB HeapUsed={m.get(\"heapUsed\",\"?\")}MB')" 2>/dev/null || echo "$V3_HEALTH")"
fi
if curl -s "http://localhost:$V2_PORT/health" > /dev/null 2>&1; then
  V2_HEALTH=$(curl -s "http://localhost:$V2_PORT/health")
  echo "V2: $(echo "$V2_HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('memoryMB',{}); print(f'RSS={m.get(\"rss\",\"?\")}MB HeapUsed={m.get(\"heapUsed\",\"?\")}MB')" 2>/dev/null || echo "$V2_HEALTH")"
fi

echo ""
echo "=== Done ==="
