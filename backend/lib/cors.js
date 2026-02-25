var DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost",
    "https://localhost",
    "capacitor://localhost",
    "ionic://localhost"
];

function parseAllowedOrigins() {
    var raw = process.env.CORS_ALLOWED_ORIGINS || "";
    var list = raw
        .split(",")
        .map(function(v) { return v.trim(); })
        .filter(Boolean);

    // Keep defaults unless explicitly disabled.
    if (process.env.CORS_INCLUDE_DEFAULTS !== "false") {
        DEFAULT_ALLOWED_ORIGINS.forEach(function(origin) {
            if (!list.includes(origin)) list.push(origin);
        });
    }

    return new Set(list);
}

var allowedOrigins = parseAllowedOrigins();

function isAllowedOrigin(origin) {
    if (!origin) return true; // same-origin / non-browser clients
    return allowedOrigins.has(origin);
}

module.exports = {
    allowedOrigins: allowedOrigins,
    isAllowedOrigin: isAllowedOrigin
};