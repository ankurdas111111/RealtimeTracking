var express = require("express");
var bcrypt = require("bcryptjs");
var countryCodes = require("../../frontend/js/country-codes");
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

// ── Login ────────────────────────────────────────────────────────────────────
router.get("/login", function(req, res) {
    if (req.session && req.session.user && req.session.user.id) return res.redirect("/");
    res.render("login", { error: null });
});

router.post("/login", rateLimitMW.loginLimiter, csrf.verifyCsrf, async function(req, res) {
    var loginId = (req.body.login_id || "").trim();
    var loginMethod = (req.body.login_method || "").trim();
    var password = req.body.password || "";
    if (!loginId || !password) return res.status(400).render("login", { error: "Email/mobile and password are required" });
    // Validate format based on method
    var userId = null;
    if (loginMethod === "mobile") {
        var cleaned = loginId.replace(/[\s\-()]/g, "");
        if (!/^\+\d{7,15}$/.test(cleaned)) return res.status(400).render("login", { error: "Invalid mobile number format" });
        var parsed = countryCodes.parseFullNumber(cleaned);
        if (!parsed) return res.status(400).render("login", { error: "Unrecognised country code" });
        var lenCheck = countryCodes.validateMobileLength(parsed.iso, parsed.local);
        if (!lenCheck.valid) return res.status(400).render("login", { error: lenCheck.msg });
        userId = cache.mobileIndex.get(cleaned) || null;
    } else {
        loginId = loginId.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginId)) return res.status(400).render("login", { error: "Invalid email address" });
        userId = cache.emailIndex.get(loginId) || null;
    }
    if (!userId) return res.status(401).render("login", { error: "Invalid credentials" });
    var userData = cache.usersCache[userId];
    if (!userData) return res.status(401).render("login", { error: "Invalid credentials" });
    try {
        var match = await bcrypt.compare(password, userData.passwordHash);
        if (!match) return res.status(401).render("login", { error: "Invalid credentials" });
    } catch (e) { return res.status(500).render("login", { error: "Server error" }); }
    req.session.user = { id: userId, role: userData.role || "user" };
    log.info({ userId: userId }, "User logged in");
    res.redirect("/");
});

// ── Register ─────────────────────────────────────────────────────────────────
router.get("/register", function(req, res) {
    if (req.session && req.session.user && req.session.user.id) return res.redirect("/");
    res.render("register", { error: null });
});

router.post("/register", rateLimitMW.registerLimiter, csrf.verifyCsrf, async function(req, res) {
    var firstName = (req.body.first_name || "").trim();
    var lastName = (req.body.last_name || "").trim();
    var password = req.body.password || "";
    var confirm = req.body.confirm || "";
    var contactType = (req.body.contact_type || "").trim();
    var contactValue = (req.body.contact_value || "").trim();
    if (!firstName) return res.status(400).render("register", { error: "First name is required" });
    if (firstName.length > 50) return res.status(400).render("register", { error: "First name too long (max 50)" });
    if (lastName.length > 50) return res.status(400).render("register", { error: "Last name too long (max 50)" });
    if (!password) return res.status(400).render("register", { error: "Password is required" });
    if (password.length < 6) return res.status(400).render("register", { error: "Password must be at least 6 characters" });
    if (password !== confirm) return res.status(400).render("register", { error: "Passwords do not match" });
    if (contactType !== "email" && contactType !== "mobile") return res.status(400).render("register", { error: "Please choose email or mobile number" });
    if (!contactValue) return res.status(400).render("register", { error: contactType === "email" ? "Email is required" : "Mobile number is required" });
    var email = null;
    var mobile = null;
    if (contactType === "email") {
        contactValue = contactValue.toLowerCase();
        if (contactValue.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue)) return res.status(400).render("register", { error: "Invalid email address" });
        var existingEmail = await db.findUserByEmail(contactValue);
        if (existingEmail) return res.status(409).render("register", { error: "This email is already registered" });
        email = contactValue;
    } else {
        contactValue = contactValue.replace(/[\s\-()]/g, "");
        if (!/^\+\d{7,15}$/.test(contactValue)) return res.status(400).render("register", { error: "Invalid mobile number format (must include country code)" });
        var parsed = countryCodes.parseFullNumber(contactValue);
        if (!parsed) return res.status(400).render("register", { error: "Unrecognised country code" });
        var lenCheck = countryCodes.validateMobileLength(parsed.iso, parsed.local);
        if (!lenCheck.valid) return res.status(400).render("register", { error: lenCheck.msg });
        var existingMobile = await db.findUserByMobile(contactValue);
        if (existingMobile) return res.status(409).render("register", { error: "This mobile number is already registered" });
        mobile = contactValue;
    }
    try {
        var passwordHash = await bcrypt.hash(password, 10);
        var shareCode = generateUniqueShareCode();
        var adminEnv = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.trim().toLowerCase() : "";
        var role = (adminEnv && email && email === adminEnv) ? "admin" : "user";
        var createdAt = Date.now();
        var userId = await db.createUser(firstName, lastName, passwordHash, role, shareCode, createdAt, email, mobile);
        cache.usersCache[userId] = { firstName: firstName, lastName: lastName, passwordHash: passwordHash, role: role, shareCode: shareCode, email: email, mobile: mobile, createdAt: createdAt };
        cache.shareCodes.set(shareCode, userId);
        if (email) cache.emailIndex.set(email, userId);
        if (mobile) cache.mobileIndex.set(mobile, userId);
        req.session.user = { id: userId, role: role };
        log.info({ userId: userId, role: role }, "User registered");
        res.redirect("/");
    } catch (e) {
        log.error({ err: e.message }, "Registration failed");
        return res.status(500).render("register", { error: "Server error" });
    }
});

// ── Logout ───────────────────────────────────────────────────────────────────
router.post("/logout", csrf.verifyCsrf, function(req, res) {
    var userId = req.session && req.session.user ? req.session.user.id : "unknown";
    req.session.destroy(function() {
        log.info({ userId: userId }, "User logged out");
        res.redirect("/login");
    });
});

module.exports = router;
