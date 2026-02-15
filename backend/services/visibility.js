var cache = require("../cache");

// ── Visibility cache ────────────────────────────────────────────────────────
function invalidateVisibility(userId) { cache.visibilityCache.delete(userId); }
function invalidateVisibilityAll() { cache.visibilityCache.clear(); }

function getVisibleSet(userId) {
    if (cache.visibilityCache.has(userId)) return cache.visibilityCache.get(userId);
    var visible = new Set([userId]);
    for (var [, room] of cache.rooms) {
        if (room.members.has(userId)) {
            for (var member of room.members) visible.add(member);
        }
    }
    var userContacts = cache.contacts.get(userId);
    if (userContacts) { for (var c of userContacts) visible.add(c); }
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

module.exports = {
    setIo: setIo,
    invalidateVisibility: invalidateVisibility,
    invalidateVisibilityAll: invalidateVisibilityAll,
    getVisibleSet: getVisibleSet,
    canSee: canSee,
    getVisibleSockets: getVisibleSockets,
    emitToVisible: emitToVisible,
    emitToVisibleAndSelf: emitToVisibleAndSelf,
    sendVisibilityRefresh: sendVisibilityRefresh,
    sendVisibilityRefreshIfChanged: sendVisibilityRefreshIfChanged
};
