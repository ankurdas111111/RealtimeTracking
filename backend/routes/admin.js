var express = require("express");
var cache = require("../cache");
var config = require("../config");
var db = require("../lib/db");
var auth = require("../middleware/auth");
var csrf = require("../middleware/csrf");
var emitters = require("../services/emitters");

var log = config.log;

var router = express.Router();

router.post("/api/admin/promote", auth.requireAuth, auth.requireAdmin, csrf.verifyCsrf, async function(req, res) {
    var targetUserId = (req.body.userId || "").trim();
    var newRole = req.body.role === "admin" ? "admin" : "user";
    if (!targetUserId || !cache.usersCache[targetUserId]) return res.status(404).json({ error: "User not found" });
    await db.updateUserRole(targetUserId, newRole);
    cache.usersCache[targetUserId].role = newRole;
    var targetUser = emitters.findActiveUserByUserId(targetUserId);
    if (targetUser) targetUser.role = newRole;
    log.info({ targetUserId: targetUserId, newRole: newRole, by: req.session.user.id }, "Role changed");
    res.json({ ok: true, userId: targetUserId, role: newRole });
});

module.exports = router;
