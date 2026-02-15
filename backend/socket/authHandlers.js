var crypto = require("crypto");
var cache = require("../cache");
var config = require("../config");
var db = require("../lib/db");
var helpers = require("../lib/helpers");
var emitters = require("../services/emitters");
var sos = require("../services/sos");
var visibility = require("../services/visibility");

var log = config.log;
var sanitizeString = helpers.sanitizeString;
var validatePosition = helpers.validatePosition;
var socketRateLimit = helpers.socketRateLimit;
var generateCode = helpers.generateCode;

var POSITION_COOLDOWN_MS = config.POSITION_COOLDOWN_MS;
var MAX_ROOMS_PER_USER = config.MAX_ROOMS_PER_USER;
var MAX_CONTACTS_PER_USER = config.MAX_CONTACTS_PER_USER;
var MAX_LIVE_LINKS_PER_USER = config.MAX_LIVE_LINKS_PER_USER;

// io reference, set via setIo()
var _io = null;
function setIo(io) { _io = io; }

function generateUniqueRoomCode() { var c; do { c = generateCode(); } while (cache.rooms.has(c)); return c; }

function register(socket, safe, userId, role, displayName) {
    // ─ Position (throttled + validated + rate limited) ─
    socket.on("position", safe(function(data) {
        var now = Date.now();
        if (now - (cache.lastPositionAt.get(socket.id) || 0) < POSITION_COOLDOWN_MS) return;
        if (!socketRateLimit(socket, "position", 180)) return;
        cache.lastPositionAt.set(socket.id, now);
        var pos = validatePosition(data);
        if (!pos) return;
        var user = cache.activeUsers.get(socket.id);
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
        sos.runAutoRules(user);
        visibility.emitToVisible(user, "userUpdate", { ...emitters.sanitizeUser(user), online: true });
        for (var [token, ent] of cache.liveTokens) {
            if (ent.userId === user.userId) _io.to("live:" + token).emit("liveUpdate", { user: emitters.sanitizeUser(user) });
        }
    }));

    // ─ Profile (validated + rate limited) ─
    socket.on("profileUpdate", safe(function(profile) {
        if (!socketRateLimit(socket, "profileUpdate", 20)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user || !profile) return;
        if (typeof profile.batteryPct === "number" && profile.batteryPct >= 0 && profile.batteryPct <= 100) user.batteryPct = Math.round(profile.batteryPct);
        if (typeof profile.deviceType === "string") user.deviceType = sanitizeString(profile.deviceType, 20);
        if (typeof profile.connectionQuality === "string") user.connectionQuality = sanitizeString(profile.connectionQuality, 20);
        visibility.emitToVisibleAndSelf(user, "userUpdate", { ...emitters.sanitizeUser(user), online: true });
    }));

    // ─ Retention ─
    socket.on("setRetention", safe(function(cfg) {
        if (!socketRateLimit(socket, "setRetention", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user || !cfg) return;
        if (cfg.mode === "48h" || cfg.mode === "default") user.retention.mode = cfg.mode;
        visibility.emitToVisibleAndSelf(user, "userUpdate", { ...emitters.sanitizeUser(user), online: true });
    }));

    socket.on("setRetentionForever", safe(function(cfg) {
        if (!socketRateLimit(socket, "setRetentionForever", 10)) return;
        var actor = cache.activeUsers.get(socket.id);
        if (!actor || actor.role !== "admin" || !cfg) return;
        var targetId = typeof cfg.socketId === "string" ? cfg.socketId : null;
        if (!targetId) return;
        var target = cache.activeUsers.get(targetId);
        if (!target) {
            for (var [, ent] of cache.offlineUsers) { if (ent.user && ent.user.socketId === targetId) { target = ent.user; break; } }
        }
        if (!target) return;
        target.retention = target.retention || { mode: "default" };
        target.retention.mode = cfg.forever ? "forever" : (target.retention.mode === "forever" ? "default" : target.retention.mode);
        for (var [uid, ent2] of cache.offlineUsers.entries()) {
            if (ent2.user && ent2.user.socketId === targetId) {
                ent2.expiresAt = cfg.forever ? null : Date.now() + 48 * 60 * 60 * 1000;
                cache.offlineUsers.set(uid, ent2);
            }
        }
        visibility.emitToVisibleAndSelf(target, "userUpdate", { ...emitters.sanitizeUser(target), online: cache.activeUsers.has(targetId) });
    }));

    // ─ Admin delete ─
    socket.on("adminDeleteUser", safe(function(payload) {
        if (!socketRateLimit(socket, "adminDeleteUser", 5)) return;
        var actor = cache.activeUsers.get(socket.id);
        if (!actor || actor.role !== "admin" || !payload) return;
        var targetId = typeof payload.socketId === "string" ? payload.socketId : null;
        if (!targetId) return;
        var targetUser = cache.activeUsers.get(targetId);
        if (targetUser) {
            targetUser.forceDelete = true;
            cache.offlineUsers.delete(targetUser.userId);
            try { var s2 = _io.sockets.sockets.get(targetId); if (s2) s2.disconnect(true); } catch (_) {}
            cache.activeUsers.delete(targetId);
            cache.lastVisibleSets.delete(targetId);
            for (var [sid2, u2] of cache.activeUsers) { if (visibility.canSee(u2.userId, targetUser.userId)) _io.to(sid2).emit("userDisconnect", targetId); }
            log.info({ targetUserId: targetUser.userId, by: actor.userId }, "Admin deleted user");
            return;
        }
        for (var [uid2, ent3] of cache.offlineUsers.entries()) {
            if (ent3 && ent3.user && ent3.user.socketId === targetId) {
                cache.offlineUsers.delete(uid2);
                for (var [sid3, u3] of cache.activeUsers) { if (visibility.canSee(u3.userId, ent3.user.userId)) _io.to(sid3).emit("userDisconnect", targetId); }
                log.info({ targetUserId: uid2, by: actor.userId }, "Admin deleted offline user");
                break;
            }
        }
    }));

    // ─ Rooms (with limits + rate limiting) ─
    socket.on("createRoom", safe(function(payload) {
        if (!socketRateLimit(socket, "createRoom", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        if (emitters.getUserRoomCount(user.userId) >= MAX_ROOMS_PER_USER) { socket.emit("roomError", { message: "Room limit reached (" + MAX_ROOMS_PER_USER + ")" }); return; }
        var name = (payload && typeof payload.name === "string") ? sanitizeString(payload.name, 50) : "";
        var code = generateUniqueRoomCode();
        var roomName = name || ("Room " + code);
        var createdAt = Date.now();
        db.createRoom(code, roomName, user.userId, createdAt)
            .then(function(roomDbId) {
                cache.rooms.set(code, { dbId: roomDbId, name: roomName, members: new Set([user.userId]), createdBy: user.userId, createdAt: createdAt });
                user.rooms = emitters.getUserRooms(user.userId);
                visibility.invalidateVisibility(user.userId);
                return db.addRoomMember(roomDbId, user.userId);
            })
            .then(function() {
                socket.emit("roomCreated", { code: code, name: roomName });
                emitters.emitMyRooms(socket, user.userId);
            })
            .catch(function(e) { log.error({ err: e.message }, "Failed to persist room creation"); });
    }));

    socket.on("joinRoom", safe(function(payload) {
        if (!socketRateLimit(socket, "joinRoom", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        var code = (payload && typeof payload.code === "string") ? payload.code.trim().toUpperCase() : "";
        if (!code || !cache.rooms.has(code)) { socket.emit("roomError", { message: "Room not found" }); return; }
        var room = cache.rooms.get(code);
        if (room.members.has(user.userId)) { socket.emit("roomError", { message: "Already in this room" }); return; }
        room.members.add(user.userId);
        user.rooms = emitters.getUserRooms(user.userId);
        visibility.invalidateVisibilityAll();
        db.addRoomMember(room.dbId, user.userId).catch(function(e) { log.error({ err: e.message }, "Failed to persist room join"); });
        var membersList = [];
        for (var mid of room.members) { membersList.push({ userId: mid, displayName: emitters.getDisplayName(mid) }); }
        socket.emit("roomJoined", { code: code, name: room.name, members: membersList });
        emitters.emitMyRooms(socket, user.userId);
        visibility.sendVisibilityRefreshIfChanged(socket, user);
        for (var memberId of room.members) {
            if (memberId === user.userId) continue;
            var ms = emitters.findSocketByUserId(memberId);
            if (ms) { var mu = cache.activeUsers.get(ms.id); if (mu) visibility.sendVisibilityRefreshIfChanged(ms, mu); }
        }
    }));

    socket.on("leaveRoom", safe(function(payload) {
        if (!socketRateLimit(socket, "leaveRoom", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        var code = (payload && typeof payload.code === "string") ? payload.code.trim().toUpperCase() : "";
        if (!code || !cache.rooms.has(code)) return;
        var room = cache.rooms.get(code);
        var membersCopy = Array.from(room.members);
        room.members.delete(user.userId);
        user.rooms = emitters.getUserRooms(user.userId);
        var roomDeleted = room.members.size === 0;
        var roomDbId = room.dbId;
        if (roomDeleted) cache.rooms.delete(code);
        visibility.invalidateVisibilityAll();
        db.removeRoomMember(roomDbId, user.userId)
            .then(function() { if (roomDeleted) return db.deleteRoom(roomDbId); })
            .catch(function(e) { log.error({ err: e.message }, "Failed to persist room leave"); });
        socket.emit("roomLeft", { code: code });
        emitters.emitMyRooms(socket, user.userId);
        visibility.sendVisibilityRefreshIfChanged(socket, user);
        for (var mn of membersCopy) {
            if (mn === user.userId) continue;
            var ms2 = emitters.findSocketByUserId(mn);
            if (ms2) { var mu2 = cache.activeUsers.get(ms2.id); if (mu2) visibility.sendVisibilityRefreshIfChanged(ms2, mu2); }
        }
    }));

    // ─ Contacts (with limits + rate limiting) ─
    socket.on("addContact", safe(async function(payload) {
        if (!socketRateLimit(socket, "addContact", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        var myContacts = cache.contacts.get(user.userId) || new Set();
        if (myContacts.size >= MAX_CONTACTS_PER_USER) { socket.emit("contactError", { message: "Contact limit reached (" + MAX_CONTACTS_PER_USER + ")" }); return; }
        var targetUserId = null;
        var code = (payload && typeof payload.shareCode === "string") ? payload.shareCode.trim().toUpperCase() : "";
        var contactValue = (payload && typeof payload.contactValue === "string") ? payload.contactValue.trim().toLowerCase() : "";
        if (code) {
            if (!cache.shareCodes.has(code)) { socket.emit("contactError", { message: "Share code not found" }); return; }
            targetUserId = cache.shareCodes.get(code);
        } else if (contactValue) {
            targetUserId = await db.findUserByContact(contactValue);
            if (!targetUserId) { socket.emit("contactError", { message: "No user found with that email or mobile" }); return; }
        } else {
            socket.emit("contactError", { message: "Enter a share code, email, or mobile number" }); return;
        }
        if (targetUserId === user.userId) { socket.emit("contactError", { message: "That is your own account" }); return; }
        if (!cache.contacts.has(user.userId)) cache.contacts.set(user.userId, new Set());
        var mc = cache.contacts.get(user.userId);
        if (mc.has(targetUserId)) { socket.emit("contactError", { message: "Already in your contacts" }); return; }
        mc.add(targetUserId);
        visibility.invalidateVisibility(user.userId);
        visibility.invalidateVisibility(targetUserId);
        db.addContact(user.userId, targetUserId).catch(function(e) { log.error({ err: e.message }, "Failed to persist contact add"); });
        socket.emit("contactAdded", { userId: targetUserId, displayName: emitters.getDisplayName(targetUserId) });
        emitters.emitMyContacts(socket, user.userId);
        visibility.sendVisibilityRefreshIfChanged(socket, user);
        // Notify the target user — they can now see us (reverse contact visibility)
        var targetSocket = emitters.findSocketByUserId(targetUserId);
        if (targetSocket) {
            var targetUser = cache.activeUsers.get(targetSocket.id);
            if (targetUser) visibility.sendVisibilityRefreshIfChanged(targetSocket, targetUser);
        }
    }));

    socket.on("removeContact", safe(function(payload) {
        if (!socketRateLimit(socket, "removeContact", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        var targetUserId = (payload && typeof payload.userId === "string") ? payload.userId.trim() : "";
        if (!targetUserId) return;
        var mc = cache.contacts.get(user.userId);
        if (!mc || !mc.has(targetUserId)) return;
        mc.delete(targetUserId);
        visibility.invalidateVisibility(user.userId);
        visibility.invalidateVisibility(targetUserId);
        db.removeContact(user.userId, targetUserId).catch(function(e) { log.error({ err: e.message }, "Failed to persist contact remove"); });
        socket.emit("contactRemoved", { userId: targetUserId });
        emitters.emitMyContacts(socket, user.userId);
        visibility.sendVisibilityRefreshIfChanged(socket, user);
        // Notify the target user — they can no longer see us
        var targetSocket2 = emitters.findSocketByUserId(targetUserId);
        if (targetSocket2) {
            var targetUser2 = cache.activeUsers.get(targetSocket2.id);
            if (targetUser2) visibility.sendVisibilityRefreshIfChanged(targetSocket2, targetUser2);
        }
    }));

    // ─ Live Links (with limits + rate limiting) ─
    socket.on("createLiveLink", safe(function(payload) {
        if (!socketRateLimit(socket, "createLiveLink", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        if (emitters.getUserLiveLinkCount(user.userId) >= MAX_LIVE_LINKS_PER_USER) { socket.emit("roomError", { message: "Live link limit reached (" + MAX_LIVE_LINKS_PER_USER + ")" }); return; }
        var duration = payload && typeof payload.duration === "string" ? payload.duration : null;
        var expiresAt = null;
        if (duration === "1h") expiresAt = Date.now() + 1 * 60 * 60 * 1000;
        else if (duration === "6h") expiresAt = Date.now() + 6 * 60 * 60 * 1000;
        else if (duration === "24h") expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        var token = crypto.randomBytes(16).toString("base64url");
        var createdAt = Date.now();
        cache.liveTokens.set(token, { userId: user.userId, expiresAt: expiresAt, createdAt: createdAt });
        db.createLiveToken(token, user.userId, expiresAt, createdAt).catch(function(e) { log.error({ err: e.message }, "Failed to persist live token"); });
        socket.emit("liveLinkCreated", { token: token, expiresAt: expiresAt });
        emitters.emitMyLiveLinks(socket, user.userId);
    }));

    socket.on("revokeLiveLink", safe(function(payload) {
        if (!socketRateLimit(socket, "revokeLiveLink", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        var token = (payload && typeof payload.token === "string") ? payload.token : "";
        var ent = cache.liveTokens.get(token);
        if (!ent || ent.userId !== user.userId) return;
        cache.liveTokens.delete(token);
        db.deleteLiveToken(token).catch(function(e) { log.error({ err: e.message }, "Failed to persist live token revoke"); });
        _io.to("live:" + token).emit("liveExpired", { message: "Link revoked" });
        socket.emit("liveLinkRevoked", { token: token });
        emitters.emitMyLiveLinks(socket, user.userId);
    }));

    // ─ Watch / Live join (for authenticated users too) ─
    socket.on("watchJoin", safe(function(payload) {
        if (!socketRateLimit(socket, "watchJoin", 10)) return;
        var token = payload && typeof payload.token === "string" ? payload.token : null;
        var ent = token ? cache.watchTokens.get(token) : null;
        if (!ent || ent.exp < Date.now()) return;
        socket.join("watch:" + token);
        var target = cache.activeUsers.get(ent.socketId);
        if (target) socket.emit("watchInit", { user: emitters.sanitizeUser(target), sos: sos.publicSos(target) });
    }));

    socket.on("liveJoin", safe(function(payload) {
        if (!socketRateLimit(socket, "liveJoin", 10)) return;
        var token = payload && typeof payload.token === "string" ? payload.token : null;
        var ent = token ? cache.liveTokens.get(token) : null;
        if (!ent) return;
        if (ent.expiresAt && ent.expiresAt <= Date.now()) return;
        socket.join("live:" + token);
        var target = emitters.findActiveUserByUserId(ent.userId);
        if (target) socket.emit("liveInit", { user: emitters.sanitizeUser(target) });
    }));

    // ─ Disconnect ─
    socket.on("disconnect", function() {
        log.info({ userId: userId, socketId: socket.id }, "User disconnected");
        cache.lastPositionAt.delete(socket.id);
        cache.lastVisibleSets.delete(socket.id);
        var user = cache.activeUsers.get(socket.id);
        cache.activeUsers.delete(socket.id);
        if (!user) return;
        var mode = user.retention && user.retention.mode ? user.retention.mode : "default";
        if (user.forceDelete) {
            cache.offlineUsers.delete(user.userId);
            visibility.emitToVisible(user, "userDisconnect", user.socketId);
            return;
        }
        var expiresAt = mode === "forever" ? null : mode === "48h" ? (Date.now() + 48 * 60 * 60 * 1000) : (Date.now() + 24 * 60 * 60 * 1000);
        cache.offlineUsers.set(user.userId, { user: { ...user }, expiresAt: expiresAt });
        visibility.emitToVisible(user, "userOffline", { ...emitters.sanitizeUser(user), online: false, offlineExpiresAt: expiresAt });
    });
}

module.exports = {
    setIo: setIo,
    register: register
};
