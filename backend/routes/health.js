var express = require("express");
var cache = require("../cache");
var db = require("../lib/db");
var auth = require("../middleware/auth");

var router = express.Router();

router.get("/health", function(req, res) {
    res.json({ status: "ok", uptime: Math.round(process.uptime()), connections: cache.activeUsers.size, rooms: cache.rooms.size });
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
