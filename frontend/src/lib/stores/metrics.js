import { writable } from 'svelte/store';

/**
 * Observable tracking metrics for the GPS pipeline.
 *
 * Updated by MainApp.svelte on each accepted GPS fix.
 * Read by InfoPanel.svelte to display real-time tracking stats.
 */
export const trackingMetrics = writable({
  lastAccuracy: null,       // metres — most recent GPS accuracy
  avgAccuracy: null,        // metres — rolling average over last ~20 fixes
  fixCount: 0,              // total accepted fixes since tracking started
  kalmanCorrectionM: 0,     // metres — Kalman correction magnitude (last fix)
  filterState: 'cold',      // 'cold' | 'warm' | 'locked'
  lastUpdateAt: null,       // Date.now() of last accepted fix
  updatesPerSec: 0          // rolling updates/sec estimate
});

// Rolling accuracy average (keeps last 20 samples)
const accuracySamples = [];
const MAX_SAMPLES = 20;
let fixTimestamps = [];

/**
 * Record a new GPS fix in the metrics store.
 *
 * @param {object} opts
 * @param {number}  opts.accuracy        GPS accuracy in metres
 * @param {number}  opts.kalmanCorrectionM  Kalman correction in metres
 * @param {boolean} opts.filterWarm      Whether the Kalman filter has warmed up
 */
export function recordFix({ accuracy, kalmanCorrectionM, filterWarm }) {
  const now = Date.now();

  // Rolling accuracy average
  if (accuracy != null && Number.isFinite(accuracy)) {
    accuracySamples.push(accuracy);
    if (accuracySamples.length > MAX_SAMPLES) accuracySamples.shift();
  }
  const avgAccuracy = accuracySamples.length > 0
    ? Math.round(accuracySamples.reduce((a, b) => a + b, 0) / accuracySamples.length)
    : null;

  // Updates per second (count fixes in last 3 seconds)
  fixTimestamps.push(now);
  fixTimestamps = fixTimestamps.filter(t => now - t < 3000);
  const updatesPerSec = fixTimestamps.length > 1
    ? Number((fixTimestamps.length / 3).toFixed(1))
    : 0;

  trackingMetrics.update(m => ({
    lastAccuracy: accuracy != null ? Math.round(accuracy) : m.lastAccuracy,
    avgAccuracy,
    fixCount: m.fixCount + 1,
    kalmanCorrectionM: kalmanCorrectionM != null ? Number(kalmanCorrectionM.toFixed(1)) : 0,
    filterState: !filterWarm ? 'cold' : (accuracySamples.length >= 5 ? 'locked' : 'warm'),
    lastUpdateAt: now,
    updatesPerSec
  }));
}

/**
 * Reset all metrics (called when tracking stops).
 */
export function resetMetrics() {
  accuracySamples.length = 0;
  fixTimestamps = [];
  trackingMetrics.set({
    lastAccuracy: null,
    avgAccuracy: null,
    fixCount: 0,
    kalmanCorrectionM: 0,
    filterState: 'cold',
    lastUpdateAt: null,
    updatesPerSec: 0
  });
}
