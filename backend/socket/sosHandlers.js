var cache = require("../cache");
var config = require("../config");
var helpers = require("../lib/helpers");
var emitters = require("../services/emitters");
var permissions = require("../services/permissions");
var sos = require("../services/sos");
var visibility = require("../services/visibility");

var log = config.log;
var sanitizeString = helpers.sanitizeString;
var socketRateLimit = helpers.socketRateLimit;

function register(socket, safe) {
    // ─ SOS ─
    socket.on("triggerSOS", safe(function(payload) {
        if (!socketRateLimit(socket, "triggerSOS", 5)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        var reason = payload && typeof payload.reason === "string" ? sanitizeString(payload.reason, 100) : "SOS";
        sos.setSos(user, true, reason, null, "manual");
        sos.emitSosUpdate(user);
        log.warn({ userId: user.userId, reasonLength: reason.length }, "SOS triggered");
    }));

    socket.on("cancelSOS", safe(function() {
        if (!socketRateLimit(socket, "cancelSOS", 5)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        sos.setSos(user, false, null, null, null);
        sos.emitSosUpdate(user);
        log.info({ userId: user.userId }, "SOS cancelled");
    }));

    socket.on("ackSOS", safe(function(payload) {
        if (!socketRateLimit(socket, "ackSOS", 10)) return;
        var targetId = payload && typeof payload.socketId === "string" ? payload.socketId : null;
        if (!targetId) return;
        var target = cache.activeUsers.get(targetId);
        var responder = cache.activeUsers.get(socket.id);
        if (!target || !responder || !target.sos.active) return;
        var by = responder.displayName || responder.socketId;
        if (!Array.isArray(target.sos.acks)) target.sos.acks = [];
        if (!target.sos.acks.some(function(a) { return a && a.by === by; })) {
            target.sos.acks.push({ by: by, at: Date.now() });
        }
        sos.emitSosUpdate(target);
    }));

    // ─ Check-in ─
    socket.on("checkInAck", safe(function() {
        if (!socketRateLimit(socket, "checkInAck", 20)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        user.checkIn.lastCheckInAt = Date.now();
        visibility.emitToVisibleAndSelf(user, "checkInUpdate", { socketId: user.socketId, lastCheckInAt: user.checkIn.lastCheckInAt });
        sos.emitLiveCheckIn(user);
    }));

    socket.on("setCheckInRules", safe(function(cfg) {
        if (!socketRateLimit(socket, "setCheckInRules", 10)) return;
        var actor = cache.activeUsers.get(socket.id);
        if (!actor || !cfg) return;
        var targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        var user = cache.activeUsers.get(targetSocketId);
        if (!user) return;
        if (!permissions.canManage(actor.userId, user.userId)) return;
        user.checkIn.enabled = !!cfg.enabled;
        if (typeof cfg.intervalMinutes === "number") user.checkIn.intervalMinutes = Math.max(1, cfg.intervalMinutes);
        if (typeof cfg.overdueMinutes === "number") user.checkIn.overdueMinutes = Math.max(1, cfg.overdueMinutes);
        visibility.emitToVisibleAndSelf(user, "userUpdate", { ...emitters.sanitizeUser(user), online: cache.activeUsers.has(user.socketId) });
    }));

    // ─ Admin: Geofence ─
    socket.on("setGeofence", safe(function(cfg) {
        if (!socketRateLimit(socket, "setGeofence", 10)) return;
        var actor = cache.activeUsers.get(socket.id);
        if (!actor || !cfg) return;
        var targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        var user = cache.activeUsers.get(targetSocketId);
        if (!user) return;
        if (!permissions.canManage(actor.userId, user.userId)) return;
        user.geofence.enabled = !!cfg.enabled;
        if (typeof cfg.centerLat === "number") user.geofence.centerLat = cfg.centerLat;
        if (typeof cfg.centerLng === "number") user.geofence.centerLng = cfg.centerLng;
        if (typeof cfg.radiusM === "number") user.geofence.radiusM = cfg.radiusM;
        user.geofence.wasInside = null;
        visibility.emitToVisibleAndSelf(user, "userUpdate", { ...emitters.sanitizeUser(user), online: cache.activeUsers.has(user.socketId) });
    }));

    // ─ Admin: Auto-SOS ─
    socket.on("setAutoSos", safe(function(cfg) {
        if (!socketRateLimit(socket, "setAutoSos", 10)) return;
        var actor = cache.activeUsers.get(socket.id);
        if (!actor || !cfg) return;
        var targetSocketId = typeof cfg.socketId === "string" ? cfg.socketId : actor.socketId;
        var user = cache.activeUsers.get(targetSocketId);
        if (!user) return;
        if (!permissions.canManage(actor.userId, user.userId)) return;
        user.autoSos.enabled = !!cfg.enabled;
        if (typeof cfg.noMoveMinutes === "number") user.autoSos.noMoveMinutes = cfg.noMoveMinutes;
        if (typeof cfg.hardStopMinutes === "number") user.autoSos.hardStopMinutes = cfg.hardStopMinutes;
        if (typeof cfg.geofence === "boolean") user.autoSos.geofence = cfg.geofence;
        visibility.emitToVisibleAndSelf(user, "userUpdate", { ...emitters.sanitizeUser(user), online: cache.activeUsers.has(user.socketId) });
    }));
}

module.exports = { register: register };
