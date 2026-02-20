var express = require("express");
var perfHooks = require("perf_hooks");
var rateLimit = require("express-rate-limit");
var cache = require("../cache");
var db = require("../lib/db");
var auth = require("../middleware/auth");
var visibility = require("../services/visibility");

var router = express.Router();

var healthLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// ── Event-loop delay histogram (built-in, zero overhead) ─────────────────────
var elHistogram = perfHooks.monitorEventLoopDelay({ resolution: 20 });
elHistogram.enable();

router.get("/health", healthLimiter, async function(req, res) {
    var dbOk = false;
    try {
        await db.getPool().query("SELECT 1");
        dbOk = true;
    } catch (_) {}
    var status = dbOk ? "ok" : "degraded";
    var code = dbOk ? 200 : 503;
    var mem = process.memoryUsage();
    res.status(code).json({
        status: status,
        uptime: Math.round(process.uptime()),
        connections: cache.activeUsers.size,
        rooms: cache.rooms.size,
        db: dbOk ? "connected" : "unreachable",
        eventLoopLagMs: {
            min: +(elHistogram.min / 1e6).toFixed(2),
            p50: +(elHistogram.percentile(50) / 1e6).toFixed(2),
            p99: +(elHistogram.percentile(99) / 1e6).toFixed(2),
            max: +(elHistogram.max / 1e6).toFixed(2)
        },
        memoryMB: {
            rss: +(mem.rss / 1048576).toFixed(1),
            heapUsed: +(mem.heapUsed / 1048576).toFixed(1),
            heapTotal: +(mem.heapTotal / 1048576).toFixed(1)
        },
        positionQueueDepth: visibility.getPositionQueueDepth()
    });
});

router.get("/health/db", auth.requireAuth, auth.requireAdmin, async function(req, res) {
    try {
        var result = await db.getTableSizes();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: "Failed to query DB stats" });
    }
});

module.exports = router;
