package db

import (
	"database/sql"
	"fmt"
)

// InitDB creates the schema if it does not exist. Matches backend-v2 schema.
func InitDB(db *sql.DB) error {
	statements := []string{
		`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,
		`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,

		`CREATE TABLE IF NOT EXISTS users (
			id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			first_name    VARCHAR(50) NOT NULL,
			last_name     VARCHAR(50) NOT NULL,
			password_hash TEXT NOT NULL,
			role          VARCHAR(10) NOT NULL DEFAULT 'user',
			share_code    VARCHAR(6) UNIQUE NOT NULL,
			email         VARCHAR(255) DEFAULT NULL,
			mobile        VARCHAR(20) DEFAULT NULL,
			created_at    BIGINT NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile) WHERE mobile IS NOT NULL`,

		`CREATE TABLE IF NOT EXISTS "session" (
			"sid"    VARCHAR NOT NULL PRIMARY KEY,
			"sess"   JSON NOT NULL,
			"expire" TIMESTAMP(6) NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`,

	// Active sessions table for resilience (Phase 4)
	`CREATE TABLE IF NOT EXISTS active_sessions (
		user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		socket_id     VARCHAR(64),
		connected_at  BIGINT NOT NULL,
		last_update   BIGINT NOT NULL,
		last_latitude DOUBLE PRECISION,
		last_longitude DOUBLE PRECISION,
		last_speed    VARCHAR(20),
		battery_pct   INTEGER,
		online        BOOLEAN DEFAULT true,
		expires_at    BIGINT NOT NULL,
		created_at    BIGINT DEFAULT extract(epoch from now())::bigint
	)`,
	`CREATE INDEX IF NOT EXISTS idx_active_sessions_expires ON active_sessions(expires_at)`,
	`CREATE INDEX IF NOT EXISTS idx_active_sessions_online ON active_sessions(online)`,

		`CREATE TABLE IF NOT EXISTS rooms (
			id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			code       VARCHAR(6) UNIQUE NOT NULL,
			name       VARCHAR(50) NOT NULL,
			created_by UUID REFERENCES users(id),
			created_at BIGINT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS room_members (
			id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
			user_id UUID REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(room_id, user_id)
		)`,

		`CREATE TABLE IF NOT EXISTS contacts (
			id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			owner_id   UUID REFERENCES users(id) ON DELETE CASCADE,
			contact_id UUID REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(owner_id, contact_id)
		)`,

		`CREATE TABLE IF NOT EXISTS live_tokens (
			id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			token      VARCHAR(64) UNIQUE NOT NULL,
			user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
			expires_at BIGINT,
			created_at BIGINT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS guardianships (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			guardian_id UUID REFERENCES users(id) ON DELETE CASCADE,
			ward_id     UUID REFERENCES users(id) ON DELETE CASCADE,
			status      VARCHAR(10) NOT NULL DEFAULT 'pending',
			expires_at  BIGINT,
			created_at  BIGINT NOT NULL,
			UNIQUE(guardian_id, ward_id)
		)`,

		`CREATE TABLE IF NOT EXISTS position_history (
			id          BIGSERIAL PRIMARY KEY,
			user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			latitude    DOUBLE PRECISION NOT NULL,
			longitude   DOUBLE PRECISION NOT NULL,
			speed       REAL,
			accuracy    REAL,
			recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pos_history_user_time ON position_history (user_id, recorded_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_pos_history_recorded_at ON position_history (recorded_at)`,

		`CREATE INDEX IF NOT EXISTS idx_contacts_contact_id ON contacts(contact_id)`,
		`CREATE INDEX IF NOT EXISTS idx_live_tokens_expires ON live_tokens(expires_at) WHERE expires_at IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_guardianships_ward ON guardianships(ward_id)`,

		// Additional columns (ALTER for compatibility with V2)
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_latitude DOUBLE PRECISION`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_longitude DOUBLE PRECISION`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_speed TEXT`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_update BIGINT`,

		`ALTER TABLE room_members ADD COLUMN IF NOT EXISTS role VARCHAR(10) DEFAULT 'member'`,
		`ALTER TABLE room_members ADD COLUMN IF NOT EXISTS role_expires_at BIGINT`,

		`ALTER TABLE guardianships ADD COLUMN IF NOT EXISTS initiated_by VARCHAR(10) DEFAULT 'guardian'`,

		`CREATE TABLE IF NOT EXISTS room_admin_requests (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			room_code   VARCHAR(6) NOT NULL,
			user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
			expires_in  VARCHAR(10),
			created_at  BIGINT NOT NULL,
			UNIQUE(room_code, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS room_admin_votes (
			id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			room_code    VARCHAR(6) NOT NULL,
			requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
			voter_id     UUID REFERENCES users(id) ON DELETE CASCADE,
			vote         VARCHAR(10) NOT NULL,
			UNIQUE(room_code, requester_id, voter_id)
		)`,
	}

	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("schema init: %w", err)
		}
	}
	return nil
}
