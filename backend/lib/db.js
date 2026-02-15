var pg = require("pg");

var pool = null;

// ── Schema ──────────────────────────────────────────────────────────────────
var SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name    VARCHAR(50) NOT NULL,
    last_name     VARCHAR(50) NOT NULL,
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
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code       VARCHAR(6) UNIQUE NOT NULL,
    name       VARCHAR(50) NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS contacts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(owner_id, contact_id)
);

CREATE TABLE IF NOT EXISTS live_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token      VARCHAR(64) UNIQUE NOT NULL,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT,
    created_at BIGINT NOT NULL
);
`;

// ── Migration: drop old username-based tables ────────────────────────────────
var MIGRATION_SQL = `
DROP TABLE IF EXISTS live_tokens CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS room_members CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS users CASCADE;
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
    // Check if the old username-based schema exists and migrate if needed
    try {
        var colCheck = await p.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'username'"
        );
        if (colCheck.rows.length > 0) {
            // Old schema detected -- drop app tables (not session) and recreate
            await p.query(MIGRATION_SQL);
        }
    } catch (_) {
        // Table may not exist yet, which is fine
    }
    await p.query(SCHEMA_SQL);
    // Migration: add location columns if they don't exist
    await p.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_latitude DOUBLE PRECISION;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_longitude DOUBLE PRECISION;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_speed TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_update BIGINT;
    `);
}

/**
 * Load all persistent data from PostgreSQL into memory maps.
 * Returns { usersCache, shareCodes, emailIndex, mobileIndex, rooms, contacts, liveTokens }.
 */
async function loadAll() {
    var p = getPool();

    // Users
    var usersCache = {};
    var shareCodes = new Map();
    var emailIndex = new Map();
    var mobileIndex = new Map();
    var uRes = await p.query("SELECT id, first_name, last_name, password_hash, role, share_code, email, mobile, created_at, last_latitude, last_longitude, last_speed, last_update FROM users");
    for (var row of uRes.rows) {
        var uid = row.id;
        usersCache[uid] = {
            firstName: row.first_name || "",
            lastName: row.last_name || "",
            passwordHash: row.password_hash,
            role: row.role,
            shareCode: row.share_code,
            email: row.email || null,
            mobile: row.mobile || null,
            createdAt: Number(row.created_at),
            lastLatitude: row.last_latitude != null ? Number(row.last_latitude) : null,
            lastLongitude: row.last_longitude != null ? Number(row.last_longitude) : null,
            lastSpeed: row.last_speed || null,
            lastUpdate: row.last_update != null ? Number(row.last_update) : null
        };
        shareCodes.set(row.share_code, uid);
        if (row.email) emailIndex.set(row.email.toLowerCase(), uid);
        if (row.mobile) mobileIndex.set(row.mobile, uid);
    }

    // Rooms + members (join on rooms.id = room_members.room_id)
    var roomsMap = new Map();
    var rRes = await p.query("SELECT id, code, name, created_by, created_at FROM rooms");
    for (var rr of rRes.rows) {
        roomsMap.set(rr.code, {
            dbId: rr.id,
            name: rr.name,
            members: new Set(),
            createdBy: rr.created_by,
            createdAt: Number(rr.created_at)
        });
    }
    var mRes = await p.query("SELECT rm.room_id, rm.user_id, r.code FROM room_members rm JOIN rooms r ON r.id = rm.room_id");
    for (var mr of mRes.rows) {
        var room = roomsMap.get(mr.code);
        if (room) room.members.add(mr.user_id);
    }
    // Clean up rooms with 0 members (orphaned)
    for (var [code, rm] of roomsMap) {
        if (rm.members.size === 0) { roomsMap.delete(code); }
    }

    // Contacts
    var contactsMap = new Map();
    var cRes = await p.query("SELECT owner_id, contact_id FROM contacts");
    for (var cr of cRes.rows) {
        if (!contactsMap.has(cr.owner_id)) contactsMap.set(cr.owner_id, new Set());
        contactsMap.get(cr.owner_id).add(cr.contact_id);
    }

    // Live tokens (filter out expired)
    var liveTokensMap = new Map();
    var now = Date.now();
    var lRes = await p.query("SELECT token, user_id, expires_at, created_at FROM live_tokens");
    for (var lr of lRes.rows) {
        var expiresAt = lr.expires_at ? Number(lr.expires_at) : null;
        if (expiresAt && expiresAt <= now) continue; // skip expired
        liveTokensMap.set(lr.token, {
            userId: lr.user_id,
            expiresAt: expiresAt,
            createdAt: Number(lr.created_at)
        });
    }
    // Clean expired from DB
    await p.query("DELETE FROM live_tokens WHERE expires_at IS NOT NULL AND expires_at <= $1", [now]);

    return {
        usersCache: usersCache,
        shareCodes: shareCodes,
        emailIndex: emailIndex,
        mobileIndex: mobileIndex,
        rooms: roomsMap,
        contacts: contactsMap,
        liveTokens: liveTokensMap
    };
}

// ── User CRUD ───────────────────────────────────────────────────────────────
async function createUser(firstName, lastName, passwordHash, role, shareCode, createdAt, email, mobile) {
    var res = await getPool().query(
        "INSERT INTO users (first_name, last_name, password_hash, role, share_code, email, mobile, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [firstName, lastName, passwordHash, role, shareCode, email || null, mobile || null, createdAt]
    );
    return res.rows[0].id; // return the generated UUID
}

async function updateUserRole(userId, newRole) {
    await getPool().query("UPDATE users SET role = $1 WHERE id = $2", [newRole, userId]);
}

async function findUserByContact(value) {
    var res = await getPool().query(
        "SELECT id FROM users WHERE email = $1 OR mobile = $1 LIMIT 1",
        [value]
    );
    return res.rows.length > 0 ? res.rows[0].id : null;
}

async function findUserByEmail(email) {
    var res = await getPool().query(
        "SELECT id FROM users WHERE email = $1 LIMIT 1",
        [email]
    );
    return res.rows.length > 0 ? res.rows[0].id : null;
}

async function findUserByMobile(mobile) {
    var res = await getPool().query(
        "SELECT id FROM users WHERE mobile = $1 LIMIT 1",
        [mobile]
    );
    return res.rows.length > 0 ? res.rows[0].id : null;
}

// ── Location persistence ─────────────────────────────────────────────────────
async function updateUserLocation(userId, lat, lng, speed, timestamp) {
    await getPool().query(
        "UPDATE users SET last_latitude=$1, last_longitude=$2, last_speed=$3, last_update=$4 WHERE id=$5",
        [lat, lng, speed, timestamp, userId]
    );
}

// ── Room CRUD ───────────────────────────────────────────────────────────────
async function createRoom(code, name, createdByUserId, createdAt) {
    var res = await getPool().query(
        "INSERT INTO rooms (code, name, created_by, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [code, name, createdByUserId, createdAt]
    );
    return res.rows[0].id; // return the generated room UUID
}

async function addRoomMember(roomId, userId) {
    await getPool().query(
        "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [roomId, userId]
    );
}

async function removeRoomMember(roomId, userId) {
    await getPool().query(
        "DELETE FROM room_members WHERE room_id = $1 AND user_id = $2",
        [roomId, userId]
    );
}

async function deleteRoom(roomId) {
    await getPool().query("DELETE FROM rooms WHERE id = $1", [roomId]);
}

// ── Contact CRUD ────────────────────────────────────────────────────────────
async function addContact(ownerId, contactId) {
    await getPool().query(
        "INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [ownerId, contactId]
    );
}

async function removeContact(ownerId, contactId) {
    await getPool().query(
        "DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2",
        [ownerId, contactId]
    );
}

// ── Live Token CRUD ─────────────────────────────────────────────────────────
async function createLiveToken(token, userId, expiresAt, createdAt) {
    await getPool().query(
        "INSERT INTO live_tokens (token, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
        [token, userId, expiresAt, createdAt]
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
        "DELETE FROM rooms WHERE created_at < $1 AND id NOT IN (SELECT DISTINCT room_id FROM room_members)",
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
    updateUserLocation: updateUserLocation,
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
