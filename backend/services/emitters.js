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
    var set = cache.liveTokensByUser.get(userId);
    return set ? set.size : 0;
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
        accuracy: user.accuracy != null ? user.accuracy : null,
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
    var sid = cache.userIdToSocketId.get(userId);
    if (!sid) return null;
    return cache.activeUsers.get(sid) || null;
}

function findSocketByUserId(userId) {
    var sid = cache.userIdToSocketId.get(userId);
    if (!sid) return null;
    return _io.sockets.sockets.get(sid) || null;
}

function emitMyRooms(socket, userId) {
    var myRooms = [];
    for (var [code, room] of cache.rooms) {
        if (room.members.has(userId)) {
            var roleMap = cache.roomMemberRoles.get(code);
            var membersList = [];
            for (var mid of room.members) {
                var memberRole = roleMap ? roleMap.get(mid) : null;
                membersList.push({
                    userId: mid,
                    displayName: getDisplayName(mid),
                    roomRole: memberRole ? memberRole.role : "member",
                    roleExpiresAt: memberRole ? memberRole.expiresAt : null
                });
            }
            var myRole = roleMap ? roleMap.get(userId) : null;
            // Include pending admin requests for this room
            var pendingAdminReqs = [];
            var pendingKey = code + ":roomAdmin";
            var reqs = cache.pendingRequests.get(pendingKey) || [];
            var totalEligible = room.members.size - 1;
            for (var ri = 0; ri < reqs.length; ri++) {
                var r = reqs[ri];
                pendingAdminReqs.push({
                    from: r.from,
                    fromName: getDisplayName(r.from),
                    expiresIn: r.expiresIn || null,
                    approvals: r.approvals ? r.approvals.size : 0,
                    denials: r.denials ? r.denials.size : 0,
                    totalEligible: totalEligible,
                    myVote: r.approvals && r.approvals.has(userId) ? "approve" : (r.denials && r.denials.has(userId) ? "deny" : null),
                    isMe: r.from === userId
                });
            }
            myRooms.push({
                code: code,
                name: room.name,
                members: membersList,
                createdBy: room.createdBy,
                myRoomRole: myRole ? myRole.role : "member",
                pendingAdminRequests: pendingAdminReqs
            });
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

function emitMyGuardians(socket, userId) {
    var permissions = require("./permissions");
    var asGuardian = [];
    var asWard = [];
    // Where I am guardian
    var wards = cache.guardianships.get(userId);
    if (wards) {
        for (var [wardId, entry] of wards) {
            if (entry.status === "active" || entry.status === "pending") {
                asGuardian.push({ wardId: wardId, wardName: getDisplayName(wardId), status: entry.status, expiresAt: entry.expiresAt, initiatedBy: entry.initiatedBy || "guardian" });
            }
        }
    }
    // Where I am a ward (someone is my guardian)
    for (var [gId, wardMap] of cache.guardianships) {
        var myEntry = wardMap.get(userId);
        if (myEntry && (myEntry.status === "active" || myEntry.status === "pending")) {
            asWard.push({ guardianId: gId, guardianName: getDisplayName(gId), status: myEntry.status, expiresAt: myEntry.expiresAt, initiatedBy: myEntry.initiatedBy || "guardian" });
        }
    }
    // Manageable user IDs (for admin panel target dropdown)
    var manageableSet = permissions.getManageableUsers(userId);
    var manageable = [];
    for (var mid of manageableSet) { manageable.push({ userId: mid, displayName: getDisplayName(mid) }); }
    socket.emit("myGuardians", { asGuardian: asGuardian, asWard: asWard, manageable: manageable });
}

/**
 * Emit all pending requests for this user on connect (survives reconnects).
 * Derives from cache.guardianships (pending) and cache.pendingRequests (room admin).
 */
function emitPendingRequests(socket, userId) {
    var pending = [];

    // Guardian requests where I'm the ward and guardian initiated (I need to approve)
    for (var [gId, wardMap] of cache.guardianships) {
        var myEntry = wardMap.get(userId);
        if (myEntry && myEntry.status === "pending" && (myEntry.initiatedBy || "guardian") === "guardian") {
            pending.push({
                type: "guardian", from: gId, fromName: getDisplayName(gId),
                expiresIn: null, initiatedBy: "guardian"
            });
        }
    }

    // Guardian requests where I'm the guardian and ward initiated (I need to approve)
    var myWards = cache.guardianships.get(userId);
    if (myWards) {
        for (var [wId, wEntry] of myWards) {
            if (wEntry.status === "pending" && wEntry.initiatedBy === "ward") {
                pending.push({
                    type: "guardianInvite", from: wId, fromName: getDisplayName(wId),
                    expiresIn: null, initiatedBy: "ward"
                });
            }
        }
    }

    // Room admin requests for rooms I'm a member of
    for (var [key, reqs] of cache.pendingRequests) {
        if (!key.endsWith(":roomAdmin")) continue;
        var roomCode = key.replace(":roomAdmin", "");
        var room = cache.rooms.get(roomCode);
        if (!room || !room.members.has(userId)) continue;
        for (var i = 0; i < reqs.length; i++) {
            var r = reqs[i];
            if (r.from === userId) continue; // don't show own request
            var totalEligible = room.members.size - 1; // everyone except requester
            pending.push({
                type: "roomAdmin", from: r.from, fromName: getDisplayName(r.from),
                roomCode: roomCode, expiresIn: r.expiresIn,
                approvals: r.approvals ? r.approvals.size : 0,
                denials: r.denials ? r.denials.size : 0,
                totalEligible: totalEligible,
                myVote: r.approvals && r.approvals.has(userId) ? "approve" : (r.denials && r.denials.has(userId) ? "deny" : null)
            });
        }
    }

    if (pending.length > 0) {
        socket.emit("pendingRequests", pending);
    }
}

/**
 * Emit a full system overview to a global admin.
 * Includes ALL rooms, ALL users with their contacts, and ALL guardianships.
 * Cached for 10 seconds to avoid rebuilding on rapid admin refreshes.
 */
var _adminOverviewCache = null;
var _adminOverviewCacheAt = 0;
var ADMIN_OVERVIEW_TTL = 10000;

function buildAdminOverview() {
    var now = Date.now();
    if (_adminOverviewCache && now - _adminOverviewCacheAt < ADMIN_OVERVIEW_TTL) return _adminOverviewCache;

    // All rooms with members and roles
    var allRooms = [];
    for (var [code, room] of cache.rooms) {
        var roleMap = cache.roomMemberRoles.get(code);
        var membersList = [];
        for (var mid of room.members) {
            var memberRole = roleMap ? roleMap.get(mid) : null;
            membersList.push({
                userId: mid,
                displayName: getDisplayName(mid),
                roomRole: memberRole ? memberRole.role : "member",
                roleExpiresAt: memberRole ? memberRole.expiresAt : null,
                online: !!findActiveUserByUserId(mid)
            });
        }
        allRooms.push({
            code: code,
            name: room.name,
            members: membersList,
            createdBy: room.createdBy,
            createdAt: room.createdAt
        });
    }

    // All registered users with their contact lists and guardian info
    var allUsers = [];
    var ucKeys = Object.keys(cache.usersCache);
    for (var k = 0; k < ucKeys.length; k++) {
        var uid = ucKeys[k];
        var uc = cache.usersCache[uid];
        var isOnline = !!findActiveUserByUserId(uid);
        var contactSet = cache.contacts.get(uid) || new Set();
        var contactList = [];
        for (var cid of contactSet) {
            contactList.push({ userId: cid, displayName: getDisplayName(cid) });
        }
        // Guardian relationships for this user
        var asGuardian = [];
        var wardsMap = cache.guardianships.get(uid);
        if (wardsMap) {
            for (var [wid, wEntry] of wardsMap) {
                if (wEntry.status === "active" || wEntry.status === "pending") {
                    asGuardian.push({ wardId: wid, wardName: getDisplayName(wid), status: wEntry.status, expiresAt: wEntry.expiresAt });
                }
            }
        }
        var asWard = [];
        for (var [gid, gWardMap] of cache.guardianships) {
            var myEntry = gWardMap.get(uid);
            if (myEntry && (myEntry.status === "active" || myEntry.status === "pending")) {
                asWard.push({ guardianId: gid, guardianName: getDisplayName(gid), status: myEntry.status, expiresAt: myEntry.expiresAt });
            }
        }

        allUsers.push({
            userId: uid,
            displayName: getDisplayName(uid),
            email: uc.email || null,
            mobile: uc.mobile || null,
            role: uc.role || "user",
            shareCode: uc.shareCode || "",
            online: isOnline,
            contacts: contactList,
            asGuardian: asGuardian,
            asWard: asWard
        });
    }

    // All guardianships (flat list)
    var allGuardianships = [];
    for (var [gId2, wardMap2] of cache.guardianships) {
        for (var [wId2, entry2] of wardMap2) {
            allGuardianships.push({
                guardianId: gId2,
                guardianName: getDisplayName(gId2),
                wardId: wId2,
                wardName: getDisplayName(wId2),
                status: entry2.status,
                expiresAt: entry2.expiresAt
            });
        }
    }

    _adminOverviewCache = {
        rooms: allRooms,
        users: allUsers,
        guardianships: allGuardianships,
        stats: {
            totalUsers: ucKeys.length,
            totalRooms: cache.rooms.size,
            activeConnections: cache.activeUsers.size,
            offlineUsers: cache.offlineUsers.size
        }
    };
    _adminOverviewCacheAt = now;
    return _adminOverviewCache;
}

function emitAdminOverview(socket) {
    socket.emit("adminOverview", buildAdminOverview());
}

function emitMyLiveLinks(socket, userId) {
    var myLinks = [];
    var tokenSet = cache.liveTokensByUser.get(userId);
    if (tokenSet) {
        for (var token of tokenSet) {
            var entry = cache.liveTokens.get(token);
            if (entry) myLinks.push({ token: token, expiresAt: entry.expiresAt, createdAt: entry.createdAt });
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
    emitMyGuardians: emitMyGuardians,
    emitPendingRequests: emitPendingRequests,
    emitAdminOverview: emitAdminOverview,
    emitMyLiveLinks: emitMyLiveLinks
};
