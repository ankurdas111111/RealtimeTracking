var crypto = require("crypto");

// ── Input sanitization ──────────────────────────────────────────────────────
function sanitizeString(val, maxLen) {
    if (typeof val !== "string") return "";
    return val.replace(/[<>"'&]/g, "").substring(0, maxLen || 200);
}

// ── Position validation ─────────────────────────────────────────────────────
function validatePosition(data) {
    if (!data || typeof data !== "object") return null;
    var lat = Number(data.latitude);
    var lng = Number(data.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    var speed = Number(data.speed) || 0;
    if (speed < 0 || speed > 1000) speed = 0;
    var accuracy = data.accuracy != null ? Number(data.accuracy) : null;
    if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000)) accuracy = null;
    var timestamp = data.timestamp != null ? Number(data.timestamp) : null;
    if (timestamp != null && !Number.isFinite(timestamp)) timestamp = null;
    return { latitude: lat, longitude: lng, speed: speed, formattedTime: sanitizeString(data.formattedTime, 50), accuracy: accuracy, timestamp: timestamp };
}

// ── Haversine distance (metres) ─────────────────────────────────────────────
function haversineM(lat1, lon1, lat2, lon2) {
    var R = 6371e3;
    var toRad = function(x) { return (x * Math.PI) / 180; };
    var p1 = toRad(lat1), p2 = toRad(lat2);
    var dp = toRad(lat2 - lat1), dl = toRad(lon2 - lon1);
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Code generation ─────────────────────────────────────────────────────────
function generateCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var code = "";
    var bytes = crypto.randomBytes(6);
    for (var i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
    return code;
}

// ── Socket rate limiter ─────────────────────────────────────────────────────
function socketRateLimit(socket, event, maxPerMinute) {
    var key = "_rl_" + event;
    socket[key] = socket[key] || { count: 0, resetAt: Date.now() + 60000 };
    var rl = socket[key];
    if (Date.now() > rl.resetAt) { rl.count = 0; rl.resetAt = Date.now() + 60000; }
    rl.count++;
    return rl.count <= maxPerMinute;
}

module.exports = {
    sanitizeString: sanitizeString,
    validatePosition: validatePosition,
    haversineM: haversineM,
    generateCode: generateCode,
    socketRateLimit: socketRateLimit
};
