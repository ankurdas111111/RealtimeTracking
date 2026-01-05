const express = require("express");
const http = require("http");
const path = require("path");
const socketio = require("socket.io");
const crypto = require("crypto");
const session = require("express-session");

const app = express();

const server = http.createServer(app);

const io = socketio(server);

app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: false }));

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
    if (!process.env.SESSION_SECRET) {
        throw new Error("SESSION_SECRET is required in production");
    }
}

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production" ? "auto" : false
    }
});

app.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, "public")));

const activeUsers = new Map();
const offlineUsers = new Map(); // clientId -> { user, expiresAt|null }

function timingSafeEqualStr(a, b) {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
}

function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    return res.redirect("/login");
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === "admin") return next();
    return res.status(403).send("Forbidden");
}

app.get("/login", function(req, res) {
    res.render("login", { error: null });
});

app.post("/login", function(req, res) {
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    const envUser = process.env.ADMIN_USERNAME;
    const envPass = process.env.ADMIN_PASSWORD;
    if (!envUser || !envPass) {
        return res.status(500).render("login", { error: "Admin login is not configured" });
    }
    const okUser = timingSafeEqualStr(username, envUser);
    const okPass = timingSafeEqualStr(password, envPass);
    if (!okUser || !okPass) return res.status(401).render("login", { error: "Invalid username or password" });
    req.session.user = { username: envUser, role: "admin" };
    res.redirect("/admin");
});

app.post("/logout", function(req, res) {
    req.session.destroy(() => res.redirect("/"));
});

app.get("/", function(req, res) {
    res.render("index", { authUser: null });
});

app.get("/admin", requireAuth, requireAdmin, function(req, res) {
    res.render("index", { authUser: req.session.user });
});

app.get("/watch/:token", function(req, res) {
    res.render("watch", { token: req.params.token });
});

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

io.on("connection", (socket) => {
    const sess = socket.request && socket.request.session;
    const authUser = sess && sess.user;
    const clientId = socket.handshake && socket.handshake.auth ? socket.handshake.auth.clientId : null;

    console.log("New client connected:", socket.id);

    const role = authUser && authUser.role ? authUser.role : "user";

    let username = authUser && authUser.username ? authUser.username : ("User-" + Math.floor(Math.random() * 10000));
    let restoredFromOffline = false;

    // Reconnect support: reuse the last known user by clientId (stored in browser localStorage).
    if (clientId && offlineUsers.has(clientId)) {
        const entry = offlineUsers.get(clientId);
        offlineUsers.delete(clientId);
        const user = entry.user;
        const oldSocketId = user.socketId;
        // remove old offline marker
        io.emit("userDisconnect", oldSocketId);
        user.socketId = socket.id;
        user.role = role;
        user.online = true;
        user.retention = user.retention || { mode: "default" };
        user.retention.clientId = clientId;
        username = user.username || username;
        activeUsers.set(socket.id, user);
        restoredFromOffline = true;
    } else {
        activeUsers.set(socket.id, {
            socketId: socket.id,
            username: username,
            role: role,
            latitude: null,
            longitude: null,
            lastUpdate: Date.now(),
            batteryPct: null,
            deviceType: null,
            connectionQuality: null,
            lastMoveAt: Date.now(),
            lastSpeed: 0,
            hardStopAt: null,
            sos: { active: false, at: null, reason: null, type: null, acks: [], token: null, tokenExp: null },
            geofence: { enabled: false, centerLat: null, centerLng: null, radiusM: 0, wasInside: null },
            autoSos: { enabled: false, noMoveMinutes: 5, hardStopMinutes: 2, geofence: false },
            checkIn: { enabled: false, intervalMinutes: 5, overdueMinutes: 7, lastCheckInAt: Date.now() },
            retention: { mode: "default", clientId: clientId || socket.id } // default(24h) | 48h | forever
        });
    }

    socket.emit("existingUsers", [
        ...Array.from(activeUsers.values()).map(u => ({ ...u, online: true })),
        ...Array.from(offlineUsers.values()).map(e => ({ ...e.user, online: false, offlineExpiresAt: e.expiresAt }))
    ]);

    socket.broadcast.emit("userConnected", {
        socketId: socket.id,
        username: username,
        role: role
    });

    if (restoredFromOffline) {
        const user = activeUsers.get(socket.id);
        if (user) io.emit("userUpdate", { ...user, online: true });
    }

    socket.on("position", (data) => {

        const user = activeUsers.get(socket.id);
        
        if (user) {

            user.latitude = data.latitude;
            user.longitude = data.longitude;
            user.speed = data.speed;
            user.lastUpdate = Date.now();
            user.formattedTime = data.formattedTime;
            const s = Number(data.speed || 0);
            const prevSpeed = Number(user.lastSpeed || 0);
            user.lastSpeed = s;
            if (s > 0.8) user.lastMoveAt = Date.now();
            if (prevSpeed > 25 && s < 2) user.hardStopAt = Date.now();

            runAutoRules(user);

            socket.broadcast.emit("userUpdate", { ...user, online: true });
        }
    });

    socket.on("updateUsername", (username) => {

        const user = activeUsers.get(socket.id);
        
        if (user) {

            user.username = username;

            io.emit("userUpdate", { ...user, online: true });
        }
    });

    socket.on("profileUpdate", (profile) => {
        const user = activeUsers.get(socket.id);
        if (!user || !profile) return;
        if (typeof profile.batteryPct === "number") user.batteryPct = profile.batteryPct;
        if (typeof profile.deviceType === "string") user.deviceType = profile.deviceType;
        if (typeof profile.connectionQuality === "string") user.connectionQuality = profile.connectionQuality;
        io.emit("userUpdate", { ...user, online: true });
    });

    socket.on("setGeofence", (cfg) => {
        const actor = activeUsers.get(socket.id);
        if (!actor || !cfg) return;
        if (actor.role !== "admin") return;
        const targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        const user = activeUsers.get(targetSocketId);
        if (!user) return;
        user.geofence.enabled = !!cfg.enabled;
        user.geofence.centerLat = typeof cfg.centerLat === "number" ? cfg.centerLat : user.geofence.centerLat;
        user.geofence.centerLng = typeof cfg.centerLng === "number" ? cfg.centerLng : user.geofence.centerLng;
        user.geofence.radiusM = typeof cfg.radiusM === "number" ? cfg.radiusM : user.geofence.radiusM;
        user.geofence.wasInside = null;
        io.emit("userUpdate", { ...user, online: activeUsers.has(user.socketId) });
    });

    socket.on("setAutoSos", (cfg) => {
        const actor = activeUsers.get(socket.id);
        if (!actor || !cfg) return;
        if (actor.role !== "admin") return;
        const targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        const user = activeUsers.get(targetSocketId);
        if (!user) return;
        user.autoSos.enabled = !!cfg.enabled;
        if (typeof cfg.noMoveMinutes === "number") user.autoSos.noMoveMinutes = cfg.noMoveMinutes;
        if (typeof cfg.hardStopMinutes === "number") user.autoSos.hardStopMinutes = cfg.hardStopMinutes;
        if (typeof cfg.geofence === "boolean") user.autoSos.geofence = cfg.geofence;
        io.emit("userUpdate", { ...user, online: activeUsers.has(user.socketId) });
    });

    socket.on("triggerSOS", (payload) => {
        const user = activeUsers.get(socket.id);
        if (!user) return;
        const reason = payload && typeof payload.reason === "string" ? payload.reason : "SOS";
        setSos(user, true, reason, null, "manual");
        emitSosUpdate(user);
    });

    socket.on("cancelSOS", () => {
        const user = activeUsers.get(socket.id);
        if (!user) return;
        setSos(user, false, null, null, null);
        emitSosUpdate(user);
    });

    socket.on("ackSOS", (payload) => {
        const targetId = payload && typeof payload.socketId === "string" ? payload.socketId : null;
        if (!targetId) return;
        const target = activeUsers.get(targetId);
        const responder = activeUsers.get(socket.id);
        if (!target || !responder) return;
        if (!target.sos.active) return;
        const by = responder.username || responder.socketId;
        if (!Array.isArray(target.sos.acks)) target.sos.acks = [];
        if (!target.sos.acks.some(a => a && a.by === by)) {
            target.sos.acks.push({ by, at: Date.now() });
        }
        emitSosUpdate(target);
    });

    socket.on("checkInAck", () => {
        const user = activeUsers.get(socket.id);
        if (!user) return;
        user.checkIn.lastCheckInAt = Date.now();
        io.emit("checkInUpdate", { socketId: user.socketId, lastCheckInAt: user.checkIn.lastCheckInAt });
    });

    socket.on("setCheckInRules", (cfg) => {
        const actor = activeUsers.get(socket.id);
        if (!actor || !cfg) return;
        if (actor.role !== "admin") return;
        const targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        const user = activeUsers.get(targetSocketId);
        if (!user) return;
        user.checkIn.enabled = !!cfg.enabled;
        if (typeof cfg.intervalMinutes === "number") user.checkIn.intervalMinutes = Math.max(1, cfg.intervalMinutes);
        if (typeof cfg.overdueMinutes === "number") user.checkIn.overdueMinutes = Math.max(1, cfg.overdueMinutes);
        io.emit("userUpdate", { ...user, online: activeUsers.has(user.socketId) });
    });

    socket.on("setRetention", (cfg) => {
        const user = activeUsers.get(socket.id);
        if (!user || !cfg) return;
        const mode = cfg.mode;
        if (mode === "48h" || mode === "default") user.retention.mode = mode;
        io.emit("userUpdate", { ...user, online: true });
    });

    socket.on("setRetentionForever", (cfg) => {
        const actor = activeUsers.get(socket.id);
        if (!actor || actor.role !== "admin" || !cfg) return;
        const targetId = typeof cfg.socketId === "string" ? cfg.socketId : null;
        if (!targetId) return;
        const target = activeUsers.get(targetId) || (() => {
            for (const entry of offlineUsers.values()) {
                if (entry.user && entry.user.socketId === targetId) return entry.user;
            }
            return null;
        })();
        if (!target) return;
        target.retention = target.retention || { mode: "default" };
        target.retention.mode = cfg.forever ? "forever" : (target.retention.mode === "forever" ? "default" : target.retention.mode);
        for (const [cid, entry] of offlineUsers.entries()) {
            if (entry.user && entry.user.socketId === targetId) {
                entry.expiresAt = cfg.forever ? null : Date.now() + 48 * 60 * 60 * 1000;
                offlineUsers.set(cid, entry);
            }
        }
        io.emit("userUpdate", { ...target, online: activeUsers.has(targetId) });
    });

    socket.on("watchJoin", (payload) => {
        const token = payload && typeof payload.token === "string" ? payload.token : null;
        const entry = token ? watchTokens.get(token) : null;
        if (!entry || entry.exp < Date.now()) return;
        socket.join(`watch:${token}`);
        const target = activeUsers.get(entry.socketId);
        if (target) socket.emit("watchInit", { user: target, sos: publicSos(target) });
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);

        const user = activeUsers.get(socket.id);
        activeUsers.delete(socket.id);

        if (!user) {
            io.emit("userDisconnect", socket.id);
            return;
        }

        const mode = user.retention && user.retention.mode ? user.retention.mode : "default";
        const cid = user.retention && user.retention.clientId ? user.retention.clientId : user.socketId;
        // Default retention = 24h, user option = 48h, admin option = forever
        const expiresAt =
            mode === "forever" ? null :
            mode === "48h" ? (Date.now() + 48 * 60 * 60 * 1000) :
            (Date.now() + 24 * 60 * 60 * 1000);

        offlineUsers.set(cid, { user: { ...user }, expiresAt });
        io.emit("userOffline", { ...user, online: false, offlineExpiresAt: expiresAt });
    });
});

// Cleanup expired offline users periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of offlineUsers.entries()) {
        if (entry.expiresAt && entry.expiresAt <= now) {
            offlineUsers.delete(id);
            io.emit("userDisconnect", entry.user.socketId);
        }
    }
}, 60 * 1000);

const watchTokens = new Map();

function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const toRad = (x) => (x * Math.PI) / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

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
    const token = crypto.randomBytes(12).toString("base64url");
    const exp = Date.now() + 60 * 60 * 1000;
    user.sos.active = true;
    user.sos.at = Date.now();
    user.sos.reason = reason || "SOS";
    user.sos.type = type || "manual";
    user.sos.acks = [];
    if (ackBy) user.sos.acks.push({ by: ackBy, at: Date.now() });
    user.sos.token = token;
    user.sos.tokenExp = exp;
    watchTokens.set(token, { socketId: user.socketId, exp });
}

function emitSosUpdate(user) {
    const full = publicSos(user);

    // Geofence breach stays admin/owner only.
    if (full.type === "geofence") {
        io.to(full.socketId).emit("sosUpdate", full);
        for (const u of activeUsers.values()) {
            if (u.role === "admin") io.to(u.socketId).emit("sosUpdate", full);
        }
        return;
    }

    // Broadcast to everyone, but only admins + owner should see the acknowledgement identity list.
    // IMPORTANT: don't send the public payload to admins/owner, otherwise it can overwrite the detailed one in the UI.
    const publicPayload = { ...full, acks: [], ackBy: null };

    for (const u of activeUsers.values()) {
        if (u.socketId === full.socketId || u.role === "admin") continue;
        io.to(u.socketId).emit("sosUpdate", publicPayload);
    }
    // Full details for owner + admins
    io.to(full.socketId).emit("sosUpdate", full);
    for (const u of activeUsers.values()) {
        if (u.role === "admin") io.to(u.socketId).emit("sosUpdate", full);
    }
}

function runAutoRules(user) {
    if (!user) {
        emitWatch(user);
        return;
    }
    const now = Date.now();
    if (user.sos.active) {
        emitWatch(user);
        return;
    }

    // Geofence breach should alert as soon as geofence is enabled (admin-controlled safety boundary).
    if (user.geofence && user.geofence.enabled && typeof user.latitude === "number" && typeof user.longitude === "number") {
        const cLat = user.geofence.centerLat;
        const cLng = user.geofence.centerLng;
        const r = Number(user.geofence.radiusM || 0);
        if (typeof cLat === "number" && typeof cLng === "number" && r > 0) {
            const d = haversineM(user.latitude, user.longitude, cLat, cLng);
            const inside = d <= r;
            if (user.geofence.wasInside === null) user.geofence.wasInside = inside;
            if (user.geofence.wasInside && !inside) {
                setSos(user, true, "Geofence breach", null, "geofence");
                emitSosUpdate(user);
                emitWatch(user);
                return;
            }
            user.geofence.wasInside = inside;
        }
    }

    // Auto SOS rules (opt-in)
    if (user.autoSos && user.autoSos.enabled) {
        if (user.autoSos.noMoveMinutes && now - (user.lastMoveAt || now) > user.autoSos.noMoveMinutes * 60 * 1000) {
            setSos(user, true, `No movement for ${user.autoSos.noMoveMinutes} min`, null, "auto");
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
    io.to(`watch:${user.sos.token}`).emit("watchUpdate", { user, sos: publicSos(user) });
}

setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of watchTokens.entries()) {
        if (entry.exp < now) watchTokens.delete(token);
    }
}, 30 * 1000);

setInterval(() => {
    const now = Date.now();
    for (const user of activeUsers.values()) {
        if (!user.checkIn) user.checkIn = { enabled: false, intervalMinutes: 5, overdueMinutes: 7, lastCheckInAt: now };
        if (!user.checkIn.lastCheckInAt) user.checkIn.lastCheckInAt = now;
        if (!user.checkIn.enabled) continue;

        const intervalMs = user.checkIn.intervalMinutes * 60 * 1000;
        const overdueMs = user.checkIn.overdueMinutes * 60 * 1000;
        const since = now - user.checkIn.lastCheckInAt;

        // Ask user to check in (client shows prompt + vibration)
        if (since >= intervalMs) {
            io.to(user.socketId).emit("checkInRequest", { intervalMinutes: user.checkIn.intervalMinutes, overdueMinutes: user.checkIn.overdueMinutes });
        }

        // If overdue, notify admins (and optionally the user)
        if (since >= overdueMs) {
            const payload = { socketId: user.socketId, username: user.username, lastCheckInAt: user.checkIn.lastCheckInAt, overdueMinutes: user.checkIn.overdueMinutes };
            for (const u of activeUsers.values()) {
                if (u.role === "admin") io.to(u.socketId).emit("checkInMissed", payload);
            }
        }
    }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
