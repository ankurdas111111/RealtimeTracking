var cache = require("../cache");

// io reference, set via setIo()
var _io = null;
function setIo(io) { _io = io; }

function getDisplayName(userId) {
    var u = cache.usersCache[userId];
    if (!u) return "Unknown";
    return ((u.firstName || "") + " " + (u.lastName || "")).trim() || "User";
}

function maskEmail(email) {
    if (!email) return "";
    var parts = email.split("@");
    if (parts.length !== 2) return "***";
    var local = parts[0];
    var masked = local.length <= 2 ? local[0] + "***" : local.substring(0, 2) + "***";
    return masked + "@" + parts[1];
}

function maskMobile(mobile) {
    if (!mobile) return "";
    if (mobile.length <= 4) return "***" + mobile.slice(-2);
    return "***" + mobile.slice(-4);
}

function getUserRoomCount(userId) {
    var count = 0;
    for (var [, room] of cache.rooms) { if (room.members.has(userId)) count++; }
    return count;
}

function getUserLiveLinkCount(userId) {
    var count = 0;
    for (var [, entry] of cache.liveTokens) { if (entry.userId === userId) count++; }
    return count;
}

function getUserRooms(userId) {
    var result = [];
    for (var [code, room] of cache.rooms) { if (room.members.has(userId)) result.push(code); }
    return result;
}

function sanitizeUser(user) {
    return {
        socketId: user.socketId,
        userId: user.userId,
        displayName: user.displayName,
        role: user.role,
        latitude: user.latitude,
        longitude: user.longitude,
        speed: user.speed,
        lastUpdate: user.lastUpdate,
        formattedTime: user.formattedTime,
        batteryPct: user.batteryPct,
        deviceType: user.deviceType,
        connectionQuality: user.connectionQuality,
        online: user.online,
        sos: user.sos ? { active: !!user.sos.active, at: user.sos.at, reason: user.sos.reason, type: user.sos.type } : { active: false },
        geofence: user.geofence ? { enabled: !!user.geofence.enabled, centerLat: user.geofence.centerLat, centerLng: user.geofence.centerLng, radiusM: user.geofence.radiusM } : { enabled: false },
        autoSos: user.autoSos ? { enabled: !!user.autoSos.enabled, noMoveMinutes: user.autoSos.noMoveMinutes, hardStopMinutes: user.autoSos.hardStopMinutes, geofence: user.autoSos.geofence } : { enabled: false },
        checkIn: user.checkIn ? { enabled: !!user.checkIn.enabled, intervalMinutes: user.checkIn.intervalMinutes, overdueMinutes: user.checkIn.overdueMinutes, lastCheckInAt: user.checkIn.lastCheckInAt } : { enabled: false },
        retention: user.retention ? { mode: user.retention.mode } : { mode: "default" },
        rooms: user.rooms
    };
}

function findActiveUserByUserId(userId) {
    for (var u of cache.activeUsers.values()) { if (u.userId === userId) return u; }
    return null;
}

function findSocketByUserId(userId) {
    for (var [sid, u] of cache.activeUsers) {
        if (u.userId === userId) return _io.sockets.sockets.get(sid) || null;
    }
    return null;
}

function emitMyRooms(socket, userId) {
    var myRooms = [];
    for (var [code, room] of cache.rooms) {
        if (room.members.has(userId)) {
            var membersList = [];
            for (var mid of room.members) { membersList.push({ userId: mid, displayName: getDisplayName(mid) }); }
            myRooms.push({ code: code, name: room.name, members: membersList, createdBy: room.createdBy });
        }
    }
    socket.emit("myRooms", myRooms);
}

function emitMyContacts(socket, userId) {
    var myContacts = [];
    var contactSet = cache.contacts.get(userId) || new Set();
    for (var contactId of contactSet) {
        var ud = cache.usersCache[contactId];
        myContacts.push({
            userId: contactId,
            displayName: getDisplayName(contactId),
            shareCode: ud ? ud.shareCode : "",
            maskedEmail: ud && ud.email ? maskEmail(ud.email) : "",
            maskedMobile: ud && ud.mobile ? maskMobile(ud.mobile) : ""
        });
    }
    socket.emit("myContacts", myContacts);
}

function emitMyLiveLinks(socket, userId) {
    var myLinks = [];
    for (var [token, entry] of cache.liveTokens) {
        if (entry.userId === userId) {
            myLinks.push({ token: token, expiresAt: entry.expiresAt, createdAt: entry.createdAt });
        }
    }
    socket.emit("myLiveLinks", myLinks);
}

module.exports = {
    setIo: setIo,
    getDisplayName: getDisplayName,
    maskEmail: maskEmail,
    maskMobile: maskMobile,
    getUserRoomCount: getUserRoomCount,
    getUserLiveLinkCount: getUserLiveLinkCount,
    getUserRooms: getUserRooms,
    sanitizeUser: sanitizeUser,
    findActiveUserByUserId: findActiveUserByUserId,
    findSocketByUserId: findSocketByUserId,
    emitMyRooms: emitMyRooms,
    emitMyContacts: emitMyContacts,
    emitMyLiveLinks: emitMyLiveLinks
};
