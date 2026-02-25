/**
 * Smooth Leaflet marker interpolation using requestAnimationFrame.
 *
 * Each marker gets an animation state keyed by a unique ID.
 * When a new target arrives mid-animation, the current interpolated
 * position becomes the new start point — no snapping.
 */

const animations = new Map();
const _lastCallAt = new Map(); // tracks last call time per marker for adaptive duration

/**
 * Smoothly animate a Leaflet marker from its current position to a new one.
 *
 * @param {string}        id          Unique key for this marker (e.g. socketId).
 * @param {L.Marker}      marker      The Leaflet marker to move.
 * @param {[number,number]} target    [lat, lng] destination.
 * @param {number}        [duration]  Animation duration in ms. If omitted, computed
 *                                    from the interval since the previous call for this
 *                                    marker (capped 100–600 ms). Explicit 0 = instant.
 */
export function animateMarkerTo(id, marker, target, duration) {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    marker.setLatLng(target);
    animations.delete(id);
    _lastCallAt.delete(id);
    return;
  }

  const now = performance.now();
  if (duration === undefined) {
    const last = _lastCallAt.get(id);
    duration = last ? Math.min(Math.max((now - last) * 0.85, 100), 600) : 300;
  }
  _lastCallAt.set(id, now);
  const prev = animations.get(id);
  if (prev) cancelAnimationFrame(prev.raf);

  const startLatLng = marker.getLatLng();
  const startLat = startLatLng.lat;
  const startLng = startLatLng.lng;
  const [endLat, endLng] = target;

  // Skip animation for tiny moves (< ~0.5 m) — just set directly
  const dLat = endLat - startLat;
  const dLng = endLng - startLng;
  if (Math.abs(dLat) < 0.000005 && Math.abs(dLng) < 0.000005) {
    marker.setLatLng(target);
    animations.delete(id);
    return;
  }

  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease-out cubic for natural deceleration
    const ease = 1 - Math.pow(1 - t, 3);

    const lat = startLat + dLat * ease;
    const lng = startLng + dLng * ease;
    marker.setLatLng([lat, lng]);

    if (t < 1) {
      const state = animations.get(id);
      if (state) state.raf = requestAnimationFrame(step);
    } else {
      animations.delete(id);
    }
  }

  animations.set(id, { raf: requestAnimationFrame(step) });
}

/**
 * Cancel any running animation for a marker.
 * @param {string} id
 */
export function cancelAnimation(id) {
  const state = animations.get(id);
  if (state) {
    cancelAnimationFrame(state.raf);
    animations.delete(id);
  }
  _lastCallAt.delete(id);
}

/**
 * Cancel all running animations (e.g. on component destroy).
 */
export function cancelAllAnimations() {
  for (const state of animations.values()) {
    cancelAnimationFrame(state.raf);
  }
  animations.clear();
  _lastCallAt.clear();
}
