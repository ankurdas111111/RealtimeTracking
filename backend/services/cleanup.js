var cache = require("../cache");
var config = require("../config");
var db = require("../lib/db");
var visibility = require("./visibility");
var sos = require("./sos");

var log = config.log;

// io reference, set via setIo()
var _io = null;
function setIo(io) { _io = io; }

function startAll() {
    // ── Expire offline users ─────────────────────────────────────────────
    setInterval(function() {
        var now = Date.now();
        for (var [uid, entry] of cache.offlineUsers.entries()) {
            if (entry.expiresAt && entry.expiresAt <= now) {
                cache.offlineUsers.delete(uid);
                for (var [sid, u] of cache.activeUsers) {
                    if (visibility.canSee(u.userId, entry.user.userId)) _io.to(sid).emit("userDisconnect", entry.user.socketId);
                }
            }
        }
    }, 60 * 1000);

    // ── Expire watch tokens ──────────────────────────────────────────────
    setInterval(function() {
        var now = Date.now();
        for (var [token, entry] of cache.watchTokens.entries()) { if (entry.exp < now) cache.watchTokens.delete(token); }
    }, 30 * 1000);

    // ── Expire live tokens ───────────────────────────────────────────────
    setInterval(function() {
        var now = Date.now();
        for (var [token, entry] of cache.liveTokens.entries()) {
            if (entry.expiresAt && entry.expiresAt <= now) {
                cache.liveTokens.delete(token);
                _io.to("live:" + token).emit("liveExpired", { message: "Link expired" });
            }
        }
        db.deleteExpiredLiveTokens().catch(function(e) { log.error({ err: e.message }, "Failed to clean expired live tokens from DB"); });
    }, 60 * 1000);

    // ── Clean empty old rooms ────────────────────────────────────────────
    setInterval(function() {
        var now = Date.now(); var sevenDays = 7 * 24 * 60 * 60 * 1000;
        for (var [code, room] of cache.rooms.entries()) {
            if (room.members.size === 0 && now - room.createdAt > sevenDays) { cache.rooms.delete(code); }
        }
        db.deleteEmptyOldRooms(sevenDays).catch(function(e) { log.error({ err: e.message }, "Failed to clean old empty rooms from DB"); });
    }, 60 * 60 * 1000);

    // ── Check-in overdue polling ─────────────────────────────────────────
    setInterval(function() {
        var now = Date.now();
        for (var user of cache.activeUsers.values()) {
            if (!user.checkIn) user.checkIn = { enabled: false, intervalMinutes: 5, overdueMinutes: 7, lastCheckInAt: now };
            if (!user.checkIn.lastCheckInAt) user.checkIn.lastCheckInAt = now;
            if (!user.checkIn.enabled) continue;
            var intervalMs = user.checkIn.intervalMinutes * 60 * 1000;
            var overdueMs = user.checkIn.overdueMinutes * 60 * 1000;
            var since = now - user.checkIn.lastCheckInAt;
            if (since >= intervalMs) {
                _io.to(user.socketId).emit("checkInRequest", { intervalMinutes: user.checkIn.intervalMinutes, overdueMinutes: user.checkIn.overdueMinutes });
            }
            if (since >= overdueMs) {
                var payload = { socketId: user.socketId, userId: user.userId, displayName: user.displayName, lastCheckInAt: user.checkIn.lastCheckInAt, overdueMinutes: user.checkIn.overdueMinutes };
                for (var u of cache.activeUsers.values()) { if (u.role === "admin") _io.to(u.socketId).emit("checkInMissed", payload); }
                sos.emitLiveCheckIn(user);
            }
        }
    }, 60 * 1000);
}

module.exports = {
    setIo: setIo,
    startAll: startAll
};
