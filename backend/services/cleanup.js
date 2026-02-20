var cache = require("../cache");
var config = require("../config");
var db = require("../lib/db");
var emitters = require("./emitters");
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
        for (var [token, entry] of cache.watchTokens.entries()) {
            if (entry.exp < now) {
                _io.to("watch:" + token).emit("watchUpdate", { user: null, sos: { active: false } });
                cache.watchTokens.delete(token);
            }
        }
    }, 30 * 1000);

    // ── Expire live tokens ───────────────────────────────────────────────
    setInterval(function() {
        var now = Date.now();
        for (var [token, entry] of cache.liveTokens.entries()) {
            if (entry.expiresAt && entry.expiresAt <= now) {
                cache.liveTokens.delete(token);
                // Maintain liveTokensByUser index
                var userSet = cache.liveTokensByUser.get(entry.userId);
                if (userSet) { userSet.delete(token); if (userSet.size === 0) cache.liveTokensByUser.delete(entry.userId); }
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

    // ── Expire time-limited room admins ─────────────────────────────────
    setInterval(function() {
        var now = Date.now();
        // In-memory expiry
        for (var [code, roleMap] of cache.roomMemberRoles) {
            for (var [uid, entry] of roleMap) {
                if (entry.role === "admin" && entry.expiresAt && entry.expiresAt <= now) {
                    entry.role = "member";
                    entry.expiresAt = null;
                    var room = cache.rooms.get(code);
                    if (room) {
                        for (var mid of room.members) {
                            var ms = emitters.findSocketByUserId(mid);
                            if (ms) ms.emit("roomAdminUpdated", { roomCode: code, userId: uid, role: "member", expiresAt: null });
                        }
                    }
                }
            }
        }
        db.expireRoomAdmins(now).catch(function(e) { log.error({ err: e.message }, "Failed to expire room admins in DB"); });
    }, 60 * 1000);

    // ── Expire time-limited guardianships ─────────────────────────────────
    setInterval(function() {
        var now = Date.now();
        for (var [gId, wardMap] of cache.guardianships) {
            for (var [wId, entry] of wardMap) {
                if (entry.status === "active" && entry.expiresAt && entry.expiresAt <= now) {
                    wardMap.delete(wId);
                    var updatePayload = { guardianId: gId, wardId: wId, status: "expired", expiresAt: null };
                    var gs = emitters.findSocketByUserId(gId);
                    if (gs) gs.emit("guardianUpdated", updatePayload);
                    var ws = emitters.findSocketByUserId(wId);
                    if (ws) ws.emit("guardianUpdated", updatePayload);
                }
            }
        }
        db.expireGuardianships(now).catch(function(e) { log.error({ err: e.message }, "Failed to expire guardianships in DB"); });
    }, 60 * 1000);

    // ── Check-in overdue polling ─────────────────────────────────────────
    setInterval(function() {
        var now = Date.now();
        var permissions = require("./permissions");
        // Pre-build manageable map once per tick: managerUserId → Set<wardUserId>
        // This avoids calling canManage() for every (user, user) pair (O(n^2) → O(n))
        var manageableMap = new Map();
        for (var u of cache.activeUsers.values()) {
            manageableMap.set(u.userId, permissions.getManageableUsers(u.userId));
        }
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
                var missedPayload = { socketId: user.socketId, userId: user.userId, displayName: user.displayName, lastCheckInAt: user.checkIn.lastCheckInAt, overdueMinutes: user.checkIn.overdueMinutes };
                for (var mgr of cache.activeUsers.values()) {
                    if (mgr.userId !== user.userId) {
                        var mgrSet = manageableMap.get(mgr.userId);
                        if (mgrSet && mgrSet.has(user.userId)) {
                            _io.to(mgr.socketId).emit("checkInMissed", missedPayload);
                        }
                    }
                }
                sos.emitLiveCheckIn(user);
            }
        }
    }, 60 * 1000);
}

module.exports = {
    setIo: setIo,
    startAll: startAll
};
