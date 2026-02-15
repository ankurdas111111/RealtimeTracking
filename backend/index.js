require("dotenv").config();

var config = require("./config");
var db = require("./lib/db");
var cache = require("./cache");
var appModule = require("./app");
var socketModule = require("./socket");
var cleanup = require("./services/cleanup");

var log = config.log;
var server = appModule.server;
var sessionMiddleware = appModule.sessionMiddleware;

// ── Create Socket.IO server ─────────────────────────────────────────────────
var io = socketModule.createSocketServer(server, sessionMiddleware);

// ── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal) {
    log.info({ signal: signal }, "Shutting down gracefully");
    db.closePool().catch(function(e) { log.error({ err: e.message }, "Failed to close DB pool"); });
    server.close(function() {
        log.info("HTTP server closed");
        process.exit(0);
    });
    setTimeout(function() { log.error("Forced shutdown after timeout"); process.exit(1); }, 10000);
}
process.on("SIGTERM", function() { shutdown("SIGTERM"); });
process.on("SIGINT", function() { shutdown("SIGINT"); });

// ── Start ───────────────────────────────────────────────────────────────────
async function start() {
    try {
        await db.initDb();
        log.info("Database schema initialised");
        var data = await db.loadAll();
        cache.usersCache = data.usersCache;
        cache.shareCodes = data.shareCodes;
        cache.emailIndex = data.emailIndex;
        cache.mobileIndex = data.mobileIndex;
        cache.rooms = data.rooms;
        cache.contacts = data.contacts;
        cache.liveTokens = data.liveTokens;
        log.info({
            users: Object.keys(cache.usersCache).length,
            rooms: cache.rooms.size,
            contacts: cache.contacts.size,
            liveTokens: cache.liveTokens.size
        }, "Data loaded from PostgreSQL");
    } catch (e) {
        log.fatal({ err: e.message }, "Failed to initialise database");
        process.exit(1);
    }
    var PORT = process.env.PORT || 3000;
    if (process.env.NODE_ENV !== "test") {
        server.listen(PORT, function() {
            log.info({ port: PORT }, "Server running");
        });
    }
    // Start cleanup intervals
    cleanup.startAll();
}

if (process.env.NODE_ENV !== "test") {
    start();
}

// ── Exports for testing ─────────────────────────────────────────────────────
module.exports = { app: appModule.app, server: server, io: io, start: start };
