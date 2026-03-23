export function formatCoordinate(coord) {
  return coord != null ? coord.toFixed(6) : 'N/A';
}

export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function escapeAttr(str) {
  if (typeof str !== 'string') str = String(str == null ? '' : str);
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const _iconCache = new Map();

const _pinSizes = {
  self:    [32, 42],
  sos:     [32, 42],
  contact: [28, 37],
  default: [28, 37],
  offline: [24, 32],
  stored:  [20, 27],
};

/**
 * Create an SVG teardrop-pin marker element for MapLibre GL.
 * The pin tip sits at the bottom-center — use `anchor: 'bottom'`
 * on the MapLibre Marker so the tip lands on the exact coordinate.
 *
 * @param {string} color     CSS color for the pin fill
 * @param {string} [_text]   Unused, kept for call-site compat
 * @param {object} [options] { markerType, pulse }
 */
export function createMapIcon(color, _text, options = {}) {
  const type = options.markerType || 'default';
  const cacheKey = `${color}|${type}`;
  const cached = _iconCache.get(cacheKey);
  if (cached) return cached.cloneNode(true);

  const [w, h] = _pinSizes[type] || [28, 37];
  const el = document.createElement('div');
  el.className = `map-pin pin-${type}`;
  el.style.cssText = `width:${w}px;height:${h}px;`;

  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 34" width="${w}" height="${h}">`
    + `<path d="M12 0C5.37 0 0 5.37 0 12c0 8.13 10.81 20.45 11.39 21.12a.77.77 0 0 0 1.22 0C13.19 32.45 24 20.13 24 12 24 5.37 18.63 0 12 0z" fill="${escapeAttr(color)}" stroke="white" stroke-width="1.8"/>`
    + `<circle cx="12" cy="11" r="5.8" fill="white" fill-opacity="0.93"/>`
    + `</svg>`;

  _iconCache.set(cacheKey, el.cloneNode(true));
  return el;
}

/**
 * Generate a GeoJSON Polygon approximating a circle.
 * @param {[number, number]} center - [lng, lat]
 * @param {number} radiusMeters
 * @param {number} [points=64]
 */
export function circleGeoJSON(center, radiusMeters, points = 64) {
  const [lng, lat] = center;
  const km = radiusMeters / 1000;
  const distX = km / (111.320 * Math.cos(lat * Math.PI / 180));
  const distY = km / 110.574;
  const coords = [];
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI;
    coords.push([lng + distX * Math.cos(theta), lat + distY * Math.sin(theta)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

export function formatDistance(meters) {
  if (meters == null || !isFinite(meters)) return null;
  if (meters >= 1000) return (meters / 1000).toFixed(1) + ' km';
  return Math.round(meters) + ' m';
}

export function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

export function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
