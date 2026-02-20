var crypto = require("crypto");
var cache = require("../cache");
var helpers = require("../lib/helpers");
var emitters = require("./emitters");
var visibility = require("./visibility");

var haversineM = helpers.haversineM;

// io reference, set via setIo()
var _io = null;
function setIo(io) { _io = io; }

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
        if (user.sos.token) cache.watchTokens.delete(user.sos.token);
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
    cache.watchTokens.set(token, { socketId: user.socketId, userId: user.userId, exp: exp });
}

function emitSosUpdate(user) {
    var full = publicSos(user);
    if (full.type === "geofence") {
        _io.to(full.socketId).emit("sosUpdate", full);
        var geoPublic = { ...full, acks: [], ackBy: null };
        var geoEmitted = new Set();
        // Send to all contacts
        var geoContacts = cache.contacts.get(user.userId);
        if (geoContacts) {
            for (var gcid of geoContacts) {
                var gsid = cache.userIdToSocketId.get(gcid);
                if (!gsid || gsid === user.socketId) continue;
                var gv = cache.activeUsers.get(gsid);
                if (!gv) continue;
                geoEmitted.add(gsid);
                if (gv.role === "admin") _io.to(gsid).emit("sosUpdate", full);
                else _io.to(gsid).emit("sosUpdate", geoPublic);
            }
        }
        // Send to admins not already notified
        for (var u of cache.activeUsers.values()) {
            if (u.role === "admin" && u.socketId !== full.socketId && !geoEmitted.has(u.socketId)) {
                _io.to(u.socketId).emit("sosUpdate", full);
            }
        }
        emitLiveSos(user);
        return;
    }
    var publicPayload = { ...full, acks: [], ackBy: null };
    var emittedSids = new Set();

    // 1. Explicitly send to ALL of the sender's contacts (guaranteed delivery)
    var contactSet = cache.contacts.get(user.userId);
    if (contactSet) {
        for (var contactId of contactSet) {
            var sid = cache.userIdToSocketId.get(contactId);
            if (!sid || sid === user.socketId) continue;
            var viewer = cache.activeUsers.get(sid);
            if (!viewer) continue;
            emittedSids.add(sid);
            if (viewer.role === "admin") _io.to(sid).emit("sosUpdate", full);
            else _io.to(sid).emit("sosUpdate", publicPayload);
        }
    }

    // 2. Also send to anyone else in the visibility set (room members, admins, etc.)
    var viewers = visibility.getVisibleSockets(user);
    for (var vsid of viewers) {
        if (emittedSids.has(vsid)) continue; // already sent
        var vuser = cache.activeUsers.get(vsid);
        if (!vuser) continue;
        if (vuser.role === "admin") _io.to(vsid).emit("sosUpdate", full);
        else _io.to(vsid).emit("sosUpdate", publicPayload);
    }

    // 3. Always send full payload to the sender themselves
    _io.to(full.socketId).emit("sosUpdate", full);
    emitLiveSos(user);
}

function emitLiveSos(user) {
    var sosData = {
        active: !!user.sos.active, at: user.sos.at, reason: user.sos.reason, type: user.sos.type,
        ackCount: Array.isArray(user.sos.acks) ? user.sos.acks.length : 0,
        acks: Array.isArray(user.sos.acks) ? user.sos.acks : []
    };
    var tokenSet = cache.liveTokensByUser.get(user.userId);
    if (tokenSet) { for (var token of tokenSet) { _io.to("live:" + token).emit("liveSosUpdate", sosData); } }
}

function emitLiveCheckIn(user) {
    var ciData = {
        enabled: !!(user.checkIn && user.checkIn.enabled),
        lastCheckInAt: user.checkIn ? user.checkIn.lastCheckInAt : null,
        intervalMinutes: user.checkIn ? user.checkIn.intervalMinutes : 0,
        overdueMinutes: user.checkIn ? user.checkIn.overdueMinutes : 0
    };
    var tokenSet = cache.liveTokensByUser.get(user.userId);
    if (tokenSet) { for (var token of tokenSet) { _io.to("live:" + token).emit("liveCheckInUpdate", ciData); } }
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
    _io.to("watch:" + user.sos.token).emit("watchUpdate", { user: emitters.sanitizeUser(user), sos: publicSos(user) });
}

function getIo() { return _io; }

module.exports = {
    setIo: setIo,
    getIo: getIo,
    publicSos: publicSos,
    setSos: setSos,
    emitSosUpdate: emitSosUpdate,
    emitLiveSos: emitLiveSos,
    emitLiveCheckIn: emitLiveCheckIn,
    runAutoRules: runAutoRules,
    emitWatch: emitWatch
};
