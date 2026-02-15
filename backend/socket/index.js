var socketio = require("socket.io");
var cache = require("../cache");
var config = require("../config");
var emitters = require("../services/emitters");
var visibility = require("../services/visibility");
var publicHandlers = require("./publicHandlers");
var authHandlers = require("./authHandlers");
var sosHandlers = require("./sosHandlers");

var log = config.log;

function createSocketServer(server, sessionMiddleware) {
    var io = socketio(server, {
        cors: { origin: false },
        pingTimeout: 20000,
        pingInterval: 25000,
        perMessageDeflate: { threshold: 1024 }
    });

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

        // ── Unauthenticated connections (watch / live pages) ─────────────
        if (!authUser || !authUser.id) {
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
            restoredFromOffline = true;
        } else {
            for (var [sid, u] of cache.activeUsers) {
                if (u.userId === userId && sid !== socket.id) {
                    try { var s = io.sockets.sockets.get(sid); if (s) s.disconnect(true); } catch (_) {}
                    cache.activeUsers.delete(sid);
                    cache.lastVisibleSets.delete(sid);
                    visibility.emitToVisible(u, "userDisconnect", sid);
                    break;
                }
            }
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
        var allUsers = [
            ...Array.from(cache.activeUsers.values()).map(function(u2) { return { ...emitters.sanitizeUser(u2), online: true }; }),
            ...Array.from(cache.offlineUsers.values()).map(function(e) { return { ...emitters.sanitizeUser(e.user), online: false, offlineExpiresAt: e.expiresAt }; })
        ];
        socket.emit("existingUsers", allUsers.filter(function(u2) { return visibility.canSee(userId, u2.userId); }));
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
        emitters.emitMyLiveLinks(socket, userId);

        // Register all authenticated event handlers
        authHandlers.register(socket, safe, userId, role, displayName);
        sosHandlers.register(socket, safe);
    });

    return io;
}

module.exports = { createSocketServer: createSocketServer };
