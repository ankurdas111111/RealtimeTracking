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
  if (duration === undefined) {
    const last = _lastCallAt.get(id);
    duration = last ? Math.min(Math.max((now - last) * 0.85, 100), 600) : 300;
  }
  _lastCallAt.set(id, now);
  const prev = animations.get(id);
  if (prev) cancelAnimationFrame(prev.raf);

  const startLL = marker.getLngLat();
  const startLng = startLL.lng;
  const startLat = startLL.lat;
  const [endLng, endLat] = target;

  const dLng = endLng - startLng;
  const dLat = endLat - startLat;
  if (Math.abs(dLat) < 0.000005 && Math.abs(dLng) < 0.000005) {
    marker.setLngLat(target);
    animations.delete(id);
    return;
  }

  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);

    const lng = startLng + dLng * ease;
    const lat = startLat + dLat * ease;
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
}

export function cancelAllAnimations() {
  for (const state of animations.values()) {
    cancelAnimationFrame(state.raf);
  }
  animations.clear();
  _lastCallAt.clear();
}
