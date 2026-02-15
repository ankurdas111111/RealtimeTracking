var express = require("express");
var cache = require("../cache");
var config = require("../config");
var db = require("../lib/db");
var auth = require("../middleware/auth");
var emitters = require("../services/emitters");

var log = config.log;
var getDisplayName = emitters.getDisplayName;

var router = express.Router();

router.get("/", auth.requireAuth, function(req, res) {
    var userId = req.session.user.id;
    var ud = cache.usersCache[userId] || {};
    var displayName = getDisplayName(userId);
    res.render("index", { authUser: req.session.user, displayName: displayName, shareCode: ud.shareCode || "", userEmail: ud.email || "", userMobile: ud.mobile || "" });
});

router.get("/admin", auth.requireAuth, auth.requireAdmin, function(req, res) {
    var userId = req.session.user.id;
    var ud = cache.usersCache[userId] || {};
    var displayName = getDisplayName(userId);
    res.render("index", { authUser: req.session.user, displayName: displayName, shareCode: ud.shareCode || "", userEmail: ud.email || "", userMobile: ud.mobile || "" });
});

router.get("/watch/:token", function(req, res) {
    res.render("watch", { token: req.params.token });
});

router.get("/live/:token", async function(req, res) {
    var entry = cache.liveTokens.get(req.params.token);
    if (!entry) return res.status(404).render("live", { token: req.params.token, sharedBy: "", expired: true });
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        cache.liveTokens.delete(req.params.token);
        db.deleteLiveToken(req.params.token).catch(function(e) { log.error({ err: e.message }, "Failed to delete expired live token"); });
        return res.status(410).render("live", { token: req.params.token, sharedBy: getDisplayName(entry.userId), expired: true });
    }
    res.render("live", { token: req.params.token, sharedBy: getDisplayName(entry.userId), expired: false });
});

module.exports = router;
