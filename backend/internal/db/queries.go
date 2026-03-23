package db

import (
	"context"
	"database/sql"
	"strings"
	"sync"
	"time"
)

// LoadAll loads all persistent data from the DB in parallel.
func LoadAll(ctx context.Context, db *sql.DB) (*LoadAllResult, error) {
	var (
		usersCache       map[string]*UserCacheEntry
		shareCodes       map[string]string
		emailIndex       map[string]string
		mobileIndex      map[string]string
		rooms            map[string]*RoomEntry
		roomMemberRoles  map[string]map[string]*RoomMemberRole
		contacts         map[string]map[string]bool
		liveTokens       map[string]*LiveTokenEntry
		guardianships    map[string]map[string]*GuardianshipEntry
		roomAdminReqs    map[string][]*RoomAdminRequestEntry
		loadErr          error
	)

	now := time.Now().UnixMilli()

	var wg sync.WaitGroup
	mu := sync.Mutex{}
	setErr := func(err error) {
		if err != nil {
			mu.Lock()
			if loadErr == nil {
				loadErr = err
			}
			mu.Unlock()
		}
	}

	wg.Add(1)
	go func() {
		defer wg.Done()
		rows, err := db.QueryContext(ctx,
			`SELECT id, first_name, last_name, role, share_code, email, mobile, created_at,
				last_latitude, last_longitude, last_speed, last_update FROM users`)
		if err != nil {
			setErr(err)
			return
		}
		defer rows.Close()
		uc := make(map[string]*UserCacheEntry)
		sc := make(map[string]string)
		ei := make(map[string]string)
		mi := make(map[string]string)
		for rows.Next() {
			var id, fn, ln, role, shareCode string
			var email, mobile sql.NullString
			var ca int64
			var lastLat, lastLng sql.NullFloat64
			var lastSpeed sql.NullString
			var lastUpdate sql.NullInt64
			if err := rows.Scan(&id, &fn, &ln, &role, &shareCode, &email, &mobile, &ca,
				&lastLat, &lastLng, &lastSpeed, &lastUpdate); err != nil {
				setErr(err)
				return
			}
			uc[id] = &UserCacheEntry{
				FirstName:  fn,
				LastName:   ln,
				Role:       role,
				ShareCode:  shareCode,
				Email:      ptrOrNull(email),
				Mobile:     ptrOrNull(mobile),
				CreatedAt:  ca,
				LastLat:    floatOrNull(lastLat),
				LastLng:    floatOrNull(lastLng),
				LastSpeed:  strOrNull(lastSpeed),
				LastUpdate: int64OrNull(lastUpdate),
			}
			sc[shareCode] = id
			if email.Valid && email.String != "" {
				ei[lower(email.String)] = id
			}
			if mobile.Valid && mobile.String != "" {
				mi[mobile.String] = id
			}
		}
		usersCache = uc
		shareCodes = sc
		emailIndex = ei
		mobileIndex = mi
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		rm := make(map[string]*RoomEntry)
		rmr := make(map[string]map[string]*RoomMemberRole)

		roomRows, err := db.QueryContext(ctx,
			`SELECT id, code, name, created_by, created_at FROM rooms`)
		if err != nil {
			setErr(err)
			return
		}
		for roomRows.Next() {
			var dbId, code, name, createdBy string
			var ca int64
			if err := roomRows.Scan(&dbId, &code, &name, &createdBy, &ca); err != nil {
				roomRows.Close()
				setErr(err)
				return
			}
			rm[code] = &RoomEntry{
				DbID:      dbId,
				Name:      name,
				Members:   make(map[string]bool),
				CreatedBy: createdBy,
				CreatedAt: ca,
			}
		}
		roomRows.Close()

		memberRows, err := db.QueryContext(ctx,
			`SELECT rm.room_id, rm.user_id, rm.role, rm.role_expires_at, r.code
			 FROM room_members rm JOIN rooms r ON r.id = rm.room_id`)
		if err != nil {
			setErr(err)
			return
		}
		defer memberRows.Close()
		for memberRows.Next() {
			var roomId, userId, role, code string
			var expiresAt sql.NullInt64
			if err := memberRows.Scan(&roomId, &userId, &role, &expiresAt, &code); err != nil {
				setErr(err)
				return
			}
			if room, ok := rm[code]; ok {
				room.Members[userId] = true
			}
			if rmr[code] == nil {
				rmr[code] = make(map[string]*RoomMemberRole)
			}
			rmr[code][userId] = &RoomMemberRole{
				Role:      coalesceStr(role, "member"),
				ExpiresAt: int64OrNull(expiresAt),
			}
		}

		// Drop rooms with 0 members
		for code, re := range rm {
			if len(re.Members) == 0 {
				delete(rm, code)
			}
		}
		rooms = rm
		roomMemberRoles = rmr
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		rows, err := db.QueryContext(ctx, `SELECT owner_id, contact_id FROM contacts`)
		if err != nil {
			setErr(err)
			return
		}
		defer rows.Close()
		ct := make(map[string]map[string]bool)
		for rows.Next() {
			var ownerId, contactId string
			if err := rows.Scan(&ownerId, &contactId); err != nil {
				setErr(err)
				return
			}
			if ct[ownerId] == nil {
				ct[ownerId] = make(map[string]bool)
			}
			ct[ownerId][contactId] = true
		}
		contacts = ct
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		rows, err := db.QueryContext(ctx,
			`SELECT token, user_id, expires_at, created_at FROM live_tokens`)
		if err != nil {
			setErr(err)
			return
		}
		defer rows.Close()
		lt := make(map[string]*LiveTokenEntry)
		for rows.Next() {
			var token, userId string
			var expiresAt sql.NullInt64
			var ca int64
			if err := rows.Scan(&token, &userId, &expiresAt, &ca); err != nil {
				setErr(err)
				return
			}
			exp := int64OrNull(expiresAt)
			if exp != nil && *exp <= now {
				continue
			}
			lt[token] = &LiveTokenEntry{UserID: userId, ExpiresAt: exp, CreatedAt: ca}
		}
		liveTokens = lt
		// Fire-and-forget cleanup of expired tokens
		go func() {
			_, _ = db.ExecContext(context.Background(),
				`DELETE FROM live_tokens WHERE expires_at IS NOT NULL AND expires_at <= $1`, now)
		}()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		rows, err := db.QueryContext(ctx,
			`SELECT guardian_id, ward_id, status, expires_at, created_at, initiated_by
			 FROM guardianships WHERE status IN ('pending', 'active')`)
		if err != nil {
			setErr(err)
			return
		}
		defer rows.Close()
		gs := make(map[string]map[string]*GuardianshipEntry)
		for rows.Next() {
			var gId, wId, status, initiatedBy string
			var expiresAt sql.NullInt64
			var ca int64
			if err := rows.Scan(&gId, &wId, &status, &expiresAt, &ca, &initiatedBy); err != nil {
				setErr(err)
				return
			}
			if gs[gId] == nil {
				gs[gId] = make(map[string]*GuardianshipEntry)
			}
			gs[gId][wId] = &GuardianshipEntry{
				Status:      status,
				InitiatedBy: coalesceStr(initiatedBy, "guardian"),
				ExpiresAt:   int64OrNull(expiresAt),
				CreatedAt:   ca,
			}
		}
		guardianships = gs
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		rar := make(map[string][]*RoomAdminRequestEntry)
		reqRows, err := db.QueryContext(ctx,
			`SELECT room_code, user_id, expires_in, created_at FROM room_admin_requests`)
		if err != nil {
			setErr(err)
			return
		}
		for reqRows.Next() {
			var roomCode, userId string
			var expiresIn sql.NullString
			var ca int64
			if err := reqRows.Scan(&roomCode, &userId, &expiresIn, &ca); err != nil {
				reqRows.Close()
				setErr(err)
				return
			}
			key := roomCode + ":roomAdmin"
			rar[key] = append(rar[key], &RoomAdminRequestEntry{
				Type:      "roomAdmin",
				From:      userId,
				RoomCode:  roomCode,
				ExpiresIn: strOrNull(expiresIn),
				CreatedAt: ca,
				Approvals: make(map[string]bool),
				Denials:   make(map[string]bool),
			})
		}
		reqRows.Close()

		voteRows, err := db.QueryContext(ctx,
			`SELECT room_code, requester_id, voter_id, vote FROM room_admin_votes`)
		if err != nil {
			setErr(err)
			return
		}
		defer voteRows.Close()
		for voteRows.Next() {
			var roomCode, requesterId, voterId, vote string
			if err := voteRows.Scan(&roomCode, &requesterId, &voterId, &vote); err != nil {
				setErr(err)
				return
			}
			key := roomCode + ":roomAdmin"
			for _, r := range rar[key] {
				if r.From == requesterId {
					if vote == "approve" {
						r.Approvals[voterId] = true
					} else if vote == "deny" {
						r.Denials[voterId] = true
					}
					break
				}
			}
		}
		roomAdminReqs = rar
	}()

	wg.Wait()
	if loadErr != nil {
		return nil, loadErr
	}

	return &LoadAllResult{
		UsersCache:        usersCache,
		ShareCodes:        shareCodes,
		EmailIndex:        emailIndex,
		MobileIndex:       mobileIndex,
		Rooms:             rooms,
		RoomMemberRoles:   roomMemberRoles,
		Contacts:          contacts,
		LiveTokens:        liveTokens,
		Guardianships:     guardianships,
		RoomAdminRequests: roomAdminReqs,
	}, nil
}

// Helper functions for DB queries
func ptrOrNull(n sql.NullString) *string {
	if n.Valid && n.String != "" {
		s := n.String
		return &s
	}
	return nil
}
func floatOrNull(n sql.NullFloat64) *float64 {
	if n.Valid {
		f := n.Float64
		return &f
	}
	return nil
}
func strOrNull(n sql.NullString) *string {
	if n.Valid {
		s := n.String
		return &s
	}
	return nil
}
func int64OrNull(n sql.NullInt64) *int64 {
	if n.Valid {
		i := n.Int64
		return &i
	}
	return nil
}
func lower(s string) string { return strings.ToLower(s) }
func coalesceStr(s, def string) string {
	if s != "" {
		return s
	}
	return def
}
