var express = require("express");
var bcrypt = require("bcrypt");
var countryCodes = require("../lib/countryCodes");
var cache = require("../cache");
var config = require("../config");
var db = require("../lib/db");
var helpers = require("../lib/helpers");
var csrf = require("../middleware/csrf");
var rateLimitMW = require("../middleware/rateLimit");

var log = config.log;
var generateCode = helpers.generateCode;

function generateUniqueShareCode() {
    var c; do { c = generateCode(); } while (cache.shareCodes.has(c));
    return c;
}

var router = express.Router();

// ── Login (JSON API) ────────────────────────────────────────────────────────
router.post("/api/login", rateLimitMW.loginLimiter, csrf.verifyCsrf, async function(req, res) {
    var loginId = (req.body.login_id || "").trim();
    var loginMethod = (req.body.login_method || "").trim();
    var password = req.body.password || "";
    if (!loginId || !password) return res.status(400).json({ ok: false, error: "Email/mobile and password are required" });
    var userId = null;
    if (loginMethod === "mobile") {
        var cleaned = loginId.replace(/[\s\-()]/g, "");
        if (!/^\+\d{7,15}$/.test(cleaned)) return res.status(400).json({ ok: false, error: "Invalid mobile number format" });
        var parsed = countryCodes.parseFullNumber(cleaned);
        if (!parsed) return res.status(400).json({ ok: false, error: "Unrecognised country code" });
        var lenCheck = countryCodes.validateMobileLength(parsed.iso, parsed.local);
        if (!lenCheck.valid) return res.status(400).json({ ok: false, error: lenCheck.msg });
        userId = cache.mobileIndex.get(cleaned) || null;
    } else {
        loginId = loginId.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginId)) return res.status(400).json({ ok: false, error: "Invalid email address" });
        userId = cache.emailIndex.get(loginId) || null;
    }
    if (!userId) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    var userData = cache.usersCache[userId];
    if (!userData) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    try {
        var passwordHash = await db.getUserPasswordHash(userId);
        if (!passwordHash) return res.status(401).json({ ok: false, error: "Invalid credentials" });
        var match = await bcrypt.compare(password, passwordHash);
        if (!match) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    } catch (e) { return res.status(500).json({ ok: false, error: "Server error" }); }
    req.session.user = { id: userId, role: userData.role || "user" };
    log.info({ userId: userId }, "User logged in");
    res.json({ ok: true, userId: userId, role: userData.role || "user" });
});

// ── Register (JSON API) ─────────────────────────────────────────────────────
router.post("/api/register", rateLimitMW.registerLimiter, csrf.verifyCsrf, async function(req, res) {
    var firstName = (req.body.first_name || "").trim();
    var lastName = (req.body.last_name || "").trim();
    var password = req.body.password || "";
    var confirm = req.body.confirm || "";
    var contactType = (req.body.contact_type || "").trim();
    var contactValue = (req.body.contact_value || "").trim();
    if (!firstName) return res.status(400).json({ ok: false, error: "First name is required" });
    if (firstName.length > 50) return res.status(400).json({ ok: false, error: "First name too long (max 50)" });
    if (lastName.length > 50) return res.status(400).json({ ok: false, error: "Last name too long (max 50)" });
    if (!password) return res.status(400).json({ ok: false, error: "Password is required" });
    if (password.length < 6) return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });
    if (password !== confirm) return res.status(400).json({ ok: false, error: "Passwords do not match" });
    if (contactType !== "email" && contactType !== "mobile") return res.status(400).json({ ok: false, error: "Please choose email or mobile number" });
    if (!contactValue) return res.status(400).json({ ok: false, error: contactType === "email" ? "Email is required" : "Mobile number is required" });
    var email = null;
    var mobile = null;
    if (contactType === "email") {
        contactValue = contactValue.toLowerCase();
        if (contactValue.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue)) return res.status(400).json({ ok: false, error: "Invalid email address" });
        var existingEmail = await db.findUserByEmail(contactValue);
        if (existingEmail) return res.status(409).json({ ok: false, error: "This email is already registered" });
        email = contactValue;
    } else {
        contactValue = contactValue.replace(/[\s\-()]/g, "");
        if (!/^\+\d{7,15}$/.test(contactValue)) return res.status(400).json({ ok: false, error: "Invalid mobile number format (must include country code)" });
        var parsed = countryCodes.parseFullNumber(contactValue);
        if (!parsed) return res.status(400).json({ ok: false, error: "Unrecognised country code" });
        var lenCheck = countryCodes.validateMobileLength(parsed.iso, parsed.local);
        if (!lenCheck.valid) return res.status(400).json({ ok: false, error: lenCheck.msg });
        var existingMobile = await db.findUserByMobile(contactValue);
        if (existingMobile) return res.status(409).json({ ok: false, error: "This mobile number is already registered" });
        mobile = contactValue;
    }
    try {
        var passwordHash = await bcrypt.hash(password, 10);
        var shareCode = generateUniqueShareCode();
        var adminEnv = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.trim().toLowerCase() : "";
        var role = (adminEnv && email && email === adminEnv) ? "admin" : "user";
        var createdAt = Date.now();
        var userId = await db.createUser(firstName, lastName, passwordHash, role, shareCode, createdAt, email, mobile);
        cache.usersCache[userId] = { firstName: firstName, lastName: lastName, role: role, shareCode: shareCode, email: email, mobile: mobile, createdAt: createdAt };
        cache.shareCodes.set(shareCode, userId);
        if (email) cache.emailIndex.set(email, userId);
        if (mobile) cache.mobileIndex.set(mobile, userId);
        req.session.user = { id: userId, role: role };
        log.info({ userId: userId, role: role }, "User registered");
        res.json({ ok: true, userId: userId, role: role });
    } catch (e) {
        log.error({ err: e.message }, "Registration failed");
        return res.status(500).json({ ok: false, error: "Server error" });
    }
});

// ── Logout (JSON API) ───────────────────────────────────────────────────────
router.post("/api/logout", csrf.verifyCsrf, function(req, res) {
    var userId = req.session && req.session.user ? req.session.user.id : "unknown";
    req.session.destroy(function() {
        log.info({ userId: userId }, "User logged out");
        res.json({ ok: true });
    });
});

module.exports = router;
