var pg = require("pg");

var log = null;
try { log = require("../config").log; } catch (_) { log = console; }

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

CREATE TABLE IF NOT EXISTS guardianships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guardian_id UUID REFERENCES users(id) ON DELETE CASCADE,
    ward_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(10) NOT NULL DEFAULT 'pending',
    expires_at  BIGINT,
    created_at  BIGINT NOT NULL,
    UNIQUE(guardian_id, ward_id)
);

CREATE TABLE IF NOT EXISTS position_history (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    speed       REAL,
    accuracy    REAL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_history_user_time ON position_history (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_history_recorded_at ON position_history (recorded_at);

CREATE INDEX IF NOT EXISTS idx_contacts_contact_id ON contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_live_tokens_expires ON live_tokens(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guardianships_ward ON guardianships(ward_id);
`;

// ── Migration: drop old username-based tables (legacy only, guarded) ─────────
var MIGRATION_SQL = `
DROP TABLE IF EXISTS live_tokens CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS room_members CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS users CASCADE;
`;
var MIGRATION_ENABLED = process.env.ALLOW_DESTRUCTIVE_MIGRATION === "true";

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
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        query_timeout: 10000,
        statement_timeout: 5000
    });
    pool.on("error", function(err) {
        log.error({ err: err.message }, "Unexpected PostgreSQL pool error");
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
            if (!MIGRATION_ENABLED) {
                console.error("[db] Old username-based schema detected. Set ALLOW_DESTRUCTIVE_MIGRATION=true to drop and recreate tables.");
                throw new Error("Destructive migration required but not enabled");
            }
            await p.query(MIGRATION_SQL);
        }
    } catch (e) {
        if (e.message === "Destructive migration required but not enabled") throw e;
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
    // Migration: add role columns to room_members
    await p.query(`
        ALTER TABLE room_members ADD COLUMN IF NOT EXISTS role VARCHAR(10) DEFAULT 'member';
        ALTER TABLE room_members ADD COLUMN IF NOT EXISTS role_expires_at BIGINT;
    `);
    // Migration: add initiated_by to guardianships
    await p.query(`
        ALTER TABLE guardianships ADD COLUMN IF NOT EXISTS initiated_by VARCHAR(10) DEFAULT 'guardian';
    `);
    // Migration: room_admin_requests table for persistent majority voting
    await p.query(`
        CREATE TABLE IF NOT EXISTS room_admin_requests (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            room_code   VARCHAR(6) NOT NULL,
            user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
            expires_in  VARCHAR(10),
            created_at  BIGINT NOT NULL,
            UNIQUE(room_code, user_id)
        );
        CREATE TABLE IF NOT EXISTS room_admin_votes (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            room_code   VARCHAR(6) NOT NULL,
            requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
            voter_id    UUID REFERENCES users(id) ON DELETE CASCADE,
            vote        VARCHAR(10) NOT NULL,
            UNIQUE(room_code, requester_id, voter_id)
        );
    `);
}

/**
 * Load all persistent data from PostgreSQL into memory maps.
 * Returns { usersCache, shareCodes, emailIndex, mobileIndex, rooms, contacts, liveTokens }.
 */
async function loadAll() {
    var p = getPool();
    var now = Date.now();

    // Run all independent SELECT queries in parallel (pure reads, no ordering constraints)
    var [uRes, rRes, mRes, cRes, lRes, gRes, raRes, vRes] = await Promise.all([
        p.query("SELECT id, first_name, last_name, role, share_code, email, mobile, created_at, last_latitude, last_longitude, last_speed, last_update FROM users"),
        p.query("SELECT id, code, name, created_by, created_at FROM rooms"),
        p.query("SELECT rm.room_id, rm.user_id, rm.role, rm.role_expires_at, r.code FROM room_members rm JOIN rooms r ON r.id = rm.room_id"),
        p.query("SELECT owner_id, contact_id FROM contacts"),
        p.query("SELECT token, user_id, expires_at, created_at FROM live_tokens"),
        p.query("SELECT guardian_id, ward_id, status, expires_at, created_at, initiated_by FROM guardianships WHERE status IN ('pending', 'active')"),
        p.query("SELECT room_code, user_id, expires_in, created_at FROM room_admin_requests"),
        p.query("SELECT room_code, requester_id, voter_id, vote FROM room_admin_votes")
    ]);

    // Users
    var usersCache = {};
    var shareCodes = new Map();
    var emailIndex = new Map();
    var mobileIndex = new Map();
    for (var row of uRes.rows) {
        var uid = row.id;
        usersCache[uid] = {
            firstName: row.first_name || "",
            lastName: row.last_name || "",
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

    // Rooms
    var roomsMap = new Map();
    for (var rr of rRes.rows) {
        roomsMap.set(rr.code, {
            dbId: rr.id,
            name: rr.name,
            members: new Set(),
            createdBy: rr.created_by,
            createdAt: Number(rr.created_at)
        });
    }

    // Room members + roles
    var roomMemberRoles = new Map();
    for (var mr of mRes.rows) {
        var room = roomsMap.get(mr.code);
        if (room) room.members.add(mr.user_id);
        if (!roomMemberRoles.has(mr.code)) roomMemberRoles.set(mr.code, new Map());
        roomMemberRoles.get(mr.code).set(mr.user_id, {
            role: mr.role || "member",
            expiresAt: mr.role_expires_at ? Number(mr.role_expires_at) : null
        });
    }
    // Clean up rooms with 0 members (orphaned)
    for (var [code, rm] of roomsMap) {
        if (rm.members.size === 0) { roomsMap.delete(code); }
    }

    // Contacts
    var contactsMap = new Map();
    for (var cr of cRes.rows) {
        if (!contactsMap.has(cr.owner_id)) contactsMap.set(cr.owner_id, new Set());
        contactsMap.get(cr.owner_id).add(cr.contact_id);
    }

    // Live tokens (filter out expired)
    var liveTokensMap = new Map();
    for (var lr of lRes.rows) {
        var expiresAt = lr.expires_at ? Number(lr.expires_at) : null;
        if (expiresAt && expiresAt <= now) continue; // skip expired
        liveTokensMap.set(lr.token, {
            userId: lr.user_id,
            expiresAt: expiresAt,
            createdAt: Number(lr.created_at)
        });
    }
    // Clean expired from DB (fire-and-forget; non-critical)
    p.query("DELETE FROM live_tokens WHERE expires_at IS NOT NULL AND expires_at <= $1", [now]).catch(function() {});

    // Guardianships
    var guardianshipsMap = new Map();
    for (var gr of gRes.rows) {
        if (!guardianshipsMap.has(gr.guardian_id)) guardianshipsMap.set(gr.guardian_id, new Map());
        guardianshipsMap.get(gr.guardian_id).set(gr.ward_id, {
            status: gr.status,
            expiresAt: gr.expires_at ? Number(gr.expires_at) : null,
            createdAt: Number(gr.created_at),
            initiatedBy: gr.initiated_by || "guardian"
        });
    }

    // Room admin requests
    var roomAdminRequests = new Map();
    for (var ra of raRes.rows) {
        var key = ra.room_code + ":roomAdmin";
        if (!roomAdminRequests.has(key)) roomAdminRequests.set(key, []);
        roomAdminRequests.get(key).push({
            type: "roomAdmin", from: ra.user_id, roomCode: ra.room_code,
            expiresIn: ra.expires_in || null, createdAt: Number(ra.created_at),
            approvals: new Set(), denials: new Set()
        });
    }

    // Room admin votes (attach to requests)
    for (var vr of vRes.rows) {
        var vKey = vr.room_code + ":roomAdmin";
        var reqs = roomAdminRequests.get(vKey) || [];
        var found = reqs.find(function(r) { return r.from === vr.requester_id; });
        if (found) {
            if (vr.vote === "approve") found.approvals.add(vr.voter_id);
            else if (vr.vote === "deny") found.denials.add(vr.voter_id);
        }
    }

    return {
        usersCache: usersCache,
        shareCodes: shareCodes,
        emailIndex: emailIndex,
        mobileIndex: mobileIndex,
        rooms: roomsMap,
        roomMemberRoles: roomMemberRoles,
        contacts: contactsMap,
        liveTokens: liveTokensMap,
        guardianships: guardianshipsMap,
        roomAdminRequests: roomAdminRequests
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

async function getUserPasswordHash(userId) {
    var res = await getPool().query({
        name: "get-user-password-hash",
        text: "SELECT password_hash FROM users WHERE id = $1",
        values: [userId]
    });
    return res.rows.length > 0 ? res.rows[0].password_hash : null;
}

async function findUserByContact(value) {
    var res = await getPool().query({
        name: "find-user-by-contact",
        text: "SELECT id FROM users WHERE email = $1 OR mobile = $1 LIMIT 1",
        values: [value]
    });
    return res.rows.length > 0 ? res.rows[0].id : null;
}

async function findUserByEmail(email) {
    var res = await getPool().query({
        name: "find-user-by-email",
        text: "SELECT id FROM users WHERE email = $1 LIMIT 1",
        values: [email]
    });
    return res.rows.length > 0 ? res.rows[0].id : null;
}

async function findUserByMobile(mobile) {
    var res = await getPool().query({
        name: "find-user-by-mobile",
        text: "SELECT id FROM users WHERE mobile = $1 LIMIT 1",
        values: [mobile]
    });
    return res.rows.length > 0 ? res.rows[0].id : null;
}

// ── Location persistence ─────────────────────────────────────────────────────
async function updateUserLocation(userId, lat, lng, speed, timestamp) {
    await getPool().query({
        name: "update-user-location",
        text: "UPDATE users SET last_latitude=$1, last_longitude=$2, last_speed=$3, last_update=$4 WHERE id=$5",
        values: [lat, lng, speed, timestamp, userId]
    });
}

// ── Room CRUD ───────────────────────────────────────────────────────────────
async function createRoom(code, name, createdByUserId, createdAt) {
    var res = await getPool().query(
        "INSERT INTO rooms (code, name, created_by, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [code, name, createdByUserId, createdAt]
    );
    return res.rows[0].id; // return the generated room UUID
}

async function addRoomMember(roomId, userId, role) {
    await getPool().query({
        name: "add-room-member",
        text: "INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO NOTHING",
        values: [roomId, userId, role || "member"]
    });
}

async function removeRoomMember(roomId, userId) {
    await getPool().query({
        name: "remove-room-member",
        text: "DELETE FROM room_members WHERE room_id = $1 AND user_id = $2",
        values: [roomId, userId]
    });
}

async function deleteRoom(roomId) {
    await getPool().query("DELETE FROM rooms WHERE id = $1", [roomId]);
}

// ── Contact CRUD ────────────────────────────────────────────────────────────
async function addContact(ownerId, contactId) {
    await getPool().query({
        name: "add-contact",
        text: "INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        values: [ownerId, contactId]
    });
}

async function addContactBidirectional(userA, userB) {
    var client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userA, userB]);
        await client.query("INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userB, userA]);
        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

async function removeContact(ownerId, contactId) {
    await getPool().query({
        name: "remove-contact",
        text: "DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2",
        values: [ownerId, contactId]
    });
}

async function removeContactBidirectional(userA, userB) {
    var client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2", [userA, userB]);
        await client.query("DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2", [userB, userA]);
        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
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

// ── Room member roles ────────────────────────────────────────────────────────
async function setRoomMemberRole(roomDbId, userId, role, expiresAt) {
    await getPool().query(
        "UPDATE room_members SET role = $1, role_expires_at = $2 WHERE room_id = $3 AND user_id = $4",
        [role, expiresAt || null, roomDbId, userId]
    );
}

async function expireRoomAdmins(now) {
    var res = await getPool().query(
        "UPDATE room_members SET role = 'member', role_expires_at = NULL WHERE role = 'admin' AND role_expires_at IS NOT NULL AND role_expires_at <= $1 RETURNING room_id, user_id",
        [now]
    );
    return res.rows;
}

// ── Guardianship CRUD ────────────────────────────────────────────────────────
async function createGuardianship(guardianId, wardId, status, expiresAt, createdAt, initiatedBy) {
    await getPool().query(
        "INSERT INTO guardianships (guardian_id, ward_id, status, expires_at, created_at, initiated_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (guardian_id, ward_id) DO UPDATE SET status = $3, expires_at = $4, initiated_by = COALESCE($6, guardianships.initiated_by)",
        [guardianId, wardId, status, expiresAt || null, createdAt, initiatedBy || "guardian"]
    );
}

async function updateGuardianshipStatus(guardianId, wardId, status) {
    await getPool().query(
        "UPDATE guardianships SET status = $1 WHERE guardian_id = $2 AND ward_id = $3",
        [status, guardianId, wardId]
    );
}

async function deleteGuardianship(guardianId, wardId) {
    await getPool().query(
        "DELETE FROM guardianships WHERE guardian_id = $1 AND ward_id = $2",
        [guardianId, wardId]
    );
}

async function expireGuardianships(now) {
    var res = await getPool().query(
        "UPDATE guardianships SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= $1 RETURNING guardian_id, ward_id",
        [now]
    );
    return res.rows;
}

// ── Room admin requests (persistent majority voting) ────────────────────────
async function createRoomAdminRequest(roomCode, userId, expiresIn, createdAt) {
    await getPool().query(
        "INSERT INTO room_admin_requests (room_code, user_id, expires_in, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (room_code, user_id) DO NOTHING",
        [roomCode, userId, expiresIn || null, createdAt]
    );
}

async function deleteRoomAdminRequest(roomCode, userId) {
    await getPool().query("DELETE FROM room_admin_requests WHERE room_code = $1 AND user_id = $2", [roomCode, userId]);
    await getPool().query("DELETE FROM room_admin_votes WHERE room_code = $1 AND requester_id = $2", [roomCode, userId]);
}

async function upsertRoomAdminVote(roomCode, requesterId, voterId, vote) {
    await getPool().query(
        "INSERT INTO room_admin_votes (room_code, requester_id, voter_id, vote) VALUES ($1, $2, $3, $4) ON CONFLICT (room_code, requester_id, voter_id) DO UPDATE SET vote = $4",
        [roomCode, requesterId, voterId, vote]
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

// ── Position history ────────────────────────────────────────────────────────
/**
 * Batch-insert position records into position_history.
 * Called asynchronously (off the hot path) every ~10 seconds.
 *
 * @param {Array<{userId:string, latitude:number, longitude:number, speed?:number, accuracy?:number}>} rows
 */
async function insertPositionHistory(rows) {
    if (!rows || rows.length === 0) return;
    var p = getPool();
    // Build a multi-row VALUES clause
    var values = [];
    var params = [];
    var idx = 1;
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        values.push("($" + idx + ", $" + (idx + 1) + ", $" + (idx + 2) + ", $" + (idx + 3) + ", $" + (idx + 4) + ")");
        params.push(r.userId, r.latitude, r.longitude, r.speed || null, r.accuracy || null);
        idx += 5;
    }
    var sql = "INSERT INTO position_history (user_id, latitude, longitude, speed, accuracy) VALUES " + values.join(", ");
    await p.query(sql, params);
}

/**
 * Delete position_history records older than the given number of days.
 *
 * @param {number} days  Retention period (default 7).
 */
async function purgePositionHistory(days) {
    var p = getPool();
    await p.query("DELETE FROM position_history WHERE recorded_at < NOW() - MAKE_INTERVAL(days => $1)", [days || 7]);
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
    getUserPasswordHash: getUserPasswordHash,
    findUserByContact: findUserByContact,
    findUserByEmail: findUserByEmail,
    findUserByMobile: findUserByMobile,
    updateUserLocation: updateUserLocation,
    createRoom: createRoom,
    addRoomMember: addRoomMember,
    removeRoomMember: removeRoomMember,
    deleteRoom: deleteRoom,
    addContact: addContact,
    addContactBidirectional: addContactBidirectional,
    removeContact: removeContact,
    removeContactBidirectional: removeContactBidirectional,
    createLiveToken: createLiveToken,
    deleteLiveToken: deleteLiveToken,
    deleteExpiredLiveTokens: deleteExpiredLiveTokens,
    deleteEmptyOldRooms: deleteEmptyOldRooms,
    setRoomMemberRole: setRoomMemberRole,
    expireRoomAdmins: expireRoomAdmins,
    createGuardianship: createGuardianship,
    updateGuardianshipStatus: updateGuardianshipStatus,
    deleteGuardianship: deleteGuardianship,
    expireGuardianships: expireGuardianships,
    createRoomAdminRequest: createRoomAdminRequest,
    deleteRoomAdminRequest: deleteRoomAdminRequest,
    upsertRoomAdminVote: upsertRoomAdminVote,
    getTableSizes: getTableSizes,
    insertPositionHistory: insertPositionHistory,
    purgePositionHistory: purgePositionHistory,
    closePool: closePool,
    getPool: getPool
};
