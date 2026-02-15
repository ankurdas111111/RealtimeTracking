function formatCoordinate(coord) {
    return coord.toFixed(6);
}

function calculateDistance(lat1, lon1, lat2, lon2) {

    const R = 6371e3; 

    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180;
    const dl = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(dp/2) * Math.sin(dp/2) +
              Math.cos(p1) * Math.cos(p2) *
              Math.sin(dl/2) * Math.sin(dl/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

function escapeAttr(str) {
    if (typeof str !== 'string') str = String(str == null ? '' : str);
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createMapIcon(color, text, options) {
    const opts = options || {};
    const pulseClass = opts.pulse ? ' pulse' : '';
    const safeColor = escapeAttr(color);
    const safeText = escapeAttr(text || '');
    return L.divIcon({
        className: 'custom-map-icon',
        html: '<div class="dot' + pulseClass + '" style="background-color: ' + safeColor + ';">' + safeText + '</div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
}

function calculateAverageSpeed(positions, timestamps) {

    if (positions.length < 2 || timestamps.length < 2) {
        return 0;
    }

    let totalDistance = 0;
    for (let i = 1; i < positions.length; i++) {
        const [lat1, lon1] = positions[i-1];
        const [lat2, lon2] = positions[i];
        totalDistance += calculateDistance(lat1, lon1, lat2, lon2);
    }

    const timeElapsed = (timestamps[timestamps.length-1] - timestamps[0]) / 1000;

    if (timeElapsed === 0) {
        return 0;
    }

    return (totalDistance / timeElapsed) * 3.6;
}
