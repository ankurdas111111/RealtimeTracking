var express = require("express");
var rateLimit = require("express-rate-limit");
var cache = require("../cache");
var config = require("../config");
var db = require("../lib/db");
var emitters = require("../services/emitters");

var log = config.log;
var getDisplayName = emitters.getDisplayName;

var router = express.Router();

var publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// ── CSRF token endpoint for SPA ─────────────────────────────────────────────
router.get("/api/csrf", publicLimiter, function(req, res) {
    res.json({ csrfToken: res.locals.csrfToken || req.session.csrfToken || "" });
});

// ── User session info for SPA ───────────────────────────────────────────────
router.get("/api/me", publicLimiter, function(req, res) {
    if (!req.session || !req.session.user || !req.session.user.id) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    var userId = req.session.user.id;
    var ud = cache.usersCache[userId] || {};
    var displayName = getDisplayName(userId);
    res.json({
        ok: true,
        userId: userId,
        displayName: displayName,
        role: req.session.user.role || ud.role || "user",
        shareCode: ud.shareCode || "",
        email: ud.email || "",
        mobile: ud.mobile || ""
    });
});

// ── Live/Watch token endpoints (JSON) ───────────────────────────────────────
router.get("/api/live/:token", function(req, res) {
    var entry = cache.liveTokens.get(req.params.token);
    if (!entry) return res.json({ ok: false, expired: true });
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        cache.liveTokens.delete(req.params.token);
        db.deleteLiveToken(req.params.token).catch(function(e) { log.error({ err: e.message }, "Failed to delete expired live token"); });
        return res.json({ ok: false, expired: true, sharedBy: getDisplayName(entry.userId) });
    }
    res.json({ ok: true, token: req.params.token, sharedBy: getDisplayName(entry.userId), expired: false });
});

router.get("/api/watch/:token", function(req, res) {
    var entry = cache.watchTokens.get(req.params.token);
    if (!entry || entry.exp < Date.now()) {
        if (entry) cache.watchTokens.delete(req.params.token);
        return res.json({ ok: false, expired: true });
    }
    res.json({ ok: true, token: req.params.token });
});

module.exports = router;
