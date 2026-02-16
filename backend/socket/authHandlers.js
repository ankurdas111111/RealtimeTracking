var crypto = require("crypto");
var cache = require("../cache");
var config = require("../config");
var db = require("../lib/db");
var helpers = require("../lib/helpers");
var emitters = require("../services/emitters");
var sos = require("../services/sos");
var visibility = require("../services/visibility");

var permissions = require("../services/permissions");

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

function parseExpiresIn(expiresIn) {
    if (expiresIn === "1h") return Date.now() + 1 * 60 * 60 * 1000;
    if (expiresIn === "6h") return Date.now() + 6 * 60 * 60 * 1000;
    if (expiresIn === "24h") return Date.now() + 24 * 60 * 60 * 1000;
    if (expiresIn === "48h") return Date.now() + 48 * 60 * 60 * 1000;
    if (expiresIn === "7d") return Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (expiresIn === "30d") return Date.now() + 30 * 24 * 60 * 60 * 1000;
    return null; // permanent
}

function register(socket, safe, userId, role, displayName) {
    // ─ Position (throttled + validated + rate limited) ─
    socket.on("position", safe(function(data) {
        var now = Date.now();
        if (now - (cache.lastPositionAt.get(socket.id) || 0) < POSITION_COOLDOWN_MS) return;
        if (!socketRateLimit(socket, "position", 360)) return;
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
        user.accuracy = pos.accuracy;
        user.clientTimestamp = pos.timestamp;
        var prevSpeed = Number(user.lastSpeed || 0);
        user.lastSpeed = pos.speed;
        if (pos.speed > 0.8) user.lastMoveAt = now;
        if (prevSpeed > 25 && pos.speed < 2) user.hardStopAt = now;
        sos.runAutoRules(user);
        // Debounced DB save: at most once every 30s per user
        var lastSave = cache.lastDbSaveAt.get(user.userId) || 0;
        if (now - lastSave > 30000) {
            cache.lastDbSaveAt.set(user.userId, now);
            db.updateUserLocation(user.userId, pos.latitude, pos.longitude, pos.speed, now).catch(function(err) {
                log.error({ err: err.message }, "Failed to persist user location");
            });
        }
        var updatePayload = { ...emitters.sanitizeUser(user), online: true };
        // Batched broadcast: accumulate and flush on short intervals
        visibility.queuePositionBroadcast(user, updatePayload);
        // O(1) lookup of this user's live tokens via index
        var userTokens = cache.liveTokensByUser.get(user.userId);
        if (userTokens) {
            var sanitized = emitters.sanitizeUser(user);
            for (var token of userTokens) { _io.to("live:" + token).emit("liveUpdate", { user: sanitized }); }
        }
    }));

    // ─ Position batch (for offline buffer replay on reconnect) ─
    socket.on("positionBatch", safe(function(batch) {
        if (!Array.isArray(batch) || batch.length === 0) return;
        if (!socketRateLimit(socket, "positionBatch", 5)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        // Process up to 50 entries to prevent abuse
        var limit = Math.min(batch.length, 50);
        for (var i = 0; i < limit; i++) {
            var pos = validatePosition(batch[i]);
            if (!pos) continue;
            user.latitude = pos.latitude;
            user.longitude = pos.longitude;
            user.speed = pos.speed;
            user.lastUpdate = Date.now();
            user.formattedTime = pos.formattedTime;
            user.accuracy = pos.accuracy;
            user.clientTimestamp = pos.timestamp;
        }
        // Broadcast only the final (most recent) position
        var updatePayload = { ...emitters.sanitizeUser(user), online: true };
        visibility.queuePositionBroadcast(user, updatePayload);
        var userTokens = cache.liveTokensByUser.get(user.userId);
        if (userTokens) {
            var sanitized = emitters.sanitizeUser(user);
            for (var token of userTokens) { _io.to("live:" + token).emit("liveUpdate", { user: sanitized }); }
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
                // Set creator as room admin
                if (!cache.roomMemberRoles.has(code)) cache.roomMemberRoles.set(code, new Map());
                cache.roomMemberRoles.get(code).set(user.userId, { role: "admin", expiresAt: null });
                user.rooms = emitters.getUserRooms(user.userId);
                visibility.invalidateVisibility(user.userId);
                return db.addRoomMember(roomDbId, user.userId, "admin");
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
        var affectedMembers = Array.from(room.members);
        visibility.invalidateVisibilityForUsers(affectedMembers);
        db.addRoomMember(room.dbId, user.userId).catch(function(e) {
            log.error({ err: e.message }, "Failed to persist room join – reverting cache");
            room.members.delete(user.userId);
            user.rooms = emitters.getUserRooms(user.userId);
            visibility.invalidateVisibilityForUsers(affectedMembers);
            socket.emit("roomError", { message: "Failed to join room. Please try again." });
            emitters.emitMyRooms(socket, user.userId);
        });
        var membersList = [];
        for (var mid of room.members) { membersList.push({ userId: mid, displayName: emitters.getDisplayName(mid) }); }
        socket.emit("roomJoined", { code: code, name: room.name, members: membersList });
        emitters.emitMyRooms(socket, user.userId);
        visibility.scheduleVisibilityRefresh(socket, user);
        for (var memberId of room.members) {
            if (memberId === user.userId) continue;
            var ms = emitters.findSocketByUserId(memberId);
            if (ms) { var mu = cache.activeUsers.get(ms.id); if (mu) visibility.scheduleVisibilityRefresh(ms, mu); }
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
        visibility.invalidateVisibilityForUsers(membersCopy);
        db.removeRoomMember(roomDbId, user.userId)
            .then(function() { if (roomDeleted) return db.deleteRoom(roomDbId); })
            .catch(function(e) { log.error({ err: e.message }, "Failed to persist room leave"); });
        socket.emit("roomLeft", { code: code, name: room.name || code });
        emitters.emitMyRooms(socket, user.userId);
        visibility.scheduleVisibilityRefresh(socket, user);
        for (var mn of membersCopy) {
            if (mn === user.userId) continue;
            var ms2 = emitters.findSocketByUserId(mn);
            if (ms2) { var mu2 = cache.activeUsers.get(ms2.id); if (mu2) visibility.scheduleVisibilityRefresh(ms2, mu2); }
        }
    }));

    // ─ Contacts (with limits + rate limiting) ─
    socket.on("addContact", safe(async function(payload) {
        if (!socketRateLimit(socket, "addContact", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user) return;
        var myContacts = cache.contacts.get(user.userId) || new Set();
        if (myContacts.size >= MAX_CONTACTS_PER_USER) { socket.emit("contactError", { message: "Contact limit reached (" + MAX_CONTACTS_PER_USER + ")" }); return; }
        var code = (payload && typeof payload.shareCode === "string") ? payload.shareCode.trim().toUpperCase() : "";
        if (!code) { socket.emit("contactError", { message: "Enter a share code" }); return; }
        if (!cache.shareCodes.has(code)) { socket.emit("contactError", { message: "Share code not found" }); return; }
        var targetUserId = cache.shareCodes.get(code);
        if (targetUserId === user.userId) { socket.emit("contactError", { message: "That is your own account" }); return; }
        if (!cache.contacts.has(user.userId)) cache.contacts.set(user.userId, new Set());
        var mc = cache.contacts.get(user.userId);
        if (mc.has(targetUserId)) { socket.emit("contactError", { message: "Already in your contacts" }); return; }
        // Bidirectional: add both directions in cache
        mc.add(targetUserId);
        if (!cache.contacts.has(targetUserId)) cache.contacts.set(targetUserId, new Set());
        var tc = cache.contacts.get(targetUserId);
        tc.add(user.userId);
        visibility.invalidateVisibility(user.userId);
        visibility.invalidateVisibility(targetUserId);
        // Persist both directions in a single transaction
        db.addContactBidirectional(user.userId, targetUserId).catch(function(e) {
            log.error({ err: e.message }, "Failed to persist bidirectional contact – reverting cache");
            mc.delete(targetUserId);
            tc.delete(user.userId);
            visibility.invalidateVisibility(user.userId);
            visibility.invalidateVisibility(targetUserId);
            socket.emit("contactError", { message: "Failed to add contact. Please try again." });
            emitters.emitMyContacts(socket, user.userId);
        });
        // Notify both users
        socket.emit("contactAdded", { userId: targetUserId, displayName: emitters.getDisplayName(targetUserId) });
        emitters.emitMyContacts(socket, user.userId);
        visibility.scheduleVisibilityRefresh(socket, user);
        var targetSocket = emitters.findSocketByUserId(targetUserId);
        if (targetSocket) {
            var targetUser = cache.activeUsers.get(targetSocket.id);
            if (targetUser) {
                targetSocket.emit("contactAdded", { userId: user.userId, displayName: emitters.getDisplayName(user.userId) });
                emitters.emitMyContacts(targetSocket, targetUserId);
                visibility.scheduleVisibilityRefresh(targetSocket, targetUser);
            }
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
        // Bidirectional: remove both directions
        mc.delete(targetUserId);
        var tc = cache.contacts.get(targetUserId);
        if (tc) tc.delete(user.userId);
        visibility.invalidateVisibility(user.userId);
        visibility.invalidateVisibility(targetUserId);
        db.removeContactBidirectional(user.userId, targetUserId).catch(function(e) { log.error({ err: e.message }, "Failed to persist bidirectional contact remove"); });
        socket.emit("contactRemoved", { userId: targetUserId });
        emitters.emitMyContacts(socket, user.userId);
        visibility.scheduleVisibilityRefresh(socket, user);
        // Notify the target user — contact removed from their side too
        var targetSocket2 = emitters.findSocketByUserId(targetUserId);
        if (targetSocket2) {
            var targetUser2 = cache.activeUsers.get(targetSocket2.id);
            if (targetUser2) {
                targetSocket2.emit("contactRemoved", { userId: user.userId });
                emitters.emitMyContacts(targetSocket2, targetUserId);
                visibility.scheduleVisibilityRefresh(targetSocket2, targetUser2);
            }
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
        else if (duration === "48h") expiresAt = Date.now() + 48 * 60 * 60 * 1000;
        var token = crypto.randomBytes(16).toString("base64url");
        var createdAt = Date.now();
        cache.liveTokens.set(token, { userId: user.userId, expiresAt: expiresAt, createdAt: createdAt });
        // Maintain liveTokensByUser index
        if (!cache.liveTokensByUser.has(user.userId)) cache.liveTokensByUser.set(user.userId, new Set());
        cache.liveTokensByUser.get(user.userId).add(token);
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
        // Maintain liveTokensByUser index
        var userTokenSet = cache.liveTokensByUser.get(user.userId);
        if (userTokenSet) { userTokenSet.delete(token); if (userTokenSet.size === 0) cache.liveTokensByUser.delete(user.userId); }
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

    // ─ Super Admin: full system overview ─
    socket.on("requestAdminOverview", safe(function() {
        if (!socketRateLimit(socket, "requestAdminOverview", 5)) return;
        var actor = cache.activeUsers.get(socket.id);
        if (!actor || actor.role !== "admin") return;
        emitters.emitAdminOverview(socket);
    }));

    // ─ Room Admin: request / approve / deny / revoke ─
    socket.on("requestRoomAdmin", safe(function(payload) {
        if (!socketRateLimit(socket, "requestRoomAdmin", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user || !payload) return;
        var code = typeof payload.roomCode === "string" ? payload.roomCode.trim().toUpperCase() : "";
        var room = code ? cache.rooms.get(code) : null;
        if (!room || !room.members.has(user.userId)) { socket.emit("roomError", { message: "Not a member of this room" }); return; }
        var roleMap = cache.roomMemberRoles.get(code);
        if (roleMap) {
            var myRole = roleMap.get(user.userId);
            if (myRole && myRole.role === "admin") { socket.emit("roomError", { message: "You are already an admin of this room" }); return; }
        }
        var expiresIn = typeof payload.expiresIn === "string" ? payload.expiresIn : null;
        // Check for existing pending request
        if (!cache.pendingRequests.has(code + ":roomAdmin")) cache.pendingRequests.set(code + ":roomAdmin", []);
        var pending = cache.pendingRequests.get(code + ":roomAdmin");
        if (pending.some(function(r) { return r.from === user.userId; })) { socket.emit("roomError", { message: "Request already pending" }); return; }
        // Create request with vote tracking
        var reqEntry = { type: "roomAdmin", from: user.userId, roomCode: code, expiresIn: expiresIn, approvals: new Set(), denials: new Set(), createdAt: Date.now() };
        pending.push(reqEntry);
        // Persist
        db.createRoomAdminRequest(code, user.userId, expiresIn, Date.now()).catch(function(e) { log.error({ err: e.message }, "Failed to persist room admin request"); });
        // Notify ALL room members (except requester) for majority vote
        var totalEligible = room.members.size - 1;
        for (var mid of room.members) {
            if (mid === user.userId) continue;
            var memberSocket = emitters.findSocketByUserId(mid);
            if (memberSocket) {
                memberSocket.emit("roomAdminRequest", {
                    roomCode: code, fromUserId: user.userId, fromName: user.displayName,
                    expiresIn: expiresIn, approvals: 0, denials: 0, totalEligible: totalEligible, myVote: null
                });
                emitters.emitMyRooms(memberSocket, mid);
            }
        }
        // Refresh rooms for requester too (shows pending status)
        emitters.emitMyRooms(socket, user.userId);
        socket.emit("roomError", { message: "Admin request sent to room members for vote" });
    }));

    // Room admin vote (approve or deny) - majority wins
    socket.on("voteRoomAdmin", safe(function(payload) {
        if (!socketRateLimit(socket, "voteRoomAdmin", 20)) return;
        var actor = cache.activeUsers.get(socket.id);
        if (!actor || !payload) return;
        var code = typeof payload.roomCode === "string" ? payload.roomCode.trim().toUpperCase() : "";
        var targetUserId = typeof payload.userId === "string" ? payload.userId.trim() : "";
        var vote = typeof payload.vote === "string" ? payload.vote : "";
        if (vote !== "approve" && vote !== "deny") return;
        var room = code ? cache.rooms.get(code) : null;
        if (!room || !room.members.has(actor.userId) || !room.members.has(targetUserId)) return;
        if (actor.userId === targetUserId) return;
        // Find pending request
        var pending = cache.pendingRequests.get(code + ":roomAdmin") || [];
        var req = null;
        for (var i = 0; i < pending.length; i++) { if (pending[i].from === targetUserId) { req = pending[i]; break; } }
        if (!req) return;
        // Record vote
        if (vote === "approve") { req.approvals.add(actor.userId); req.denials.delete(actor.userId); }
        else { req.denials.add(actor.userId); req.approvals.delete(actor.userId); }
        // Persist vote
        db.upsertRoomAdminVote(code, targetUserId, actor.userId, vote).catch(function(e) { log.error({ err: e.message }, "Failed to persist room admin vote"); });
        var totalEligible = room.members.size - 1;
        var majority = Math.floor(totalEligible / 2) + 1;
        // Check majority
        if (req.approvals.size >= majority) {
            // Promote!
            for (var j = 0; j < pending.length; j++) { if (pending[j].from === targetUserId) { pending.splice(j, 1); break; } }
            var expiresAt = req.expiresIn ? parseExpiresIn(req.expiresIn) : null;
            var roleMap = cache.roomMemberRoles.get(code);
            if (!roleMap) { roleMap = new Map(); cache.roomMemberRoles.set(code, roleMap); }
            roleMap.set(targetUserId, { role: "admin", expiresAt: expiresAt });
            db.setRoomMemberRole(room.dbId, targetUserId, "admin", expiresAt).catch(function(e) { log.error({ err: e.message }, "Failed to persist room admin promotion"); });
            db.deleteRoomAdminRequest(code, targetUserId).catch(function(e) { log.error({ err: e.message }, "Failed to clean up room admin request"); });
            for (var memberId of room.members) {
                var ms = emitters.findSocketByUserId(memberId);
                if (ms) {
                    ms.emit("roomAdminUpdated", { roomCode: code, userId: targetUserId, role: "admin", expiresAt: expiresAt });
                    emitters.emitMyRooms(ms, memberId);
                }
            }
        } else if (req.denials.size >= majority) {
            // Deny
            for (var k = 0; k < pending.length; k++) { if (pending[k].from === targetUserId) { pending.splice(k, 1); break; } }
            db.deleteRoomAdminRequest(code, targetUserId).catch(function(e) { log.error({ err: e.message }, "Failed to clean up room admin request"); });
            var targetSocket = emitters.findSocketByUserId(targetUserId);
            if (targetSocket) targetSocket.emit("roomAdminUpdated", { roomCode: code, userId: targetUserId, role: "denied", expiresAt: null });
            for (var memberId2 of room.members) {
                var ms2 = emitters.findSocketByUserId(memberId2);
                if (ms2) {
                    ms2.emit("roomAdminVoteUpdate", { roomCode: code, userId: targetUserId, denied: true });
                    emitters.emitMyRooms(ms2, memberId2);
                }
            }
        } else {
            // Broadcast updated vote counts + refresh rooms for all members
            for (var memberId3 of room.members) {
                var ms3 = emitters.findSocketByUserId(memberId3);
                if (ms3) {
                    emitters.emitMyRooms(ms3, memberId3);
                    if (memberId3 !== targetUserId) {
                        ms3.emit("roomAdminVoteUpdate", {
                            roomCode: code, userId: targetUserId,
                            approvals: req.approvals.size, denials: req.denials.size,
                            totalEligible: totalEligible,
                            myVote: req.approvals.has(memberId3) ? "approve" : (req.denials.has(memberId3) ? "deny" : null)
                        });
                    }
                }
            }
        }
    }));

    socket.on("revokeRoomAdmin", safe(function(payload) {
        if (!socketRateLimit(socket, "revokeRoomAdmin", 10)) return;
        var actor = cache.activeUsers.get(socket.id);
        if (!actor || !payload) return;
        var code = typeof payload.roomCode === "string" ? payload.roomCode.trim().toUpperCase() : "";
        var targetUserId = typeof payload.userId === "string" ? payload.userId.trim() : "";
        var room = code ? cache.rooms.get(code) : null;
        if (!room || !room.members.has(targetUserId)) return;
        var roleMap = cache.roomMemberRoles.get(code);
        // Only another room admin or the user themselves can revoke
        var actorRole = roleMap ? roleMap.get(actor.userId) : null;
        var isSelf = actor.userId === targetUserId;
        if (!isSelf && (!actorRole || actorRole.role !== "admin")) return;
        if (roleMap) roleMap.set(targetUserId, { role: "member", expiresAt: null });
        db.setRoomMemberRole(room.dbId, targetUserId, "member", null).catch(function(e) { log.error({ err: e.message }, "Failed to persist room admin revoke"); });
        for (var memberId of room.members) {
            var ms = emitters.findSocketByUserId(memberId);
            if (ms) ms.emit("roomAdminUpdated", { roomCode: code, userId: targetUserId, role: "member", expiresAt: null });
        }
    }));

    // ─ Guardian: request / approve / deny / revoke ─
    socket.on("requestGuardian", safe(function(payload) {
        if (!socketRateLimit(socket, "requestGuardian", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user || !payload) return;
        var wardId = typeof payload.contactUserId === "string" ? payload.contactUserId.trim() : "";
        if (!wardId || wardId === user.userId) return;
        // Both must be mutual contacts
        var myContacts = cache.contacts.get(user.userId) || new Set();
        var theirContacts = cache.contacts.get(wardId) || new Set();
        if (!myContacts.has(wardId) || !theirContacts.has(user.userId)) { socket.emit("contactError", { message: "Both must be mutual contacts to request guardian role" }); return; }
        // Check if already active guardian
        var wards = cache.guardianships.get(user.userId);
        if (wards) {
            var existing = wards.get(wardId);
            if (existing && (existing.status === "active" || existing.status === "pending")) { socket.emit("contactError", { message: existing.status === "active" ? "You are already a guardian for this contact" : "Request already pending" }); return; }
        }
        var expiresIn = typeof payload.expiresIn === "string" ? payload.expiresIn : null;
        // Create pending guardianship in cache and DB (guardian initiated)
        if (!cache.guardianships.has(user.userId)) cache.guardianships.set(user.userId, new Map());
        cache.guardianships.get(user.userId).set(wardId, { status: "pending", expiresAt: null, createdAt: Date.now(), initiatedBy: "guardian" });
        db.createGuardianship(user.userId, wardId, "pending", null, Date.now(), "guardian").catch(function(e) { log.error({ err: e.message }, "Failed to persist guardian request"); });
        // Store expiresIn for approval
        if (!cache.pendingRequests.has(wardId + ":guardian")) cache.pendingRequests.set(wardId + ":guardian", []);
        var pending = cache.pendingRequests.get(wardId + ":guardian");
        if (!pending.some(function(r) { return r.from === user.userId; })) {
            pending.push({ type: "guardian", from: user.userId, expiresIn: expiresIn });
        }
        // Notify the ward — refresh their guardian data so Accept button shows
        var wardSocket = emitters.findSocketByUserId(wardId);
        if (wardSocket) {
            wardSocket.emit("guardianRequest", { fromUserId: user.userId, fromName: user.displayName, expiresIn: expiresIn, initiatedBy: "guardian" });
            emitters.emitMyGuardians(wardSocket, wardId);
            emitters.emitPendingRequests(wardSocket, wardId);
        }
        socket.emit("contactError", { message: "Guardian request sent" });
        emitters.emitMyGuardians(socket, user.userId);
    }));

    // Ward invites someone to be their guardian
    socket.on("inviteGuardian", safe(function(payload) {
        if (!socketRateLimit(socket, "inviteGuardian", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user || !payload) return;
        var guardianId = typeof payload.contactUserId === "string" ? payload.contactUserId.trim() : "";
        if (!guardianId || guardianId === user.userId) return;
        // Both must be mutual contacts
        var myContacts = cache.contacts.get(user.userId) || new Set();
        var theirContacts = cache.contacts.get(guardianId) || new Set();
        if (!myContacts.has(guardianId) || !theirContacts.has(user.userId)) { socket.emit("contactError", { message: "Both must be mutual contacts" }); return; }
        // Check if already active/pending
        var wards = cache.guardianships.get(guardianId);
        if (wards) {
            var existing = wards.get(user.userId);
            if (existing && (existing.status === "active" || existing.status === "pending")) { socket.emit("contactError", { message: existing.status === "active" ? "Already your guardian" : "Request already pending" }); return; }
        }
        var expiresIn = typeof payload.expiresIn === "string" ? payload.expiresIn : null;
        // Create pending guardianship (ward initiated → guardian needs to approve)
        if (!cache.guardianships.has(guardianId)) cache.guardianships.set(guardianId, new Map());
        cache.guardianships.get(guardianId).set(user.userId, { status: "pending", expiresAt: null, createdAt: Date.now(), initiatedBy: "ward" });
        db.createGuardianship(guardianId, user.userId, "pending", null, Date.now(), "ward").catch(function(e) { log.error({ err: e.message }, "Failed to persist guardian invite"); });
        // Store expiresIn for approval
        if (!cache.pendingRequests.has(guardianId + ":guardianInvite")) cache.pendingRequests.set(guardianId + ":guardianInvite", []);
        var pending = cache.pendingRequests.get(guardianId + ":guardianInvite");
        if (!pending.some(function(r) { return r.from === user.userId; })) {
            pending.push({ type: "guardianInvite", from: user.userId, expiresIn: expiresIn });
        }
        // Notify the potential guardian — refresh their guardian data so Accept button shows
        var guardianSocket = emitters.findSocketByUserId(guardianId);
        if (guardianSocket) {
            guardianSocket.emit("guardianInvite", { fromUserId: user.userId, fromName: user.displayName, expiresIn: expiresIn, initiatedBy: "ward" });
            emitters.emitMyGuardians(guardianSocket, guardianId);
            emitters.emitPendingRequests(guardianSocket, guardianId);
        }
        socket.emit("contactError", { message: "Guardian invite sent" });
        emitters.emitMyGuardians(socket, user.userId);
    }));

    socket.on("approveGuardian", safe(function(payload) {
        if (!socketRateLimit(socket, "approveGuardian", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user || !payload) return;
        var guardianId = typeof payload.guardianUserId === "string" ? payload.guardianUserId.trim() : "";
        var wardId = typeof payload.wardUserId === "string" ? payload.wardUserId.trim() : "";
        var gId, wId, pendingKey;
        if (guardianId) {
            // Ward approving guardian's request
            gId = guardianId; wId = user.userId;
            pendingKey = user.userId + ":guardian";
        } else if (wardId) {
            // Guardian approving ward's invite
            gId = user.userId; wId = wardId;
            pendingKey = user.userId + ":guardianInvite";
        } else return;
        var wards = cache.guardianships.get(gId);
        if (!wards) return;
        var entry = wards.get(wId);
        if (!entry || entry.status !== "pending") return;
        // Find pending to get expiresIn
        var fromId = guardianId ? guardianId : wardId;
        var pending = cache.pendingRequests.get(pendingKey) || [];
        var req = null;
        for (var i = 0; i < pending.length; i++) { if (pending[i].from === fromId) { req = pending[i]; pending.splice(i, 1); break; } }
        var expiresAt = req && req.expiresIn ? parseExpiresIn(req.expiresIn) : null;
        // Also check payload expiresIn
        if (!expiresAt && typeof payload.expiresIn === "string") expiresAt = parseExpiresIn(payload.expiresIn);
        // Activate
        entry.status = "active";
        entry.expiresAt = expiresAt;
        db.createGuardianship(gId, wId, "active", expiresAt, entry.createdAt, entry.initiatedBy).catch(function(e) { log.error({ err: e.message }, "Failed to persist guardian approval"); });
        // Notify both — refresh guardian data + pending requests
        var otherUserId = user.userId === gId ? wId : gId;
        var otherSocket = emitters.findSocketByUserId(otherUserId);
        var updatePayload = { guardianId: gId, wardId: wId, status: "active", expiresAt: expiresAt };
        if (otherSocket) {
            otherSocket.emit("guardianUpdated", updatePayload);
            emitters.emitMyGuardians(otherSocket, otherUserId);
            emitters.emitPendingRequests(otherSocket, otherUserId);
        }
        socket.emit("guardianUpdated", updatePayload);
        emitters.emitMyGuardians(socket, user.userId);
        emitters.emitPendingRequests(socket, user.userId);
    }));

    socket.on("denyGuardian", safe(function(payload) {
        if (!socketRateLimit(socket, "denyGuardian", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user || !payload) return;
        var guardianId = typeof payload.guardianUserId === "string" ? payload.guardianUserId.trim() : "";
        var wardId = typeof payload.wardUserId === "string" ? payload.wardUserId.trim() : "";
        var gId, wId, pendingKey;
        if (guardianId) {
            gId = guardianId; wId = user.userId;
            pendingKey = user.userId + ":guardian";
        } else if (wardId) {
            gId = user.userId; wId = wardId;
            pendingKey = user.userId + ":guardianInvite";
        } else return;
        var wards = cache.guardianships.get(gId);
        if (!wards) return;
        var entry = wards.get(wId);
        if (!entry || entry.status !== "pending") return;
        wards.delete(wId);
        // Remove pending
        var fromId = guardianId ? guardianId : wardId;
        var pending = cache.pendingRequests.get(pendingKey) || [];
        for (var i = 0; i < pending.length; i++) { if (pending[i].from === fromId) { pending.splice(i, 1); break; } }
        db.updateGuardianshipStatus(gId, wId, "revoked").catch(function(e) { log.error({ err: e.message }, "Failed to persist guardian denial"); });
        var otherUserId = user.userId === gId ? wId : gId;
        var otherSocket = emitters.findSocketByUserId(otherUserId);
        var updatePayload = { guardianId: gId, wardId: wId, status: "denied", expiresAt: null };
        if (otherSocket) {
            otherSocket.emit("guardianUpdated", updatePayload);
            emitters.emitMyGuardians(otherSocket, otherUserId);
            emitters.emitPendingRequests(otherSocket, otherUserId);
        }
        socket.emit("guardianUpdated", updatePayload);
        emitters.emitMyGuardians(socket, user.userId);
        emitters.emitPendingRequests(socket, user.userId);
    }));

    socket.on("revokeGuardian", safe(function(payload) {
        if (!socketRateLimit(socket, "revokeGuardian", 10)) return;
        var user = cache.activeUsers.get(socket.id);
        if (!user || !payload) return;
        var guardianId = typeof payload.guardianUserId === "string" ? payload.guardianUserId.trim() : null;
        var wardId = typeof payload.wardUserId === "string" ? payload.wardUserId.trim() : null;
        var gId, wId;
        if (guardianId) { gId = guardianId; wId = user.userId; }
        else if (wardId) { gId = user.userId; wId = wardId; }
        else return;
        var wards = cache.guardianships.get(gId);
        if (!wards) return;
        var entry = wards.get(wId);
        if (!entry || (entry.status !== "active" && entry.status !== "pending")) return;
        // Only the guardian can revoke an active guardianship.
        // The ward can only cancel a pending request they initiated.
        if (entry.status === "active" && user.userId !== gId) {
            socket.emit("error", { message: "Only the guardian can revoke an active guardianship." });
            return;
        }
        if (entry.status === "pending") {
            // Pending: the initiator or receiver can cancel/decline
            // (handled by approve/deny, but allow cancel from initiator side)
            var isInitiator = (entry.initiatedBy === "guardian" && user.userId === gId)
                           || (entry.initiatedBy === "ward" && user.userId === wId);
            if (!isInitiator) {
                socket.emit("error", { message: "Only the requester can cancel a pending guardianship request." });
                return;
            }
        }
        wards.delete(wId);
        db.updateGuardianshipStatus(gId, wId, "revoked").catch(function(e) { log.error({ err: e.message }, "Failed to persist guardian revoke"); });
        // Also clean up any pending requests for this guardianship
        var pendingKey1 = wId + ":guardian";
        var pendingKey2 = gId + ":guardianInvite";
        var p1 = cache.pendingRequests.get(pendingKey1) || [];
        for (var pi = 0; pi < p1.length; pi++) { if (p1[pi].from === gId) { p1.splice(pi, 1); break; } }
        var p2 = cache.pendingRequests.get(pendingKey2) || [];
        for (var pi2 = 0; pi2 < p2.length; pi2++) { if (p2[pi2].from === wId) { p2.splice(pi2, 1); break; } }
        var updatePayload = { guardianId: gId, wardId: wId, status: "revoked", expiresAt: null };
        var otherUserId = user.userId === gId ? wId : gId;
        var otherSocket = emitters.findSocketByUserId(otherUserId);
        if (otherSocket) {
            otherSocket.emit("guardianUpdated", updatePayload);
            emitters.emitMyGuardians(otherSocket, otherUserId);
            emitters.emitPendingRequests(otherSocket, otherUserId);
        }
        socket.emit("guardianUpdated", updatePayload);
        emitters.emitMyGuardians(socket, user.userId);
        emitters.emitPendingRequests(socket, user.userId);
    }));

    // ─ Disconnect ─
    socket.on("disconnect", function() {
        log.info({ userId: userId, socketId: socket.id }, "User disconnected");
        cache.lastPositionAt.delete(socket.id);
        cache.lastDbSaveAt.delete(userId);
        cache.lastVisibleSets.delete(socket.id);
        var user = cache.activeUsers.get(socket.id);
        cache.activeUsers.delete(socket.id);
        // Clean up userId → socketId index (only if it still points to this socket)
        if (cache.userIdToSocketId.get(userId) === socket.id) {
            cache.userIdToSocketId.delete(userId);
        }
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
