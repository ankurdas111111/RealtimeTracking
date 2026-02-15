// ── In-memory caches (loaded from PostgreSQL at startup) ────────────────────
var usersCache = {};         // userId (UUID) → { firstName, lastName, passwordHash, role, shareCode, email, mobile, createdAt }
var rooms = new Map();       // code → { dbId, name, members: Set<userId>, createdBy, createdAt }
var contacts = new Map();    // userId → Set<contactUserId>
var shareCodes = new Map();  // shareCode → userId
var liveTokens = new Map();  // token → { userId, expiresAt, createdAt }
var emailIndex = new Map();  // email (lowercase) → userId
var mobileIndex = new Map(); // mobile → userId

// ── Ephemeral in-memory state ───────────────────────────────────────────────
var watchTokens = new Map();
var activeUsers = new Map();
var offlineUsers = new Map();
var visibilityCache = new Map();
var lastVisibleSets = new Map();
var lastPositionAt = new Map();
var lastDbSaveAt = new Map();   // userId → timestamp of last DB position save

module.exports = {
    // Getters (return current reference)
    get usersCache() { return usersCache; },
    set usersCache(v) { usersCache = v; },
    get rooms() { return rooms; },
    set rooms(v) { rooms = v; },
    get contacts() { return contacts; },
    set contacts(v) { contacts = v; },
    get shareCodes() { return shareCodes; },
    set shareCodes(v) { shareCodes = v; },
    get liveTokens() { return liveTokens; },
    set liveTokens(v) { liveTokens = v; },
    get emailIndex() { return emailIndex; },
    set emailIndex(v) { emailIndex = v; },
    get mobileIndex() { return mobileIndex; },
    set mobileIndex(v) { mobileIndex = v; },
    watchTokens: watchTokens,
    activeUsers: activeUsers,
    offlineUsers: offlineUsers,
    visibilityCache: visibilityCache,
    lastVisibleSets: lastVisibleSets,
    lastPositionAt: lastPositionAt,
    lastDbSaveAt: lastDbSaveAt
};
