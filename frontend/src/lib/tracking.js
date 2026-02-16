import L from 'leaflet';

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

/**
 * Create a Leaflet divIcon with badge/shield marker styling.
 * @param {string} color - The background color of the marker.
 * @param {string} text - The text to display inside the marker.
 * @param {object} options - Options: { pulse, markerType }
 *   markerType: 'self' | 'contact' | 'sos' | 'offline' | 'stored' | 'default'
 */
export function createMapIcon(color, text, options = {}) {
  const type = options.markerType || 'default';
  const pulseClass = options.pulse ? ' pulse' : '';
  const typeClass = type !== 'default' ? ` marker-${type}` : '';
  const safeColor = escapeAttr(color);
  const safeText = escapeAttr(text || '');

  let w = 32, h = 40;
  if (type === 'self') { w = 36; h = 44; }
  else if (type === 'sos') { w = 36; h = 44; }
  else if (type === 'offline') { w = 28; h = 36; }
  else if (type === 'stored') { w = 24; h = 30; }

  const html = `<div class="badge-marker${pulseClass}${typeClass}" style="--marker-color: ${safeColor}; width: ${w}px; height: ${h}px;">
    <svg viewBox="0 0 32 40" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bevel-${type}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.35)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.15)"/>
        </linearGradient>
        <filter id="shadow-${type}" x="-20%" y="-10%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
        </filter>
      </defs>
      <path d="M16 38 C16 38 2 24 2 14 A14 14 0 0 1 30 14 C30 24 16 38 16 38Z"
            fill="${safeColor}" filter="url(#shadow-${type})"/>
      <path d="M16 38 C16 38 2 24 2 14 A14 14 0 0 1 30 14 C30 24 16 38 16 38Z"
            fill="url(#bevel-${type})" opacity="0.5"/>
      <circle cx="16" cy="14" r="10" fill="white" opacity="0.95"/>
    </svg>
    <span class="badge-text">${safeText}</span>
  </div>`;

  return L.divIcon({
    className: `custom-map-icon`,
    html: html,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h + 4]
  });
}

/**
 * Create a geofence circle with custom styling.
 */
export function createGeofenceCircle(map, lat, lng, radiusM, options = {}) {
  return L.circle([lat, lng], {
    radius: radiusM,
    color: options.color || 'var(--primary-500)',
    weight: 2,
    opacity: 0.6,
    dashArray: '8 4',
    fillColor: options.fillColor || 'var(--primary-500)',
    fillOpacity: 0.06,
    className: 'geofence-circle'
  }).addTo(map);
}

export function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

export function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
