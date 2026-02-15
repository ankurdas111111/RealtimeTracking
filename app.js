var express = require("express");
var http = require("http");
var path = require("path");
var socketio = require("socket.io");
var crypto = require("crypto");
var session = require("express-session");
var pgSession = require("connect-pg-simple")(session);
var bcrypt = require("bcryptjs");
var helmet = require("helmet");
var rateLimit = require("express-rate-limit");
var pino = require("pino");
var helpers = require("./lib/helpers");
var db = require("./lib/db");

var sanitizeString = helpers.sanitizeString;
var validatePosition = helpers.validatePosition;
var haversineM = helpers.haversineM;
var generateCode = helpers.generateCode;
var socketRateLimit = helpers.socketRateLimit;

// ── Structured logger ────────────────────────────────────────────────────────
var log = pino({ level: process.env.LOG_LEVEL || "info" });

var app = express();
var server = http.createServer(app);
var io = socketio(server, {
    cors: { origin: false },
    pingTimeout: 20000,
    pingInterval: 25000,
    perMessageDeflate: { threshold: 1024 }
});

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
            imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
            connectSrc: ["'self'", "ws:", "wss:"],
            fontSrc: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
    if (!process.env.SESSION_SECRET) {
        throw new Error("SESSION_SECRET is required in production");
    }
}

// ── Session store (PostgreSQL via connect-pg-simple) ─────────────────────────
var sessionMiddleware = session({
    store: new pgSession({
        pool: db.getPool(),
        tableName: "session",
        createTableIfMissing: false, // we create it in db.initDb()
        pruneSessionInterval: 15 * 60 // prune expired sessions every 15 min (seconds)
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production" ? "auto" : false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

// ── CSRF protection ─────────────────────────────────────────────────────────
app.use(function(req, res, next) {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("hex");
    res.locals.csrfToken = req.session.csrfToken;
    next();
});

function verifyCsrf(req, res, next) {
    if (req.body._csrf !== req.session.csrfToken) return res.status(403).send("Invalid CSRF token");
    next();
}

// ── Rate limiters ───────────────────────────────────────────────────────────
var loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: "Too many login attempts, try again in 15 minutes" });
var registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: "Too many registrations, try again later" });

// ── In-memory caches (loaded from PostgreSQL at startup) ────────────────────
var usersCache = {};      // username → { passwordHash, role, shareCode, email, mobile, createdAt }
var rooms = new Map();    // code → { name, members: Set, createdBy, createdAt }
var contacts = new Map(); // username → Set<contactUsername>
var shareCodes = new Map();   // shareCode → username
var liveTokens = new Map();   // token → { username, expiresAt, createdAt }

// ── Ephemeral in-memory state ───────────────────────────────────────────────
var watchTokens = new Map();
var activeUsers = new Map();
var offlineUsers = new Map();
var visibilityCache = new Map();

// ── Resource limits ─────────────────────────────────────────────────────────
var MAX_ROOMS_PER_USER = 20;
var MAX_CONTACTS_PER_USER = 50;
var MAX_LIVE_LINKS_PER_USER = 10;
var POSITION_COOLDOWN_MS = 400;

// ── Helpers ─────────────────────────────────────────────────────────────────
function generateUniqueShareCode() { var c; do { c = generateCode(); } while (shareCodes.has(c)); return c; }
function generateUniqueRoomCode() { var c; do { c = generateCode(); } while (rooms.has(c)); return c; }

function maskEmail(email) {
    if (!email) return "";
    var parts = email.split("@");
    if (parts.length !== 2) return "***";
    var local = parts[0];
    var masked = local.length <= 2 ? local[0] + "***" : local.substring(0, 2) + "***";
    return masked + "@" + parts[1];
}

function maskMobile(mobile) {
    if (!mobile) return "";
    if (mobile.length <= 4) return "***" + mobile.slice(-2);
    return "***" + mobile.slice(-4);
}

function getUserRoomCount(username) {
    var count = 0;
    for (var [, room] of rooms) { if (room.members.has(username)) count++; }
    return count;
}

function getUserLiveLinkCount(username) {
    var count = 0;
    for (var [, entry] of liveTokens) { if (entry.username === username) count++; }
    return count;
}

// ── Visibility cache ────────────────────────────────────────────────────────
function invalidateVisibility(username) { visibilityCache.delete(username); }
function invalidateVisibilityAll() { visibilityCache.clear(); }

function getVisibleSet(username) {
    if (visibilityCache.has(username)) return visibilityCache.get(username);
    var visible = new Set([username]);
    for (var [, room] of rooms) {
        if (room.members.has(username)) {
            for (var member of room.members) visible.add(member);
        }
    }
    var userContacts = contacts.get(username);
    if (userContacts) { for (var c of userContacts) visible.add(c); }
    visibilityCache.set(username, visible);
    return visible;
}

function canSee(viewerUsername, targetUsername) {
    if (viewerUsername === targetUsername) return true;
    var viewerData = usersCache[viewerUsername];
    if (viewerData && viewerData.role === "admin") return true;
    return getVisibleSet(viewerUsername).has(targetUsername);
}

function getVisibleSockets(targetUser) {
    var viewers = new Set();
    var targetName = targetUser.username;
    for (var [sid, u] of activeUsers) {
        if (sid === targetUser.socketId) continue;
        if (canSee(u.username, targetName)) viewers.add(sid);
    }
    return viewers;
}

function emitToVisible(targetUser, event, data) {
    for (var sid of getVisibleSockets(targetUser)) { io.to(sid).emit(event, data); }
}

function emitToVisibleAndSelf(targetUser, event, data) {
    io.to(targetUser.socketId).emit(event, data);
    emitToVisible(targetUser, event, data);
}

// ── Visibility refresh (with diff-skip optimisation) ────────────────────────
var lastVisibleSets = new Map();

function sendVisibilityRefresh(socket, user) {
    var allUsers = [
        ...Array.from(activeUsers.values()).map(function(u) { return { ...sanitizeUser(u), online: true }; }),
        ...Array.from(offlineUsers.values()).map(function(e) { return { ...sanitizeUser(e.user), online: false, offlineExpiresAt: e.expiresAt }; })
    ];
    socket.emit("visibilityRefresh", allUsers.filter(function(u) { return canSee(user.username, u.username); }));
}

function sendVisibilityRefreshIfChanged(socket, user) {
    var currentVisible = getVisibleSet(user.username);
    var lastSet = lastVisibleSets.get(socket.id);
    if (lastSet && lastSet.size === currentVisible.size) {
        var changed = false;
        for (var name of currentVisible) {
            if (!lastSet.has(name)) { changed = true; break; }
        }
        if (!changed) return;
    }
    lastVisibleSets.set(socket.id, new Set(currentVisible));
    sendVisibilityRefresh(socket, user);
}

// ── Sanitize user for wire ──────────────────────────────────────────────────
function sanitizeUser(user) {
    return {
        socketId: user.socketId,
        username: user.username,
        role: user.role,
        latitude: user.latitude,
        longitude: user.longitude,
        speed: user.speed,
        lastUpdate: user.lastUpdate,
        formattedTime: user.formattedTime,
        batteryPct: user.batteryPct,
        deviceType: user.deviceType,
        connectionQuality: user.connectionQuality,
        online: user.online,
        sos: user.sos ? { active: !!user.sos.active, at: user.sos.at, reason: user.sos.reason, type: user.sos.type } : { active: false },
        geofence: user.geofence ? { enabled: !!user.geofence.enabled, centerLat: user.geofence.centerLat, centerLng: user.geofence.centerLng, radiusM: user.geofence.radiusM } : { enabled: false },
        autoSos: user.autoSos ? { enabled: !!user.autoSos.enabled, noMoveMinutes: user.autoSos.noMoveMinutes, hardStopMinutes: user.autoSos.hardStopMinutes, geofence: user.autoSos.geofence } : { enabled: false },
        checkIn: user.checkIn ? { enabled: !!user.checkIn.enabled, intervalMinutes: user.checkIn.intervalMinutes, overdueMinutes: user.checkIn.overdueMinutes, lastCheckInAt: user.checkIn.lastCheckInAt } : { enabled: false },
        retention: user.retention ? { mode: user.retention.mode } : { mode: "default" },
        rooms: user.rooms
    };
}

function findActiveUserByUsername(username) {
    for (var u of activeUsers.values()) { if (u.username === username) return u; }
    return null;
}

function findSocketByUsername(username) {
    for (var [sid, u] of activeUsers) { if (u.username === username) return io.sockets.sockets.get(sid) || null; }
    return null;
}

function getUserRooms(username) {
    var result = [];
    for (var [code, room] of rooms) { if (room.members.has(username)) result.push(code); }
    return result;
}

function emitMyRooms(socket, username) {
    var myRooms = [];
    for (var [code, room] of rooms) {
        if (room.members.has(username)) {
            myRooms.push({ code: code, name: room.name, members: Array.from(room.members), createdBy: room.createdBy });
        }
    }
    socket.emit("myRooms", myRooms);
}

function emitMyContacts(socket, username) {
    var myContacts = [];
    var contactSet = contacts.get(username) || new Set();
    for (var contactName of contactSet) {
        var ud = usersCache[contactName];
        myContacts.push({
            username: contactName,
            shareCode: ud ? ud.shareCode : "",
            maskedEmail: ud && ud.email ? maskEmail(ud.email) : "",
            maskedMobile: ud && ud.mobile ? maskMobile(ud.mobile) : ""
        });
    }
    socket.emit("myContacts", myContacts);
}

function emitMyLiveLinks(socket, username) {
    var myLinks = [];
    for (var [token, entry] of liveTokens) {
        if (entry.username === username) {
            myLinks.push({ token: token, expiresAt: entry.expiresAt, createdAt: entry.createdAt });
        }
    }
    socket.emit("myLiveLinks", myLinks);
}

// ── SOS helpers ─────────────────────────────────────────────────────────────
function publicSos(user) {
    return {
        socketId: user.socketId,
        active: !!user.sos.active,
        at: user.sos.at,
        reason: user.sos.reason,
        type: user.sos.type,
        acks: Array.isArray(user.sos.acks) ? user.sos.acks : [],
        ackBy: Array.isArray(user.sos.acks) && user.sos.acks.length ? user.sos.acks[user.sos.acks.length - 1].by : null,
        token: user.sos.token,
        ackCount: Array.isArray(user.sos.acks) ? user.sos.acks.length : 0
    };
}

function setSos(user, active, reason, ackBy, type) {
    if (!active) {
        if (user.sos.token) watchTokens.delete(user.sos.token);
        user.sos = { active: false, at: null, reason: null, type: null, acks: [], token: null, tokenExp: null };
        return;
    }
    var token = crypto.randomBytes(12).toString("base64url");
    var exp = Date.now() + 60 * 60 * 1000;
    user.sos.active = true;
    user.sos.at = Date.now();
    user.sos.reason = reason || "SOS";
    user.sos.type = type || "manual";
    user.sos.acks = [];
    if (ackBy) user.sos.acks.push({ by: ackBy, at: Date.now() });
    user.sos.token = token;
    user.sos.tokenExp = exp;
    watchTokens.set(token, { socketId: user.socketId, username: user.username, exp: exp });
}

function emitSosUpdate(user) {
    var full = publicSos(user);
    if (full.type === "geofence") {
        io.to(full.socketId).emit("sosUpdate", full);
        for (var u of activeUsers.values()) {
            if (u.role === "admin" && u.socketId !== full.socketId) io.to(u.socketId).emit("sosUpdate", full);
        }
        emitLiveSos(user);
        return;
    }
    var publicPayload = { ...full, acks: [], ackBy: null };
    var viewers = getVisibleSockets(user);
    for (var sid of viewers) {
        var viewer = activeUsers.get(sid);
        if (!viewer) continue;
        if (viewer.role === "admin") io.to(sid).emit("sosUpdate", full);
        else io.to(sid).emit("sosUpdate", publicPayload);
    }
    io.to(full.socketId).emit("sosUpdate", full);
    emitLiveSos(user);
}

function emitLiveSos(user) {
    var sosData = {
        active: !!user.sos.active, at: user.sos.at, reason: user.sos.reason, type: user.sos.type,
        ackCount: Array.isArray(user.sos.acks) ? user.sos.acks.length : 0,
        acks: Array.isArray(user.sos.acks) ? user.sos.acks : []
    };
    for (var [token, ent] of liveTokens) {
        if (ent.username === user.username) io.to("live:" + token).emit("liveSosUpdate", sosData);
    }
}

function emitLiveCheckIn(user) {
    var ciData = {
        enabled: !!(user.checkIn && user.checkIn.enabled),
        lastCheckInAt: user.checkIn ? user.checkIn.lastCheckInAt : null,
        intervalMinutes: user.checkIn ? user.checkIn.intervalMinutes : 0,
        overdueMinutes: user.checkIn ? user.checkIn.overdueMinutes : 0
    };
    for (var [token, ent] of liveTokens) {
        if (ent.username === user.username) io.to("live:" + token).emit("liveCheckInUpdate", ciData);
    }
}

function runAutoRules(user) {
    if (!user) { emitWatch(user); return; }
    var now = Date.now();
    if (user.sos.active) { emitWatch(user); return; }
    if (user.geofence && user.geofence.enabled && typeof user.latitude === "number" && typeof user.longitude === "number") {
        var cLat = user.geofence.centerLat, cLng = user.geofence.centerLng, r = Number(user.geofence.radiusM || 0);
        if (typeof cLat === "number" && typeof cLng === "number" && r > 0) {
            var d = haversineM(user.latitude, user.longitude, cLat, cLng);
            var inside = d <= r;
            if (user.geofence.wasInside === null) user.geofence.wasInside = inside;
            if (user.geofence.wasInside && !inside) {
                setSos(user, true, "Geofence breach", null, "geofence");
                emitSosUpdate(user); emitWatch(user); return;
            }
            user.geofence.wasInside = inside;
        }
    }
    if (user.autoSos && user.autoSos.enabled) {
        if (user.autoSos.noMoveMinutes && now - (user.lastMoveAt || now) > user.autoSos.noMoveMinutes * 60 * 1000) {
            setSos(user, true, "No movement for " + user.autoSos.noMoveMinutes + " min", null, "auto");
            emitSosUpdate(user);
        }
        if (user.hardStopAt && user.autoSos.hardStopMinutes && now - user.hardStopAt > user.autoSos.hardStopMinutes * 60 * 1000) {
            if (now - (user.lastMoveAt || now) > user.autoSos.hardStopMinutes * 60 * 1000) {
                setSos(user, true, "Hard stop + no movement", null, "auto");
                emitSosUpdate(user);
            }
            user.hardStopAt = null;
        }
    }
    emitWatch(user);
}

function emitWatch(user) {
    if (!user || !user.sos || !user.sos.active || !user.sos.token) return;
    io.to("watch:" + user.sos.token).emit("watchUpdate", { user: sanitizeUser(user), sos: publicSos(user) });
}

// ── Socket error wrapper ────────────────────────────────────────────────────
function safe(fn) {
    return function(data) {
        try {
            var result = fn.call(this, data);
            if (result && typeof result.catch === "function") {
                result.catch(function(e) { log.error({ err: e.message }, "Socket handler async error"); });
            }
        } catch (e) { log.error({ err: e.message }, "Socket handler error"); }
    };
}

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    return res.redirect("/login");
}
function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === "admin") return next();
    return res.status(403).send("Forbidden");
}

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/health", function(req, res) {
    res.json({ status: "ok", uptime: Math.round(process.uptime()), connections: activeUsers.size, rooms: rooms.size });
});

app.get("/health/db", requireAuth, requireAdmin, async function(req, res) {
    try {
        var result = await db.getTableSizes();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: "Failed to query DB stats" });
    }
});

app.get("/login", function(req, res) {
    if (req.session && req.session.user) return res.redirect("/");
    res.render("login", { error: null });
});

app.post("/login", loginLimiter, verifyCsrf, async function(req, res) {
    var username = (req.body.username || "").trim().toLowerCase();
    var password = req.body.password || "";
    if (!username || !password) return res.status(400).render("login", { error: "Username and password are required" });
    var userData = usersCache[username];
    if (!userData) return res.status(401).render("login", { error: "Invalid username or password" });
    try {
        var match = await bcrypt.compare(password, userData.passwordHash);
        if (!match) return res.status(401).render("login", { error: "Invalid username or password" });
    } catch (e) { return res.status(500).render("login", { error: "Server error" }); }
    req.session.user = { username: username, role: userData.role || "user" };
    log.info({ username: username }, "User logged in");
    res.redirect("/");
});

app.get("/register", function(req, res) {
    if (req.session && req.session.user) return res.redirect("/");
    res.render("register", { error: null });
});

app.post("/register", registerLimiter, verifyCsrf, async function(req, res) {
    var username = (req.body.username || "").trim().toLowerCase();
    var password = req.body.password || "";
    var confirm = req.body.confirm || "";
    var contactType = (req.body.contact_type || "").trim();
    var contactValue = (req.body.contact_value || "").trim();
    if (!username || !password) return res.status(400).render("register", { error: "Username and password are required" });
    if (username.length < 3 || username.length > 20) return res.status(400).render("register", { error: "Username must be 3-20 characters" });
    if (!/^[a-z0-9_]+$/.test(username)) return res.status(400).render("register", { error: "Username: lowercase letters, numbers, underscores only" });
    if (password.length < 8) return res.status(400).render("register", { error: "Password must be at least 8 characters" });
    if (password !== confirm) return res.status(400).render("register", { error: "Passwords do not match" });
    if (contactType !== "email" && contactType !== "mobile") return res.status(400).render("register", { error: "Please choose email or mobile number" });
    if (!contactValue) return res.status(400).render("register", { error: contactType === "email" ? "Email is required" : "Mobile number is required" });
    // Validate and check uniqueness against DB
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
        if (!/^\+?\d{7,15}$/.test(contactValue)) return res.status(400).render("register", { error: "Invalid mobile number (7-15 digits, optional leading +)" });
        var existingMobile = await db.findUserByMobile(contactValue);
        if (existingMobile) return res.status(409).render("register", { error: "This mobile number is already registered" });
        mobile = contactValue;
    }
    if (usersCache[username]) return res.status(409).render("register", { error: "Username already taken" });
    try {
        var passwordHash = await bcrypt.hash(password, 10);
        var shareCode = generateUniqueShareCode();
        var adminEnv = process.env.ADMIN_USERNAME ? process.env.ADMIN_USERNAME.trim().toLowerCase() : "";
        var role = (adminEnv && username === adminEnv) ? "admin" : "user";
        var createdAt = Date.now();
        // Write to PostgreSQL
        await db.createUser(username, passwordHash, role, shareCode, createdAt, email, mobile);
        // Update in-memory cache
        usersCache[username] = { passwordHash: passwordHash, role: role, shareCode: shareCode, email: email, mobile: mobile, createdAt: createdAt };
        shareCodes.set(shareCode, username);
        req.session.user = { username: username, role: role };
        log.info({ username: username, role: role }, "User registered");
        res.redirect("/");
    } catch (e) {
        log.error({ err: e.message }, "Registration failed");
        return res.status(500).render("register", { error: "Server error" });
    }
});

app.post("/logout", verifyCsrf, function(req, res) {
    var username = req.session && req.session.user ? req.session.user.username : "unknown";
    req.session.destroy(function() {
        log.info({ username: username }, "User logged out");
        res.redirect("/login");
    });
});

app.get("/", requireAuth, function(req, res) {
    var ud = usersCache[req.session.user.username] || {};
    res.render("index", { authUser: req.session.user, shareCode: ud.shareCode || "", userEmail: ud.email || "", userMobile: ud.mobile || "" });
});

app.get("/admin", requireAuth, requireAdmin, function(req, res) {
    var ud = usersCache[req.session.user.username] || {};
    res.render("index", { authUser: req.session.user, shareCode: ud.shareCode || "", userEmail: ud.email || "", userMobile: ud.mobile || "" });
});

// ── Admin promote/demote ────────────────────────────────────────────────────
app.post("/admin/promote", requireAuth, requireAdmin, verifyCsrf, async function(req, res) {
    var targetUsername = (req.body.username || "").trim().toLowerCase();
    var newRole = req.body.role === "admin" ? "admin" : "user";
    if (!targetUsername || !usersCache[targetUsername]) return res.status(404).json({ error: "User not found" });
    // Write to PostgreSQL
    await db.updateUserRole(targetUsername, newRole);
    // Update in-memory cache
    usersCache[targetUsername].role = newRole;
    var targetUser = findActiveUserByUsername(targetUsername);
    if (targetUser) targetUser.role = newRole;
    log.info({ targetUsername: targetUsername, newRole: newRole, by: req.session.user.username }, "Role changed");
    res.json({ ok: true, username: targetUsername, role: newRole });
});

app.get("/watch/:token", function(req, res) {
    res.render("watch", { token: req.params.token });
});

app.get("/live/:token", async function(req, res) {
    var entry = liveTokens.get(req.params.token);
    if (!entry) return res.status(404).render("live", { token: req.params.token, sharedBy: "", expired: true });
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        liveTokens.delete(req.params.token);
        db.deleteLiveToken(req.params.token).catch(function(e) { log.error({ err: e.message }, "Failed to delete expired live token"); });
        return res.status(410).render("live", { token: req.params.token, sharedBy: entry.username, expired: true });
    }
    res.render("live", { token: req.params.token, sharedBy: entry.username, expired: false });
});

// ── Socket.IO ───────────────────────────────────────────────────────────────
io.use(function(socket, next) { sessionMiddleware(socket.request, {}, next); });

var lastPositionAt = new Map();

io.on("connection", function(socket) {
    var sess = socket.request && socket.request.session;
    var authUser = sess && sess.user;
    var clientId = socket.handshake && socket.handshake.auth ? socket.handshake.auth.clientId : null;

    // ── Unauthenticated connections (watch / live pages) ─────────────────
    if (!authUser || !authUser.username) {
        socket.on("watchJoin", safe(function(payload) {
            if (!socketRateLimit(socket, "watchJoin", 10)) return;
            var token = payload && typeof payload.token === "string" ? payload.token : null;
            var entry = token ? watchTokens.get(token) : null;
            if (!entry || entry.exp < Date.now()) return;
            socket.join("watch:" + token);
            var target = entry.socketId ? activeUsers.get(entry.socketId) : findActiveUserByUsername(entry.username || "");
            if (target) socket.emit("watchInit", { user: sanitizeUser(target), sos: publicSos(target) });
        }));
        socket.on("liveJoin", safe(function(payload) {
            if (!socketRateLimit(socket, "liveJoin", 10)) return;
            var token = payload && typeof payload.token === "string" ? payload.token : null;
            var viewerName = payload && typeof payload.viewerName === "string" ? sanitizeString(payload.viewerName, 30) : "Viewer";
            var entry = token ? liveTokens.get(token) : null;
            if (!entry) return;
            if (entry.expiresAt && entry.expiresAt <= Date.now()) return;
            socket.join("live:" + token);
            socket._liveToken = token;
            socket._liveViewerName = viewerName || "Viewer";
            var target = findActiveUserByUsername(entry.username);
            var initData = { user: target ? sanitizeUser(target) : null };
            if (target) {
                initData.sos = { active: !!target.sos.active, at: target.sos.at, reason: target.sos.reason, type: target.sos.type, ackCount: Array.isArray(target.sos.acks) ? target.sos.acks.length : 0, acks: target.sos.acks || [] };
                initData.checkIn = { enabled: !!(target.checkIn && target.checkIn.enabled), lastCheckInAt: target.checkIn ? target.checkIn.lastCheckInAt : null, intervalMinutes: target.checkIn ? target.checkIn.intervalMinutes : 0, overdueMinutes: target.checkIn ? target.checkIn.overdueMinutes : 0 };
            }
            socket.emit("liveInit", initData);
        }));
        socket.on("liveAckSOS", safe(function(_payload) {
            if (!socketRateLimit(socket, "liveAckSOS", 10)) return;
            var token = socket._liveToken;
            var viewerName = socket._liveViewerName || "Viewer";
            if (!token) return;
            var entry = liveTokens.get(token);
            if (!entry) return;
            var target = findActiveUserByUsername(entry.username);
            if (!target || !target.sos.active) return;
            if (!Array.isArray(target.sos.acks)) target.sos.acks = [];
            var by = viewerName + " (via link)";
            if (!target.sos.acks.some(function(a) { return a && a.by === by; })) {
                target.sos.acks.push({ by: by, at: Date.now() });
            }
            emitSosUpdate(target);
        }));
        return;
    }

    // ── Authenticated connections ────────────────────────────────────────
    var username = authUser.username;
    var role = authUser.role || "user";
    var restoredFromOffline = false;

    log.info({ username: username, socketId: socket.id }, "User connected");

    if (offlineUsers.has(username)) {
        var entry = offlineUsers.get(username);
        offlineUsers.delete(username);
        var user = entry.user;
        var oldSocketId = user.socketId;
        emitToVisible(user, "userDisconnect", oldSocketId);
        user.socketId = socket.id;
        user.role = role;
        user.online = true;
        user.rooms = getUserRooms(username);
        activeUsers.set(socket.id, user);
        restoredFromOffline = true;
    } else {
        for (var [sid, u] of activeUsers) {
            if (u.username === username && sid !== socket.id) {
                try { var s = io.sockets.sockets.get(sid); if (s) s.disconnect(true); } catch (_) {}
                activeUsers.delete(sid);
                lastVisibleSets.delete(sid);
                emitToVisible(u, "userDisconnect", sid);
                break;
            }
        }
        activeUsers.set(socket.id, {
            socketId: socket.id, username: username, role: role,
            latitude: null, longitude: null, lastUpdate: Date.now(),
            batteryPct: null, deviceType: null, connectionQuality: null,
            lastMoveAt: Date.now(), lastSpeed: 0, hardStopAt: null, speed: 0, formattedTime: "",
            sos: { active: false, at: null, reason: null, type: null, acks: [], token: null, tokenExp: null },
            geofence: { enabled: false, centerLat: null, centerLng: null, radiusM: 0, wasInside: null },
            autoSos: { enabled: false, noMoveMinutes: 5, hardStopMinutes: 2, geofence: false },
            checkIn: { enabled: false, intervalMinutes: 5, overdueMinutes: 7, lastCheckInAt: Date.now() },
            retention: { mode: "default", clientId: clientId || socket.id },
            rooms: getUserRooms(username)
        });
    }

    var me = activeUsers.get(socket.id);
    var allUsers = [
        ...Array.from(activeUsers.values()).map(function(u) { return { ...sanitizeUser(u), online: true }; }),
        ...Array.from(offlineUsers.values()).map(function(e) { return { ...sanitizeUser(e.user), online: false, offlineExpiresAt: e.expiresAt }; })
    ];
    socket.emit("existingUsers", allUsers.filter(function(u) { return canSee(username, u.username); }));
    emitToVisible(me, "userConnected", { socketId: socket.id, username: username, role: role });
    if (restoredFromOffline) emitToVisibleAndSelf(me, "userUpdate", { ...sanitizeUser(me), online: true });

    var ud = usersCache[username] || {};
    socket.emit("myShareCode", {
        shareCode: ud.shareCode || "",
        email: ud.email || "",
        mobile: ud.mobile || ""
    });
    emitMyRooms(socket, username);
    emitMyContacts(socket, username);
    emitMyLiveLinks(socket, username);

    // ─ Position (throttled + validated + rate limited) ─
    socket.on("position", safe(function(data) {
        var now = Date.now();
        if (now - (lastPositionAt.get(socket.id) || 0) < POSITION_COOLDOWN_MS) return;
        if (!socketRateLimit(socket, "position", 180)) return;
        lastPositionAt.set(socket.id, now);
        var pos = validatePosition(data);
        if (!pos) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        user.latitude = pos.latitude;
        user.longitude = pos.longitude;
        user.speed = pos.speed;
        user.lastUpdate = now;
        user.formattedTime = pos.formattedTime;
        var prevSpeed = Number(user.lastSpeed || 0);
        user.lastSpeed = pos.speed;
        if (pos.speed > 0.8) user.lastMoveAt = now;
        if (prevSpeed > 25 && pos.speed < 2) user.hardStopAt = now;
        runAutoRules(user);
        emitToVisible(user, "userUpdate", { ...sanitizeUser(user), online: true });
        for (var [token, ent] of liveTokens) {
            if (ent.username === user.username) io.to("live:" + token).emit("liveUpdate", { user: sanitizeUser(user) });
        }
    }));

    // ─ Profile (validated + rate limited) ─
    socket.on("profileUpdate", safe(function(profile) {
        if (!socketRateLimit(socket, "profileUpdate", 20)) return;
        var user = activeUsers.get(socket.id);
        if (!user || !profile) return;
        if (typeof profile.batteryPct === "number" && profile.batteryPct >= 0 && profile.batteryPct <= 100) user.batteryPct = Math.round(profile.batteryPct);
        if (typeof profile.deviceType === "string") user.deviceType = sanitizeString(profile.deviceType, 20);
        if (typeof profile.connectionQuality === "string") user.connectionQuality = sanitizeString(profile.connectionQuality, 20);
        emitToVisibleAndSelf(user, "userUpdate", { ...sanitizeUser(user), online: true });
    }));

    // ─ Admin: Geofence ─
    socket.on("setGeofence", safe(function(cfg) {
        if (!socketRateLimit(socket, "setGeofence", 10)) return;
        var actor = activeUsers.get(socket.id);
        if (!actor || !cfg || actor.role !== "admin") return;
        var targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        var user = activeUsers.get(targetSocketId);
        if (!user) return;
        user.geofence.enabled = !!cfg.enabled;
        if (typeof cfg.centerLat === "number") user.geofence.centerLat = cfg.centerLat;
        if (typeof cfg.centerLng === "number") user.geofence.centerLng = cfg.centerLng;
        if (typeof cfg.radiusM === "number") user.geofence.radiusM = cfg.radiusM;
        user.geofence.wasInside = null;
        emitToVisibleAndSelf(user, "userUpdate", { ...sanitizeUser(user), online: activeUsers.has(user.socketId) });
    }));

    // ─ Admin: Auto-SOS ─
    socket.on("setAutoSos", safe(function(cfg) {
        if (!socketRateLimit(socket, "setAutoSos", 10)) return;
        var actor = activeUsers.get(socket.id);
        if (!actor || !cfg || actor.role !== "admin") return;
        var targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        var user = activeUsers.get(targetSocketId);
        if (!user) return;
        user.autoSos.enabled = !!cfg.enabled;
        if (typeof cfg.noMoveMinutes === "number") user.autoSos.noMoveMinutes = cfg.noMoveMinutes;
        if (typeof cfg.hardStopMinutes === "number") user.autoSos.hardStopMinutes = cfg.hardStopMinutes;
        if (typeof cfg.geofence === "boolean") user.autoSos.geofence = cfg.geofence;
        emitToVisibleAndSelf(user, "userUpdate", { ...sanitizeUser(user), online: activeUsers.has(user.socketId) });
    }));

    // ─ SOS ─
    socket.on("triggerSOS", safe(function(payload) {
        if (!socketRateLimit(socket, "triggerSOS", 5)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        var reason = payload && typeof payload.reason === "string" ? sanitizeString(payload.reason, 100) : "SOS";
        setSos(user, true, reason, null, "manual");
        emitSosUpdate(user);
        log.warn({ username: user.username, reason: reason }, "SOS triggered");
    }));

    socket.on("cancelSOS", safe(function() {
        if (!socketRateLimit(socket, "cancelSOS", 5)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        setSos(user, false, null, null, null);
        emitSosUpdate(user);
        log.info({ username: user.username }, "SOS cancelled");
    }));

    socket.on("ackSOS", safe(function(payload) {
        if (!socketRateLimit(socket, "ackSOS", 10)) return;
        var targetId = payload && typeof payload.socketId === "string" ? payload.socketId : null;
        if (!targetId) return;
        var target = activeUsers.get(targetId);
        var responder = activeUsers.get(socket.id);
        if (!target || !responder || !target.sos.active) return;
        var by = responder.username || responder.socketId;
        if (!Array.isArray(target.sos.acks)) target.sos.acks = [];
        if (!target.sos.acks.some(function(a) { return a && a.by === by; })) {
            target.sos.acks.push({ by: by, at: Date.now() });
        }
        emitSosUpdate(target);
    }));

    // ─ Check-in ─
    socket.on("checkInAck", safe(function() {
        if (!socketRateLimit(socket, "checkInAck", 20)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        user.checkIn.lastCheckInAt = Date.now();
        emitToVisibleAndSelf(user, "checkInUpdate", { socketId: user.socketId, lastCheckInAt: user.checkIn.lastCheckInAt });
        emitLiveCheckIn(user);
    }));

    socket.on("setCheckInRules", safe(function(cfg) {
        if (!socketRateLimit(socket, "setCheckInRules", 10)) return;
        var actor = activeUsers.get(socket.id);
        if (!actor || !cfg || actor.role !== "admin") return;
        var targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        var user = activeUsers.get(targetSocketId);
        if (!user) return;
        user.checkIn.enabled = !!cfg.enabled;
        if (typeof cfg.intervalMinutes === "number") user.checkIn.intervalMinutes = Math.max(1, cfg.intervalMinutes);
        if (typeof cfg.overdueMinutes === "number") user.checkIn.overdueMinutes = Math.max(1, cfg.overdueMinutes);
        emitToVisibleAndSelf(user, "userUpdate", { ...sanitizeUser(user), online: activeUsers.has(user.socketId) });
    }));

    // ─ Retention ─
    socket.on("setRetention", safe(function(cfg) {
        if (!socketRateLimit(socket, "setRetention", 10)) return;
        var user = activeUsers.get(socket.id);
        if (!user || !cfg) return;
        if (cfg.mode === "48h" || cfg.mode === "default") user.retention.mode = cfg.mode;
        emitToVisibleAndSelf(user, "userUpdate", { ...sanitizeUser(user), online: true });
    }));

    socket.on("setRetentionForever", safe(function(cfg) {
        if (!socketRateLimit(socket, "setRetentionForever", 10)) return;
        var actor = activeUsers.get(socket.id);
        if (!actor || actor.role !== "admin" || !cfg) return;
        var targetId = typeof cfg.socketId === "string" ? cfg.socketId : null;
        if (!targetId) return;
        var target = activeUsers.get(targetId);
        if (!target) {
            for (var [, ent] of offlineUsers) { if (ent.user && ent.user.socketId === targetId) { target = ent.user; break; } }
        }
        if (!target) return;
        target.retention = target.retention || { mode: "default" };
        target.retention.mode = cfg.forever ? "forever" : (target.retention.mode === "forever" ? "default" : target.retention.mode);
        for (var [uname, ent2] of offlineUsers.entries()) {
            if (ent2.user && ent2.user.socketId === targetId) {
                ent2.expiresAt = cfg.forever ? null : Date.now() + 48 * 60 * 60 * 1000;
                offlineUsers.set(uname, ent2);
            }
        }
        emitToVisibleAndSelf(target, "userUpdate", { ...sanitizeUser(target), online: activeUsers.has(targetId) });
    }));

    // ─ Admin delete ─
    socket.on("adminDeleteUser", safe(function(payload) {
        if (!socketRateLimit(socket, "adminDeleteUser", 5)) return;
        var actor = activeUsers.get(socket.id);
        if (!actor || actor.role !== "admin" || !payload) return;
        var targetId = typeof payload.socketId === "string" ? payload.socketId : null;
        if (!targetId) return;
        var targetUser = activeUsers.get(targetId);
        if (targetUser) {
            targetUser.forceDelete = true;
            offlineUsers.delete(targetUser.username);
            try { var s2 = io.sockets.sockets.get(targetId); if (s2) s2.disconnect(true); } catch (_) {}
            activeUsers.delete(targetId);
            lastVisibleSets.delete(targetId);
            for (var [sid2, u2] of activeUsers) { if (canSee(u2.username, targetUser.username)) io.to(sid2).emit("userDisconnect", targetId); }
            log.info({ targetUsername: targetUser.username, by: actor.username }, "Admin deleted user");
            return;
        }
        for (var [uname2, ent3] of offlineUsers.entries()) {
            if (ent3 && ent3.user && ent3.user.socketId === targetId) {
                offlineUsers.delete(uname2);
                for (var [sid3, u3] of activeUsers) { if (canSee(u3.username, ent3.user.username)) io.to(sid3).emit("userDisconnect", targetId); }
                log.info({ targetUsername: uname2, by: actor.username }, "Admin deleted offline user");
                break;
            }
        }
    }));

    // ─ Rooms (with limits + rate limiting) ─
    socket.on("createRoom", safe(function(payload) {
        if (!socketRateLimit(socket, "createRoom", 10)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        if (getUserRoomCount(user.username) >= MAX_ROOMS_PER_USER) { socket.emit("roomError", { message: "Room limit reached (" + MAX_ROOMS_PER_USER + ")" }); return; }
        var name = (payload && typeof payload.name === "string") ? sanitizeString(payload.name, 50) : "";
        var code = generateUniqueRoomCode();
        var roomName = name || ("Room " + code);
        var createdAt = Date.now();
        // Update in-memory
        rooms.set(code, { name: roomName, members: new Set([user.username]), createdBy: user.username, createdAt: createdAt });
        user.rooms = getUserRooms(user.username);
        invalidateVisibility(user.username);
        // Write to PostgreSQL (fire-and-forget with error logging)
        db.createRoom(code, roomName, user.username, createdAt)
            .then(function() { return db.addRoomMember(code, user.username); })
            .catch(function(e) { log.error({ err: e.message }, "Failed to persist room creation"); });
        socket.emit("roomCreated", { code: code, name: roomName });
        emitMyRooms(socket, user.username);
    }));

    socket.on("joinRoom", safe(function(payload) {
        if (!socketRateLimit(socket, "joinRoom", 10)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        var code = (payload && typeof payload.code === "string") ? payload.code.trim().toUpperCase() : "";
        if (!code || !rooms.has(code)) { socket.emit("roomError", { message: "Room not found" }); return; }
        var room = rooms.get(code);
        if (room.members.has(user.username)) { socket.emit("roomError", { message: "Already in this room" }); return; }
        room.members.add(user.username);
        user.rooms = getUserRooms(user.username);
        invalidateVisibilityAll();
        db.addRoomMember(code, user.username).catch(function(e) { log.error({ err: e.message }, "Failed to persist room join"); });
        socket.emit("roomJoined", { code: code, name: room.name, members: Array.from(room.members) });
        emitMyRooms(socket, user.username);
        sendVisibilityRefreshIfChanged(socket, user);
        for (var memberName of room.members) {
            if (memberName === user.username) continue;
            var ms = findSocketByUsername(memberName);
            if (ms) { var mu = activeUsers.get(ms.id); if (mu) sendVisibilityRefreshIfChanged(ms, mu); }
        }
    }));

    socket.on("leaveRoom", safe(function(payload) {
        if (!socketRateLimit(socket, "leaveRoom", 10)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        var code = (payload && typeof payload.code === "string") ? payload.code.trim().toUpperCase() : "";
        if (!code || !rooms.has(code)) return;
        var room = rooms.get(code);
        var membersCopy = Array.from(room.members);
        room.members.delete(user.username);
        user.rooms = getUserRooms(user.username);
        var roomDeleted = room.members.size === 0;
        if (roomDeleted) rooms.delete(code);
        invalidateVisibilityAll();
        // Write to PostgreSQL
        db.removeRoomMember(code, user.username)
            .then(function() { if (roomDeleted) return db.deleteRoom(code); })
            .catch(function(e) { log.error({ err: e.message }, "Failed to persist room leave"); });
        socket.emit("roomLeft", { code: code });
        emitMyRooms(socket, user.username);
        sendVisibilityRefreshIfChanged(socket, user);
        for (var mn of membersCopy) {
            if (mn === user.username) continue;
            var ms2 = findSocketByUsername(mn);
            if (ms2) { var mu2 = activeUsers.get(ms2.id); if (mu2) sendVisibilityRefreshIfChanged(ms2, mu2); }
        }
    }));

    // ─ Contacts (with limits + rate limiting) ─
    socket.on("addContact", safe(async function(payload) {
        if (!socketRateLimit(socket, "addContact", 10)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        var myContacts = contacts.get(user.username) || new Set();
        if (myContacts.size >= MAX_CONTACTS_PER_USER) { socket.emit("contactError", { message: "Contact limit reached (" + MAX_CONTACTS_PER_USER + ")" }); return; }
        var targetUsername = null;
        // Method 1: by share code (in-memory lookup)
        var code = (payload && typeof payload.shareCode === "string") ? payload.shareCode.trim().toUpperCase() : "";
        // Method 2: by email or mobile (DB lookup)
        var contactValue = (payload && typeof payload.contactValue === "string") ? payload.contactValue.trim().toLowerCase() : "";
        if (code) {
            if (!shareCodes.has(code)) { socket.emit("contactError", { message: "Share code not found" }); return; }
            targetUsername = shareCodes.get(code);
        } else if (contactValue) {
            targetUsername = await db.findUserByContact(contactValue);
            if (!targetUsername) { socket.emit("contactError", { message: "No user found with that email or mobile" }); return; }
        } else {
            socket.emit("contactError", { message: "Enter a share code, email, or mobile number" }); return;
        }
        if (targetUsername === user.username) { socket.emit("contactError", { message: "That is your own account" }); return; }
        if (!contacts.has(user.username)) contacts.set(user.username, new Set());
        var mc = contacts.get(user.username);
        if (mc.has(targetUsername)) { socket.emit("contactError", { message: "Already in your contacts" }); return; }
        mc.add(targetUsername);
        invalidateVisibility(user.username);
        db.addContact(user.username, targetUsername).catch(function(e) { log.error({ err: e.message }, "Failed to persist contact add"); });
        socket.emit("contactAdded", { username: targetUsername });
        emitMyContacts(socket, user.username);
        sendVisibilityRefreshIfChanged(socket, user);
    }));

    socket.on("removeContact", safe(function(payload) {
        if (!socketRateLimit(socket, "removeContact", 10)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        var targetUsername = (payload && typeof payload.username === "string") ? payload.username.trim().toLowerCase() : "";
        if (!targetUsername) return;
        var mc = contacts.get(user.username);
        if (!mc || !mc.has(targetUsername)) return;
        mc.delete(targetUsername);
        invalidateVisibility(user.username);
        db.removeContact(user.username, targetUsername).catch(function(e) { log.error({ err: e.message }, "Failed to persist contact remove"); });
        socket.emit("contactRemoved", { username: targetUsername });
        emitMyContacts(socket, user.username);
        sendVisibilityRefreshIfChanged(socket, user);
    }));

    // ─ Live Links (with limits + rate limiting) ─
    socket.on("createLiveLink", safe(function(payload) {
        if (!socketRateLimit(socket, "createLiveLink", 10)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        if (getUserLiveLinkCount(user.username) >= MAX_LIVE_LINKS_PER_USER) { socket.emit("roomError", { message: "Live link limit reached (" + MAX_LIVE_LINKS_PER_USER + ")" }); return; }
        var duration = payload && typeof payload.duration === "string" ? payload.duration : null;
        var expiresAt = null;
        if (duration === "1h") expiresAt = Date.now() + 1 * 60 * 60 * 1000;
        else if (duration === "6h") expiresAt = Date.now() + 6 * 60 * 60 * 1000;
        else if (duration === "24h") expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        var token = crypto.randomBytes(16).toString("base64url");
        var createdAt = Date.now();
        liveTokens.set(token, { username: user.username, expiresAt: expiresAt, createdAt: createdAt });
        db.createLiveToken(token, user.username, expiresAt, createdAt).catch(function(e) { log.error({ err: e.message }, "Failed to persist live token"); });
        socket.emit("liveLinkCreated", { token: token, expiresAt: expiresAt });
        emitMyLiveLinks(socket, user.username);
    }));

    socket.on("revokeLiveLink", safe(function(payload) {
        if (!socketRateLimit(socket, "revokeLiveLink", 10)) return;
        var user = activeUsers.get(socket.id);
        if (!user) return;
        var token = (payload && typeof payload.token === "string") ? payload.token : "";
        var ent = liveTokens.get(token);
        if (!ent || ent.username !== user.username) return;
        liveTokens.delete(token);
        db.deleteLiveToken(token).catch(function(e) { log.error({ err: e.message }, "Failed to persist live token revoke"); });
        io.to("live:" + token).emit("liveExpired", { message: "Link revoked" });
        socket.emit("liveLinkRevoked", { token: token });
        emitMyLiveLinks(socket, user.username);
    }));

    // ─ Watch / Live join (for authenticated users too) ─
    socket.on("watchJoin", safe(function(payload) {
        if (!socketRateLimit(socket, "watchJoin", 10)) return;
        var token = payload && typeof payload.token === "string" ? payload.token : null;
        var ent = token ? watchTokens.get(token) : null;
        if (!ent || ent.exp < Date.now()) return;
        socket.join("watch:" + token);
        var target = activeUsers.get(ent.socketId);
        if (target) socket.emit("watchInit", { user: sanitizeUser(target), sos: publicSos(target) });
    }));

    socket.on("liveJoin", safe(function(payload) {
        if (!socketRateLimit(socket, "liveJoin", 10)) return;
        var token = payload && typeof payload.token === "string" ? payload.token : null;
        var ent = token ? liveTokens.get(token) : null;
        if (!ent) return;
        if (ent.expiresAt && ent.expiresAt <= Date.now()) return;
        socket.join("live:" + token);
        var target = findActiveUserByUsername(ent.username);
        if (target) socket.emit("liveInit", { user: sanitizeUser(target) });
    }));

    // ─ Disconnect ─
    socket.on("disconnect", function() {
        log.info({ username: username, socketId: socket.id }, "User disconnected");
        lastPositionAt.delete(socket.id);
        lastVisibleSets.delete(socket.id);
        var user = activeUsers.get(socket.id);
        activeUsers.delete(socket.id);
        if (!user) return;
        var mode = user.retention && user.retention.mode ? user.retention.mode : "default";
        if (user.forceDelete) {
            offlineUsers.delete(user.username);
            emitToVisible(user, "userDisconnect", user.socketId);
            return;
        }
        var expiresAt = mode === "forever" ? null : mode === "48h" ? (Date.now() + 48 * 60 * 60 * 1000) : (Date.now() + 24 * 60 * 60 * 1000);
        offlineUsers.set(user.username, { user: { ...user }, expiresAt: expiresAt });
        emitToVisible(user, "userOffline", { ...sanitizeUser(user), online: false, offlineExpiresAt: expiresAt });
    });
});

// ── Cleanup intervals ───────────────────────────────────────────────────────
setInterval(function() {
    var now = Date.now();
    for (var [uname, entry] of offlineUsers.entries()) {
        if (entry.expiresAt && entry.expiresAt <= now) {
            offlineUsers.delete(uname);
            for (var [sid, u] of activeUsers) {
                if (canSee(u.username, entry.user.username)) io.to(sid).emit("userDisconnect", entry.user.socketId);
            }
        }
    }
}, 60 * 1000);

setInterval(function() {
    var now = Date.now();
    for (var [token, entry] of watchTokens.entries()) { if (entry.exp < now) watchTokens.delete(token); }
}, 30 * 1000);

setInterval(function() {
    var now = Date.now();
    for (var [token, entry] of liveTokens.entries()) {
        if (entry.expiresAt && entry.expiresAt <= now) {
            liveTokens.delete(token);
            io.to("live:" + token).emit("liveExpired", { message: "Link expired" });
        }
    }
    // Also clean DB
    db.deleteExpiredLiveTokens().catch(function(e) { log.error({ err: e.message }, "Failed to clean expired live tokens from DB"); });
}, 60 * 1000);

setInterval(function() {
    var now = Date.now(); var sevenDays = 7 * 24 * 60 * 60 * 1000;
    for (var [code, room] of rooms.entries()) {
        if (room.members.size === 0 && now - room.createdAt > sevenDays) { rooms.delete(code); }
    }
    db.deleteEmptyOldRooms(sevenDays).catch(function(e) { log.error({ err: e.message }, "Failed to clean old empty rooms from DB"); });
}, 60 * 60 * 1000);

setInterval(function() {
    var now = Date.now();
    for (var user of activeUsers.values()) {
        if (!user.checkIn) user.checkIn = { enabled: false, intervalMinutes: 5, overdueMinutes: 7, lastCheckInAt: now };
        if (!user.checkIn.lastCheckInAt) user.checkIn.lastCheckInAt = now;
        if (!user.checkIn.enabled) continue;
        var intervalMs = user.checkIn.intervalMinutes * 60 * 1000;
        var overdueMs = user.checkIn.overdueMinutes * 60 * 1000;
        var since = now - user.checkIn.lastCheckInAt;
        if (since >= intervalMs) {
            io.to(user.socketId).emit("checkInRequest", { intervalMinutes: user.checkIn.intervalMinutes, overdueMinutes: user.checkIn.overdueMinutes });
        }
        if (since >= overdueMs) {
            var payload = { socketId: user.socketId, username: user.username, lastCheckInAt: user.checkIn.lastCheckInAt, overdueMinutes: user.checkIn.overdueMinutes };
            for (var u of activeUsers.values()) { if (u.role === "admin") io.to(u.socketId).emit("checkInMissed", payload); }
            emitLiveCheckIn(user);
        }
    }
}, 60 * 1000);

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
        usersCache = data.usersCache;
        shareCodes = data.shareCodes;
        rooms = data.rooms;
        contacts = data.contacts;
        liveTokens = data.liveTokens;
        log.info({
            users: Object.keys(usersCache).length,
            rooms: rooms.size,
            contacts: contacts.size,
            liveTokens: liveTokens.size
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
}

if (process.env.NODE_ENV !== "test") {
    start();
}

// ── Exports for testing ─────────────────────────────────────────────────────
module.exports = { app: app, server: server, io: io, start: start };
