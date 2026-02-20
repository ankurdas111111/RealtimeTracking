import { writable } from 'svelte/store';

/**
 * E2E latency metrics computed from position updates.
 *
 * Each incoming userUpdate carries `timestamp` (origin device time) and
 * `serverTs` (server broadcast time). Viewers compute:
 *   e2eLatency = Date.now() - timestamp
 *   serverHop  = serverTs - timestamp
 *
 * NOTE: e2e latency is approximate — it relies on clocks being roughly
 * synchronised. On a LAN they typically are within 10-50ms. Over the
 * internet, NTP keeps them within ~50-200ms.
 */
export const latencyMetrics = writable({
  lastE2eMs: null,
  avgE2eMs: null,
  lastServerHopMs: null,
  sampleCount: 0
});

const samples = [];
const MAX_SAMPLES = 30;

/**
 * Record a latency sample from a received position update.
 *
 * @param {number} originTs  The `timestamp` field from the position payload.
 * @param {number} [serverTs]  The `serverTs` field added by the broadcast flush.
 */
export function recordLatency(originTs, serverTs) {
  if (!originTs || !Number.isFinite(originTs)) return;
  const now = Date.now();
  const e2e = Math.max(0, now - originTs);
  const hop = serverTs && Number.isFinite(serverTs) ? Math.max(0, serverTs - originTs) : null;

  samples.push(e2e);
  if (samples.length > MAX_SAMPLES) samples.shift();

  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);

  latencyMetrics.set({
    lastE2eMs: e2e,
    avgE2eMs: avg,
    lastServerHopMs: hop,
    sampleCount: samples.length
  });
}

/**
 * Reset latency metrics.
 */
export function resetLatency() {
  samples.length = 0;
  latencyMetrics.set({
    lastE2eMs: null,
    avgE2eMs: null,
    lastServerHopMs: null,
    sampleCount: 0
  });
}
