var socketio = require("socket.io");
var msgpackParser = require("socket.io-msgpack-parser");
var cache = require("../cache");
var config = require("../config");
var emitters = require("../services/emitters");
var visibility = require("../services/visibility");
var publicHandlers = require("./publicHandlers");
var authHandlers = require("./authHandlers");
var sosHandlers = require("./sosHandlers");
var cors = require("../lib/cors");

var log = config.log;

function createSocketServer(server, sessionMiddleware) {
    var io = socketio(server, {
        cors: { origin: Array.from(cors.allowedOrigins), credentials: true },
        pingTimeout: 20000,
        pingInterval: 25000,
        perMessageDeflate: { threshold: 1024 },
        transports: ["websocket"],
        parser: msgpackParser
    });

    // ── Redis adapter (optional, enabled via REDIS_URL env var) ──────────
    var redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        try {
            var { createAdapter } = require("@socket.io/redis-adapter");
            var { Redis } = require("ioredis");
            var pubClient = new Redis(redisUrl);
            var subClient = pubClient.duplicate();
            io.adapter(createAdapter(pubClient, subClient));
            log.info("Socket.io Redis adapter enabled");
        } catch (err) {
            log.warn({ err: err.message }, "Redis adapter not available, falling back to in-memory");
        }
    }

    // Share io reference with services that need it
    visibility.setIo(io);
    emitters.setIo(io);
    var sosSvc = require("../services/sos");
    sosSvc.setIo(io);
    authHandlers.setIo(io);
    var cleanup = require("../services/cleanup");
    cleanup.setIo(io);

    // Session middleware for socket connections
    io.use(function(socket, next) { sessionMiddleware(socket.request, {}, next); });

    io.on("connection", function(socket) {
        var sess = socket.request && socket.request.session;
        var authUser = sess && sess.user;
        var clientId = socket.handshake && socket.handshake.auth ? socket.handshake.auth.clientId : null;

        // ── Socket error wrapper ─────────────────────────────────────────
        function safe(fn, eventName) {
            return function(data) {
                try {
                    var result = fn.call(this, data);
                    if (result && typeof result.catch === "function") {
                        result.catch(function(e) { log.error({ err: e.message, event: eventName || "unknown", userId: userId || null }, "Socket handler async error"); });
                    }
                } catch (e) { log.error({ err: e.message, event: eventName || "unknown", userId: userId || null }, "Socket handler error"); }
            };
        }

        // ── Unauthenticated or viewer connections (watch / live pages) ────
        var isViewer = socket.handshake && socket.handshake.auth && socket.handshake.auth.viewer;
        if (!authUser || !authUser.id) {
            if (isViewer) {
                publicHandlers.register(socket, safe);
                return;
            }
            // Session expired for an authenticated client — disconnect with error
            socket.emit("connect_error", { message: "Session expired" });
            socket.disconnect(true);
            return;
        }
        if (isViewer) {
            publicHandlers.register(socket, safe);
            return;
        }

        // ── Authenticated connections ────────────────────────────────────
        var userId = authUser.id;
        var role = authUser.role || "user";
        var displayName = emitters.getDisplayName(userId);
        var restoredFromOffline = false;

        log.info({ userId: userId, socketId: socket.id }, "User connected");

        if (cache.offlineUsers.has(userId)) {
            var entry = cache.offlineUsers.get(userId);
            cache.offlineUsers.delete(userId);
            var user = entry.user;
            var oldSocketId = user.socketId;
            visibility.emitToVisible(user, "userDisconnect", oldSocketId);
            user.socketId = socket.id;
            user.role = role;
            user.displayName = displayName;
            user.online = true;
            user.rooms = emitters.getUserRooms(userId);
            cache.activeUsers.set(socket.id, user);
            cache.userIdToSocketId.set(userId, socket.id);
            restoredFromOffline = true;
        } else {
            // Evict previous socket for same userId (O(1) via index)
            var prevSid = cache.userIdToSocketId.get(userId);
            if (prevSid && prevSid !== socket.id) {
                var prevUser = cache.activeUsers.get(prevSid);
                try { var s = io.sockets.sockets.get(prevSid); if (s) s.disconnect(true); } catch (_) {}
                cache.activeUsers.delete(prevSid);
                cache.lastVisibleSets.delete(prevSid);
                if (prevUser) visibility.emitToVisible(prevUser, "userDisconnect", prevSid);
            }
            cache.userIdToSocketId.set(userId, socket.id);
            cache.activeUsers.set(socket.id, {
                socketId: socket.id, userId: userId, displayName: displayName, role: role,
                latitude: null, longitude: null, lastUpdate: Date.now(),
                batteryPct: null, deviceType: null, connectionQuality: null,
                lastMoveAt: Date.now(), lastSpeed: 0, hardStopAt: null, speed: 0, formattedTime: "",
                sos: { active: false, at: null, reason: null, type: null, acks: [], token: null, tokenExp: null },
                geofence: { enabled: false, centerLat: null, centerLng: null, radiusM: 0, wasInside: null },
                autoSos: { enabled: false, noMoveMinutes: 5, hardStopMinutes: 2, geofence: false },
                checkIn: { enabled: false, intervalMinutes: 5, overdueMinutes: 7, lastCheckInAt: Date.now() },
                retention: { mode: "default", clientId: clientId || socket.id },
                rooms: emitters.getUserRooms(userId)
            });
        }

        var me = cache.activeUsers.get(socket.id);
        // Optimised: get visible set first, then only sanitize visible users
        var visibleSet = visibility.getVisibleSet(userId);
        var existingUsers = [];
        var seenUserIds = new Set();
        for (var [, u2] of cache.activeUsers) {
            if (visibleSet.has(u2.userId)) {
                existingUsers.push({ ...emitters.sanitizeUser(u2), online: true });
                seenUserIds.add(u2.userId);
            }
        }
        for (var [, offEntry] of cache.offlineUsers) {
            if (visibleSet.has(offEntry.user.userId) && !seenUserIds.has(offEntry.user.userId)) {
                existingUsers.push({ ...emitters.sanitizeUser(offEntry.user), online: false, offlineExpiresAt: offEntry.expiresAt });
                seenUserIds.add(offEntry.user.userId);
            }
        }
        // Add stored-position users only if visible and not already seen
        var ucKeys = Object.keys(cache.usersCache);
        for (var k = 0; k < ucKeys.length; k++) {
            var uid = ucKeys[k];
            if (seenUserIds.has(uid) || !visibleSet.has(uid)) continue;
            var uc = cache.usersCache[uid];
            if (uc.lastLatitude != null && uc.lastLongitude != null) {
                existingUsers.push({
                    socketId: "stored-" + uid,
                    userId: uid,
                    displayName: emitters.getDisplayName(uid),
                    role: uc.role || "user",
                    latitude: uc.lastLatitude,
                    longitude: uc.lastLongitude,
                    speed: uc.lastSpeed || "0",
                    lastUpdate: uc.lastUpdate || 0,
                    formattedTime: "",
                    batteryPct: null,
                    deviceType: null,
                    connectionQuality: null,
                    sos: { active: false },
                    online: false
                });
            }
        }
        socket.emit("existingUsers", existingUsers);
        visibility.emitToVisible(me, "userConnected", { socketId: socket.id, userId: userId, displayName: displayName, role: role });
        if (restoredFromOffline) visibility.emitToVisibleAndSelf(me, "userUpdate", { ...emitters.sanitizeUser(me), online: true });

        var ud = cache.usersCache[userId] || {};
        socket.emit("myShareCode", {
            shareCode: ud.shareCode || "",
            email: ud.email || "",
            mobile: ud.mobile || ""
        });
        emitters.emitMyRooms(socket, userId);
        emitters.emitMyContacts(socket, userId);
        emitters.emitMyGuardians(socket, userId);
        emitters.emitMyLiveLinks(socket, userId);
        emitters.emitPendingRequests(socket, userId);

        // Register all authenticated event handlers
        authHandlers.register(socket, safe, userId, role, displayName);
        sosHandlers.register(socket, safe);
    });

    return io;
}

module.exports = { createSocketServer: createSocketServer };
