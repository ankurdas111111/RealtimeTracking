var cache = require("../cache");

/**
 * Check if actorUserId is allowed to manage safety features
 * (geofence, auto-SOS, check-in) for targetUserId.
 *
 * Returns true if:
 *   1. Actor is a global admin, OR
 *   2. Actor is a room admin in a room that contains both actor and target, OR
 *   3. Actor is an active guardian of the target.
 */
function canManage(actorUserId, targetUserId) {
    if (actorUserId === targetUserId) return true;

    // 1. Global admin can manage anyone
    var actorData = cache.usersCache[actorUserId];
    if (actorData && actorData.role === "admin") return true;

    // 2. Room admin can manage members of their rooms
    var now = Date.now();
    for (var entry of cache.roomMemberRoles.entries()) {
        var code = entry[0];
        var roleMap = entry[1];
        var room = cache.rooms.get(code);
        if (!room) continue;
        if (!room.members.has(actorUserId) || !room.members.has(targetUserId)) continue;
        var actorRole = roleMap.get(actorUserId);
        if (actorRole && actorRole.role === "admin") {
            if (!actorRole.expiresAt || actorRole.expiresAt > now) return true;
        }
    }

    // 3. Guardian can manage their ward
    var wards = cache.guardianships.get(actorUserId);
    if (wards) {
        var wardEntry = wards.get(targetUserId);
        if (wardEntry && wardEntry.status === "active") {
            if (!wardEntry.expiresAt || wardEntry.expiresAt > now) return true;
        }
    }

    return false;
}

/**
 * Get the set of user IDs that actorUserId can manage.
 * Used to populate the "Apply to" dropdown on the frontend.
 */
function getManageableUsers(actorUserId) {
    var result = new Set();
    result.add(actorUserId);

    var actorData = cache.usersCache[actorUserId];
    if (actorData && actorData.role === "admin") {
        // Global admin can manage everyone
        for (var uid in cache.usersCache) { result.add(uid); }
        return result;
    }

    var now = Date.now();

    // Room admin targets
    for (var entry of cache.roomMemberRoles.entries()) {
        var code = entry[0];
        var roleMap = entry[1];
        var room = cache.rooms.get(code);
        if (!room) continue;
        if (!room.members.has(actorUserId)) continue;
        var actorRole = roleMap.get(actorUserId);
        if (actorRole && actorRole.role === "admin" && (!actorRole.expiresAt || actorRole.expiresAt > now)) {
            for (var mid of room.members) { result.add(mid); }
        }
    }

    // Guardian wards
    var wards = cache.guardianships.get(actorUserId);
    if (wards) {
        for (var wardEntry of wards.entries()) {
            var wardId = wardEntry[0];
            var wardData = wardEntry[1];
            if (wardData.status === "active" && (!wardData.expiresAt || wardData.expiresAt > now)) {
                result.add(wardId);
            }
        }
    }

    return result;
}

module.exports = {
    canManage: canManage,
    getManageableUsers: getManageableUsers
};
