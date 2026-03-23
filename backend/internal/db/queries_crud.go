package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// CreateUser inserts a new user and returns the ID.
func CreateUser(ctx context.Context, db *sql.DB,
	firstName, lastName, passwordHash, role, shareCode string,
	createdAt int64, email, mobile *string) (string, error) {
	var id string
	em, mo := nullStr(email), nullStr(mobile)
	err := db.QueryRowContext(ctx,
		`INSERT INTO users (first_name, last_name, password_hash, role, share_code, email, mobile, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		firstName, lastName, passwordHash, role, shareCode, em, mo, createdAt).Scan(&id)
	return id, err
}

// GetUserPasswordHash returns the password hash for a user. Returns ("", nil) if user not found.
func GetUserPasswordHash(ctx context.Context, db *sql.DB, userID string) (string, error) {
	var h string
	err := db.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&h)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return h, err
}

// FindUserByEmail returns user ID for an email.
func FindUserByEmail(ctx context.Context, db *sql.DB, email string) (string, error) {
	var id string
	err := db.QueryRowContext(ctx, `SELECT id FROM users WHERE email = $1 LIMIT 1`, email).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return id, err
}

// FindUserByMobile returns user ID for a mobile.
func FindUserByMobile(ctx context.Context, db *sql.DB, mobile string) (string, error) {
	var id string
	err := db.QueryRowContext(ctx, `SELECT id FROM users WHERE mobile = $1 LIMIT 1`, mobile).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return id, err
}

// UpdateUserLocation updates last position for a user.
func UpdateUserLocation(ctx context.Context, db *sql.DB, userID string, lat, lng float64, speed string, timestamp int64) error {
	_, err := db.ExecContext(ctx,
		`UPDATE users SET last_latitude=$1, last_longitude=$2, last_speed=$3, last_update=$4 WHERE id=$5`,
		lat, lng, speed, timestamp, userID)
	return err
}

// CreateRoom inserts a room and returns the DB ID.
func CreateRoom(ctx context.Context, db *sql.DB, code, name, createdByUserID string, createdAt int64) (string, error) {
	var id string
	err := db.QueryRowContext(ctx,
		`INSERT INTO rooms (code, name, created_by, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
		code, name, createdByUserID, createdAt).Scan(&id)
	return id, err
}

// AddRoomMember adds a member to a room.
func AddRoomMember(ctx context.Context, db *sql.DB, roomID, userID, role string) error {
	if role == "" {
		role = "member"
	}
	_, err := db.ExecContext(ctx,
		`INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO NOTHING`,
		roomID, userID, role)
	return err
}

// RemoveRoomMember removes a member from a room.
func RemoveRoomMember(ctx context.Context, db *sql.DB, roomID, userID string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, userID)
	return err
}

// DeleteRoom deletes a room by ID.
func DeleteRoom(ctx context.Context, db *sql.DB, roomID string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM rooms WHERE id = $1`, roomID)
	return err
}

// AddContactBidirectional adds A->B and B->A contacts in a transaction.
func AddContactBidirectional(ctx context.Context, db *sql.DB, userA, userB string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx,
		`INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userA, userB)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userB, userA)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// RemoveContactBidirectional removes both directions in a transaction.
func RemoveContactBidirectional(ctx context.Context, db *sql.DB, userA, userB string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2`, userA, userB)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2`, userB, userA)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// CreateLiveToken inserts a live token.
func CreateLiveToken(ctx context.Context, db *sql.DB, token, userID string, expiresAt *int64, createdAt int64) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO live_tokens (token, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)`,
		token, userID, expiresAt, createdAt)
	return err
}

// DeleteLiveToken removes a live token.
func DeleteLiveToken(ctx context.Context, db *sql.DB, token string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM live_tokens WHERE token = $1`, token)
	return err
}

// DeleteExpiredLiveTokens removes expired tokens and returns deleted token strings.
func DeleteExpiredLiveTokens(ctx context.Context, db *sql.DB) ([]string, error) {
	now := time.Now().UnixMilli()
	rows, err := db.QueryContext(ctx,
		`DELETE FROM live_tokens WHERE expires_at IS NOT NULL AND expires_at <= $1 RETURNING token`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tokens []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, rows.Err()
}

// CreateGuardianship inserts or updates a guardianship.
func CreateGuardianship(ctx context.Context, db *sql.DB, guardianID, wardID, status string, expiresAt *int64, createdAt int64, initiatedBy string) error {
	if initiatedBy == "" {
		initiatedBy = "guardian"
	}
	_, err := db.ExecContext(ctx,
		`INSERT INTO guardianships (guardian_id, ward_id, status, expires_at, created_at, initiated_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (guardian_id, ward_id) DO UPDATE SET status = $3, expires_at = $4, initiated_by = COALESCE($6, guardianships.initiated_by)`,
		guardianID, wardID, status, expiresAt, createdAt, initiatedBy)
	return err
}

// UpdateGuardianshipStatus updates the status of a guardianship.
func UpdateGuardianshipStatus(ctx context.Context, db *sql.DB, guardianID, wardID, status string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE guardianships SET status = $1 WHERE guardian_id = $2 AND ward_id = $3`,
		status, guardianID, wardID)
	return err
}

// ExpireGuardianships expires active guardianships past their expiry.
func ExpireGuardianships(ctx context.Context, db *sql.DB, now int64) ([]struct{ GuardianID, WardID string }, error) {
	rows, err := db.QueryContext(ctx,
		`UPDATE guardianships SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= $1
		 RETURNING guardian_id, ward_id`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct{ GuardianID, WardID string }
	for rows.Next() {
		var g, w string
		if err := rows.Scan(&g, &w); err != nil {
			return nil, err
		}
		out = append(out, struct{ GuardianID, WardID string }{g, w})
	}
	return out, rows.Err()
}

// SetRoomMemberRole sets role and expiry for a room member.
func SetRoomMemberRole(ctx context.Context, db *sql.DB, roomDbID, userID, role string, expiresAt *int64) error {
	_, err := db.ExecContext(ctx,
		`UPDATE room_members SET role = $1, role_expires_at = $2 WHERE room_id = $3 AND user_id = $4`,
		role, expiresAt, roomDbID, userID)
	return err
}

// ExpireRoomAdmins demotes expired room admins.
func ExpireRoomAdmins(ctx context.Context, db *sql.DB, now int64) ([]struct{ RoomID, UserID string }, error) {
	rows, err := db.QueryContext(ctx,
		`UPDATE room_members SET role = 'member', role_expires_at = NULL WHERE role = 'admin' AND role_expires_at IS NOT NULL AND role_expires_at <= $1
		 RETURNING room_id, user_id`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct{ RoomID, UserID string }
	for rows.Next() {
		var r, u string
		if err := rows.Scan(&r, &u); err != nil {
			return nil, err
		}
		out = append(out, struct{ RoomID, UserID string }{r, u})
	}
	return out, rows.Err()
}

// CreateRoomAdminRequest inserts a room admin request.
func CreateRoomAdminRequest(ctx context.Context, db *sql.DB, roomCode, userID string, expiresIn *string, createdAt int64) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO room_admin_requests (room_code, user_id, expires_in, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (room_code, user_id) DO NOTHING`,
		roomCode, userID, expiresIn, createdAt)
	return err
}

// DeleteRoomAdminRequest removes a room admin request and its votes.
func DeleteRoomAdminRequest(ctx context.Context, db *sql.DB, roomCode, userID string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `DELETE FROM room_admin_requests WHERE room_code = $1 AND user_id = $2`, roomCode, userID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM room_admin_votes WHERE room_code = $1 AND requester_id = $2`, roomCode, userID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// UpsertRoomAdminVote inserts or updates a vote.
func UpsertRoomAdminVote(ctx context.Context, db *sql.DB, roomCode, requesterID, voterID, vote string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO room_admin_votes (room_code, requester_id, voter_id, vote) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (room_code, requester_id, voter_id) DO UPDATE SET vote = $4`,
		roomCode, requesterID, voterID, vote)
	return err
}

// PositionHistoryRow is a single row for batch insert.
type PositionHistoryRow struct {
	UserID    string
	Latitude  float64
	Longitude float64
	Speed     *float64
	Accuracy  *float64
}

// InsertPositionHistory bulk inserts position history rows in a single query.
func InsertPositionHistory(ctx context.Context, db *sql.DB, rows []PositionHistoryRow) error {
	if len(rows) == 0 {
		return nil
	}
	// Build: INSERT INTO position_history (...) VALUES ($1,$2,$3,$4,$5),($6,$7,...)
	args := make([]interface{}, 0, len(rows)*5)
	sb := strings.Builder{}
	sb.WriteString(`INSERT INTO position_history (user_id, latitude, longitude, speed, accuracy) VALUES `)
	for i, r := range rows {
		if i > 0 {
			sb.WriteByte(',')
		}
		base := i * 5
		fmt.Fprintf(&sb, "($%d,$%d,$%d,$%d,$%d)", base+1, base+2, base+3, base+4, base+5)
		args = append(args, r.UserID, r.Latitude, r.Longitude, r.Speed, r.Accuracy)
	}
	_, err := db.ExecContext(ctx, sb.String(), args...)
	return err
}

// PurgePositionHistory deletes records older than the given days.
func PurgePositionHistory(ctx context.Context, db *sql.DB, days int) error {
	_, err := db.ExecContext(ctx,
		`DELETE FROM position_history WHERE recorded_at < NOW() - MAKE_INTERVAL(days => $1)`, days)
	return err
}

// DeleteEmptyOldRooms deletes empty rooms older than maxAgeMs.
func DeleteEmptyOldRooms(ctx context.Context, db *sql.DB, maxAgeMs int64) error {
	cutoff := time.Now().UnixMilli() - maxAgeMs
	_, err := db.ExecContext(ctx,
		`DELETE FROM rooms WHERE created_at < $1 AND id NOT IN (SELECT DISTINCT room_id FROM room_members)`, cutoff)
	return err
}

// TableSize represents a table's size info.
type TableSize struct {
	Table string
	Size  string
	Rows  int64
}

// GetTableSizes returns table sizes and total DB size.
func GetTableSizes(ctx context.Context, db *sql.DB) (tables []TableSize, totalSize string, err error) {
	rows, err := db.QueryContext(ctx,
		`SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size, n_live_tup AS rows
		 FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	for rows.Next() {
		var t TableSize
		if err := rows.Scan(&t.Table, &t.Size, &t.Rows); err != nil {
			return nil, "", err
		}
		tables = append(tables, t)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	err = db.QueryRowContext(ctx, `SELECT pg_size_pretty(pg_database_size(current_database())) AS total`).Scan(&totalSize)
	if err != nil {
		return nil, "", err
	}
	return tables, totalSize, nil
}

// UpdateUserRole updates a user's role in the database.
func UpdateUserRole(ctx context.Context, db *sql.DB, userID, newRole string) error {
	_, err := db.ExecContext(ctx, `UPDATE users SET role = $1 WHERE id = $2`, newRole, userID)
	return err
}

func nullStr(p *string) interface{} {
	if p != nil {
		return *p
	}
	return nil
}
