var pino = require("pino");

// ── Structured logger ────────────────────────────────────────────────────────
var log = pino({ level: process.env.LOG_LEVEL || "info" });

// ── Resource limits ─────────────────────────────────────────────────────────
var MAX_ROOMS_PER_USER = 20;
var MAX_CONTACTS_PER_USER = 50;
var MAX_LIVE_LINKS_PER_USER = 10;
var POSITION_COOLDOWN_MS = 100;

module.exports = {
    log: log,
    MAX_ROOMS_PER_USER: MAX_ROOMS_PER_USER,
    MAX_CONTACTS_PER_USER: MAX_CONTACTS_PER_USER,
    MAX_LIVE_LINKS_PER_USER: MAX_LIVE_LINKS_PER_USER,
    POSITION_COOLDOWN_MS: POSITION_COOLDOWN_MS
};
