var pg = require("pg");

var pool = null;

// ── Schema ──────────────────────────────────────────────────────────────────
var SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    username      VARCHAR(20) PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role          VARCHAR(10) NOT NULL DEFAULT 'user',
    share_code    VARCHAR(6) UNIQUE NOT NULL,
    email         VARCHAR(255) DEFAULT NULL,
    mobile        VARCHAR(20) DEFAULT NULL,
    created_at    BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile) WHERE mobile IS NOT NULL;

CREATE TABLE IF NOT EXISTS "session" (
    "sid"    VARCHAR NOT NULL PRIMARY KEY,
    "sess"   JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

CREATE TABLE IF NOT EXISTS rooms (
    code       VARCHAR(6) PRIMARY KEY,
    name       VARCHAR(50) NOT NULL,
    created_by VARCHAR(20) REFERENCES users(username),
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
    room_code VARCHAR(6) REFERENCES rooms(code) ON DELETE CASCADE,
    username  VARCHAR(20) REFERENCES users(username) ON DELETE CASCADE,
    PRIMARY KEY (room_code, username)
);

CREATE TABLE IF NOT EXISTS contacts (
    owner_username   VARCHAR(20) REFERENCES users(username) ON DELETE CASCADE,
    contact_username VARCHAR(20) REFERENCES users(username) ON DELETE CASCADE,
    PRIMARY KEY (owner_username, contact_username)
);

CREATE TABLE IF NOT EXISTS live_tokens (
    token      VARCHAR(64) PRIMARY KEY,
    username   VARCHAR(20) REFERENCES users(username) ON DELETE CASCADE,
    expires_at BIGINT,
    created_at BIGINT NOT NULL
);
`;

// ── Pool management ─────────────────────────────────────────────────────────
function getPool() {
    if (pool) return pool;
    var connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL environment variable is required");
    // Strip sslmode from the URL -- pg library treats sslmode=require as verify-full
    // which rejects self-signed certs from managed DBs (Aiven, Supabase, etc.)
    var cleanUrl = connectionString.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
    var isRemoteDb = cleanUrl.includes("@") && !cleanUrl.includes("localhost") && !cleanUrl.includes("127.0.0.1");
    var sslConfig = isRemoteDb ? { rejectUnauthorized: false } : false;
    pool = new pg.Pool({
        connectionString: cleanUrl,
        ssl: sslConfig,
        max: 5, // Render free tier has limited connections
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
    pool.on("error", function(err) {
        console.error("Unexpected PostgreSQL pool error:", err.message);
    });
    return pool;
}

// ── Initialisation ──────────────────────────────────────────────────────────
async function initDb() {
    var p = getPool();
    await p.query(SCHEMA_SQL);
}

/**
 * Load all persistent data from PostgreSQL into memory maps.
 * Returns { usersCache, shareCodes, rooms, contacts, liveTokens }.
 */
async function loadAll() {
    var p = getPool();

    // Users
    var usersCache = {};
    var shareCodes = new Map();
    var uRes = await p.query("SELECT username, password_hash, role, share_code, email, mobile, created_at FROM users");
    for (var row of uRes.rows) {
        usersCache[row.username] = {
            passwordHash: row.password_hash,
            role: row.role,
            shareCode: row.share_code,
            email: row.email || null,
            mobile: row.mobile || null,
            createdAt: Number(row.created_at)
        };
        shareCodes.set(row.share_code, row.username);
    }

    // Rooms + members
    var roomsMap = new Map();
    var rRes = await p.query("SELECT code, name, created_by, created_at FROM rooms");
    for (var rr of rRes.rows) {
        roomsMap.set(rr.code, {
            name: rr.name,
            members: new Set(),
            createdBy: rr.created_by,
            createdAt: Number(rr.created_at)
        });
    }
    var mRes = await p.query("SELECT room_code, username FROM room_members");
    for (var mr of mRes.rows) {
        var room = roomsMap.get(mr.room_code);
        if (room) room.members.add(mr.username);
    }
    // Clean up rooms with 0 members (orphaned)
    for (var [code, rm] of roomsMap) {
        if (rm.members.size === 0) { roomsMap.delete(code); }
    }

    // Contacts
    var contactsMap = new Map();
    var cRes = await p.query("SELECT owner_username, contact_username FROM contacts");
    for (var cr of cRes.rows) {
        if (!contactsMap.has(cr.owner_username)) contactsMap.set(cr.owner_username, new Set());
        contactsMap.get(cr.owner_username).add(cr.contact_username);
    }

    // Live tokens (filter out expired)
    var liveTokensMap = new Map();
    var now = Date.now();
    var lRes = await p.query("SELECT token, username, expires_at, created_at FROM live_tokens");
    for (var lr of lRes.rows) {
        var expiresAt = lr.expires_at ? Number(lr.expires_at) : null;
        if (expiresAt && expiresAt <= now) continue; // skip expired
        liveTokensMap.set(lr.token, {
            username: lr.username,
            expiresAt: expiresAt,
            createdAt: Number(lr.created_at)
        });
    }
    // Clean expired from DB
    await p.query("DELETE FROM live_tokens WHERE expires_at IS NOT NULL AND expires_at <= $1", [now]);

    return {
        usersCache: usersCache,
        shareCodes: shareCodes,
        rooms: roomsMap,
        contacts: contactsMap,
        liveTokens: liveTokensMap
    };
}

// ── User CRUD ───────────────────────────────────────────────────────────────
async function createUser(username, passwordHash, role, shareCode, createdAt, email, mobile) {
    await getPool().query(
        "INSERT INTO users (username, password_hash, role, share_code, email, mobile, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [username, passwordHash, role, shareCode, email || null, mobile || null, createdAt]
    );
}

async function updateUserRole(username, newRole) {
    await getPool().query("UPDATE users SET role = $1 WHERE username = $2", [newRole, username]);
}

async function findUserByContact(value) {
    var res = await getPool().query(
        "SELECT username FROM users WHERE email = $1 OR mobile = $1 LIMIT 1",
        [value]
    );
    return res.rows.length > 0 ? res.rows[0].username : null;
}

async function findUserByEmail(email) {
    var res = await getPool().query(
        "SELECT username FROM users WHERE email = $1 LIMIT 1",
        [email]
    );
    return res.rows.length > 0 ? res.rows[0].username : null;
}

async function findUserByMobile(mobile) {
    var res = await getPool().query(
        "SELECT username FROM users WHERE mobile = $1 LIMIT 1",
        [mobile]
    );
    return res.rows.length > 0 ? res.rows[0].username : null;
}

// ── Room CRUD ───────────────────────────────────────────────────────────────
async function createRoom(code, name, createdBy, createdAt) {
    await getPool().query(
        "INSERT INTO rooms (code, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
        [code, name, createdBy, createdAt]
    );
}

async function addRoomMember(roomCode, username) {
    await getPool().query(
        "INSERT INTO room_members (room_code, username) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [roomCode, username]
    );
}

async function removeRoomMember(roomCode, username) {
    await getPool().query(
        "DELETE FROM room_members WHERE room_code = $1 AND username = $2",
        [roomCode, username]
    );
}

async function deleteRoom(code) {
    await getPool().query("DELETE FROM rooms WHERE code = $1", [code]);
}

// ── Contact CRUD ────────────────────────────────────────────────────────────
async function addContact(ownerUsername, contactUsername) {
    await getPool().query(
        "INSERT INTO contacts (owner_username, contact_username) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [ownerUsername, contactUsername]
    );
}

async function removeContact(ownerUsername, contactUsername) {
    await getPool().query(
        "DELETE FROM contacts WHERE owner_username = $1 AND contact_username = $2",
        [ownerUsername, contactUsername]
    );
}

// ── Live Token CRUD ─────────────────────────────────────────────────────────
async function createLiveToken(token, username, expiresAt, createdAt) {
    await getPool().query(
        "INSERT INTO live_tokens (token, username, expires_at, created_at) VALUES ($1, $2, $3, $4)",
        [token, username, expiresAt, createdAt]
    );
}

async function deleteLiveToken(token) {
    await getPool().query("DELETE FROM live_tokens WHERE token = $1", [token]);
}

async function deleteExpiredLiveTokens() {
    var res = await getPool().query(
        "DELETE FROM live_tokens WHERE expires_at IS NOT NULL AND expires_at <= $1 RETURNING token",
        [Date.now()]
    );
    return res.rows.map(function(r) { return r.token; });
}

async function deleteEmptyOldRooms(maxAgeMs) {
    // Delete rooms that have 0 members and are older than maxAgeMs
    await getPool().query(
        "DELETE FROM rooms WHERE created_at < $1 AND code NOT IN (SELECT DISTINCT room_code FROM room_members)",
        [Date.now() - maxAgeMs]
    );
}

// ── Storage monitoring ──────────────────────────────────────────────────────
async function getTableSizes() {
    var p = getPool();
    var tablesRes = await p.query(
        "SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC"
    );
    var totalRes = await p.query(
        "SELECT pg_size_pretty(pg_database_size(current_database())) AS total"
    );
    return { tables: tablesRes.rows, totalSize: totalRes.rows[0].total };
}

// ── Pool shutdown ───────────────────────────────────────────────────────────
async function closePool() {
    if (pool) { await pool.end(); pool = null; }
}

module.exports = {
    initDb: initDb,
    loadAll: loadAll,
    createUser: createUser,
    updateUserRole: updateUserRole,
    findUserByContact: findUserByContact,
    findUserByEmail: findUserByEmail,
    findUserByMobile: findUserByMobile,
    createRoom: createRoom,
    addRoomMember: addRoomMember,
    removeRoomMember: removeRoomMember,
    deleteRoom: deleteRoom,
    addContact: addContact,
    removeContact: removeContact,
    createLiveToken: createLiveToken,
    deleteLiveToken: deleteLiveToken,
    deleteExpiredLiveTokens: deleteExpiredLiveTokens,
    deleteEmptyOldRooms: deleteEmptyOldRooms,
    getTableSizes: getTableSizes,
    closePool: closePool,
    getPool: getPool
};
