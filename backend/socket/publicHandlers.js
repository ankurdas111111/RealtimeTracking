var cache = require("../cache");
var helpers = require("../lib/helpers");
var emitters = require("../services/emitters");
var sos = require("../services/sos");

var sanitizeString = helpers.sanitizeString;
var socketRateLimit = helpers.socketRateLimit;

function register(socket, safe) {
    socket.on("watchJoin", safe(function(payload) {
        if (!socketRateLimit(socket, "watchJoin", 10)) return;
        var token = payload && typeof payload.token === "string" ? payload.token : null;
        var entry = token ? cache.watchTokens.get(token) : null;
        if (!entry || entry.exp < Date.now()) return;
        socket.join("watch:" + token);
        var target = entry.socketId ? cache.activeUsers.get(entry.socketId) : emitters.findActiveUserByUserId(entry.userId || "");
        if (target) socket.emit("watchInit", { user: emitters.sanitizeUser(target), sos: sos.publicSos(target) });
    }));

    socket.on("liveJoin", safe(function(payload) {
        if (!socketRateLimit(socket, "liveJoin", 10)) return;
        var token = payload && typeof payload.token === "string" ? payload.token : null;
        var viewerName = payload && typeof payload.viewerName === "string" ? sanitizeString(payload.viewerName, 30) : "Viewer";
        var entry = token ? cache.liveTokens.get(token) : null;
        if (!entry) return;
        if (entry.expiresAt && entry.expiresAt <= Date.now()) return;
        socket.join("live:" + token);
        socket._liveToken = token;
        socket._liveViewerName = viewerName || "Viewer";
        var target = emitters.findActiveUserByUserId(entry.userId);
        var initData = { user: target ? emitters.sanitizeUser(target) : null };
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
        var entry = cache.liveTokens.get(token);
        if (!entry) return;
        var target = emitters.findActiveUserByUserId(entry.userId);
        if (!target || !target.sos.active) return;
        if (!Array.isArray(target.sos.acks)) target.sos.acks = [];
        var by = viewerName + " (via link)";
        if (!target.sos.acks.some(function(a) { return a && a.by === by; })) {
            target.sos.acks.push({ by: by, at: Date.now() });
        }
        sos.emitSosUpdate(target);
    }));
}

module.exports = { register: register };
