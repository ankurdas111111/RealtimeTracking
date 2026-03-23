/**
 * Smooth MapLibre marker interpolation using requestAnimationFrame.
 *
 * Each marker gets an animation state keyed by a unique ID.
 * When a new target arrives mid-animation, the current interpolated
 * position becomes the new start point — no snapping.
 *
 * Coordinates use MapLibre convention: [lng, lat].
 */

const animations = new Map();
const _lastCallAt = new Map();
const _lastVelocity = new Map(); // id → {dlng, dlat, dtMs} — velocity for predictive positioning

/**
 * Smoothly animate a MapLibre marker from its current position to a new one.
 *
 * @param {string}            id       Unique key for this marker (e.g. socketId).
 * @param {maplibregl.Marker} marker   The MapLibre marker to move.
 * @param {[number,number]}   target   [lng, lat] destination.
 * @param {number}           [duration] Animation duration in ms.
 */
export function animateMarkerTo(id, marker, target, duration) {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    marker.setLngLat(target);
    animations.delete(id);
    _lastCallAt.delete(id);
    return;
  }

  const now = performance.now();
  const lastCallTime = _lastCallAt.get(id);
  if (duration === undefined) {
    duration = lastCallTime ? Math.min(Math.max((now - lastCallTime) * 0.85, 100), 600) : 300;
  }

  const prev = animations.get(id);
  if (prev) cancelAnimationFrame(prev.raf);

  const startLL = marker.getLngLat();
  const startLng = startLL.lng;
  const startLat = startLL.lat;
  const [endLng, endLat] = target;

  // Record velocity for predictive positioning
  if (lastCallTime && (now - lastCallTime) < 5000) {
    const dtMs = now - lastCallTime;
    const prevVel = _lastVelocity.get(id);
    const rawDlng = endLng - startLng;
    const rawDlat = endLat - startLat;
    // Exponential smoothing of velocity (alpha = 0.4)
    const alpha = 0.4;
    _lastVelocity.set(id, {
      dlng: prevVel ? alpha * rawDlng + (1 - alpha) * prevVel.dlng : rawDlng,
      dlat: prevVel ? alpha * rawDlat + (1 - alpha) * prevVel.dlat : rawDlat,
      dtMs,
    });
  } else {
    _lastVelocity.delete(id);
  }

  _lastCallAt.set(id, now);

  const dLng = endLng - startLng;
  const dLat = endLat - startLat;
  if (Math.abs(dLat) < 0.000005 && Math.abs(dLng) < 0.000005) {
    marker.setLngLat(target);
    animations.delete(id);
    return;
  }

  // Predictive overshoot: project position slightly beyond target based on velocity
  const vel = _lastVelocity.get(id);
  let predictLng = endLng;
  let predictLat = endLat;
  if (vel && duration > 0 && vel.dtMs > 0) {
    const overshootFactor = Math.min(duration / vel.dtMs, 1) * 0.25; // max 25% overshoot
    predictLng = endLng + vel.dlng * overshootFactor;
    predictLat = endLat + vel.dlat * overshootFactor;
  }

  const totalDlng = predictLng - startLng;
  const totalDlat = predictLat - startLat;

  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Cubic ease-out for natural deceleration
    const ease = 1 - Math.pow(1 - t, 3);

    const lng = startLng + totalDlng * ease;
    const lat = startLat + totalDlat * ease;
    marker.setLngLat([lng, lat]);

    if (t < 1) {
      const state = animations.get(id);
      if (state) state.raf = requestAnimationFrame(step);
    } else {
      animations.delete(id);
    }
  }

  animations.set(id, { raf: requestAnimationFrame(step) });
}

export function cancelAnimation(id) {
  const state = animations.get(id);
  if (state) {
    cancelAnimationFrame(state.raf);
    animations.delete(id);
  }
  _lastCallAt.delete(id);
  _lastVelocity.delete(id);
}

export function cancelAllAnimations() {
  for (const state of animations.values()) {
    cancelAnimationFrame(state.raf);
  }
  animations.clear();
  _lastCallAt.clear();
  _lastVelocity.clear();
}
