var cache = require("../cache");

// ── Visibility cache ────────────────────────────────────────────────────────
function invalidateVisibility(userId) { cache.visibilityCache.delete(userId); }
function invalidateVisibilityAll() { cache.visibilityCache.clear(); }

/**
 * Targeted invalidation: only clears cached visibility for the given set of user IDs
 * plus any user whose cached visible set includes one of them.
 * Far cheaper than a full clear when a single room/contact changes.
 */
function invalidateVisibilityForUsers(userIds) {
    for (var i = 0; i < userIds.length; i++) {
        cache.visibilityCache.delete(userIds[i]);
    }
    // Also invalidate anyone whose cached set references one of these users
    var affectedSet = new Set(userIds);
    for (var [uid, visSet] of cache.visibilityCache) {
        for (var vid of affectedSet) {
            if (visSet.has(vid)) { cache.visibilityCache.delete(uid); break; }
        }
    }
}

function getVisibleSet(userId) {
    if (cache.visibilityCache.has(userId)) return cache.visibilityCache.get(userId);
    var visible = new Set([userId]);
    // Room members: see everyone in shared rooms
    for (var [, room] of cache.rooms) {
        if (room.members.has(userId)) {
            for (var member of room.members) visible.add(member);
        }
    }
    // You see people who added YOU as a contact (they shared their location with you)
    for (var entry of cache.contacts) {
        if (entry[1].has(userId)) visible.add(entry[0]);
    }
    cache.visibilityCache.set(userId, visible);
    return visible;
}

function canSee(viewerUserId, targetUserId) {
    if (viewerUserId === targetUserId) return true;
    var viewerData = cache.usersCache[viewerUserId];
    if (viewerData && viewerData.role === "admin") return true;
    return getVisibleSet(viewerUserId).has(targetUserId);
}

function getVisibleSockets(targetUser) {
    var viewers = new Set();
    var targetId = targetUser.userId;
    for (var [sid, u] of cache.activeUsers) {
        if (sid === targetUser.socketId) continue;
        if (canSee(u.userId, targetId)) viewers.add(sid);
    }
    return viewers;
}

// io reference, set via setIo()
var _io = null;
function setIo(io) { _io = io; }

function emitToVisible(targetUser, event, data) {
    for (var sid of getVisibleSockets(targetUser)) { _io.to(sid).emit(event, data); }
}

function emitToVisibleAndSelf(targetUser, event, data) {
    _io.to(targetUser.socketId).emit(event, data);
    emitToVisible(targetUser, event, data);
}

// ── Visibility refresh (with diff-skip optimisation) ────────────────────────
var emitters = null;
function _emitters() {
    if (!emitters) emitters = require("./emitters");
    return emitters;
}

function sendVisibilityRefresh(socket, user) {
    var sanitizeUser = _emitters().sanitizeUser;
    var allUsers = [
        ...Array.from(cache.activeUsers.values()).map(function(u) { return { ...sanitizeUser(u), online: true }; }),
        ...Array.from(cache.offlineUsers.values()).map(function(e) { return { ...sanitizeUser(e.user), online: false, offlineExpiresAt: e.expiresAt }; })
    ];
    socket.emit("visibilityRefresh", allUsers.filter(function(u) { return canSee(user.userId, u.userId); }));
}

function sendVisibilityRefreshIfChanged(socket, user) {
    var currentVisible = getVisibleSet(user.userId);
    var lastSet = cache.lastVisibleSets.get(socket.id);
    if (lastSet && lastSet.size === currentVisible.size) {
        var changed = false;
        for (var name of currentVisible) {
            if (!lastSet.has(name)) { changed = true; break; }
        }
        if (!changed) return;
    }
    cache.lastVisibleSets.set(socket.id, new Set(currentVisible));
    sendVisibilityRefresh(socket, user);
}

// ── Batched visibility refresh ──────────────────────────────────────────────
// Deduplicates refresh requests: if a socket is already queued, skip it.
var _pendingVisRefresh = new Map(); // socketId → { socket, user }
var _visRefreshScheduled = false;

function scheduleVisibilityRefresh(socket, user) {
    if (!_pendingVisRefresh.has(socket.id)) {
        _pendingVisRefresh.set(socket.id, { socket: socket, user: user });
    }
    if (!_visRefreshScheduled) {
        _visRefreshScheduled = true;
        setImmediate(flushVisibilityRefreshes);
    }
}

function flushVisibilityRefreshes() {
    _visRefreshScheduled = false;
    var batch = _pendingVisRefresh;
    _pendingVisRefresh = new Map();
    for (var entry of batch.values()) {
        sendVisibilityRefreshIfChanged(entry.socket, entry.user);
    }
}

// ── Batched position broadcasts ─────────────────────────────────────────────
// Accumulates position updates briefly, then fans out once per tick.
var _pendingPositions = new Map(); // socketId → { user, data }
var _positionBatchTimer = null;
var BATCH_INTERVAL_MS = 40;

function queuePositionBroadcast(user, data) {
    _pendingPositions.set(user.socketId, { user: user, data: data });
    if (!_positionBatchTimer) {
        _positionBatchTimer = setTimeout(flushPositionBroadcasts, BATCH_INTERVAL_MS);
    }
}

function flushPositionBroadcasts() {
    _positionBatchTimer = null;
    var batch = _pendingPositions;
    _pendingPositions = new Map();
    for (var entry of batch.values()) {
        emitToVisible(entry.user, "userUpdate", entry.data);
    }
}

module.exports = {
    setIo: setIo,
    invalidateVisibility: invalidateVisibility,
    invalidateVisibilityAll: invalidateVisibilityAll,
    invalidateVisibilityForUsers: invalidateVisibilityForUsers,
    getVisibleSet: getVisibleSet,
    canSee: canSee,
    getVisibleSockets: getVisibleSockets,
    emitToVisible: emitToVisible,
    emitToVisibleAndSelf: emitToVisibleAndSelf,
    sendVisibilityRefresh: sendVisibilityRefresh,
    sendVisibilityRefreshIfChanged: sendVisibilityRefreshIfChanged,
    scheduleVisibilityRefresh: scheduleVisibilityRefresh,
    queuePositionBroadcast: queuePositionBroadcast
};
