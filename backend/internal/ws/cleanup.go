package ws

import (
	"context"
	"log/slog"
	"time"

	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/db"
)

const (
	sevenDaysMs = 7 * 24 * 60 * 60 * 1000
)

// StartCleanupRoutines starts 7 periodic goroutines for cache and DB cleanup.
func (h *Hub) StartCleanupRoutines(ctx context.Context) {
	// 1. Expire offline users (every 60s)
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupExpireOfflineUsers()
			}
		}
	}()

	// 2. Expire watch tokens (every 30s)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupExpireWatchTokens()
			}
		}
	}()

	// 3. Expire live tokens (every 60s)
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupExpireLiveTokens()
			}
		}
	}()

	// 4. Clean empty old rooms (every 1h)
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupEmptyOldRooms()
			}
		}
	}()

	// 5. Expire time-limited room admins (every 60s)
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupExpireRoomAdmins()
			}
		}
	}()

	// 6. Expire time-limited guardianships (every 60s)
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupExpireGuardianships()
			}
		}
	}()

	// 7. Check-in overdue polling (every 60s)
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupCheckInOverdue()
			}
		}
	}()

	slog.Info("Cleanup routines started")
}

func (h *Hub) cleanupExpireOfflineUsers() {
	now := time.Now().UnixMilli()
	list := h.cache.CollectExpiredOfflineUsers(now)
	for _, e := range list {
		h.SendToClients(e.VisibleSids, "userDisconnect", e.SocketID)
	}
}

func (h *Hub) cleanupExpireWatchTokens() {
	now := time.Now().UnixMilli()
	tokens := h.cache.CollectExpiredWatchTokens(now)
	payload := map[string]interface{}{"user": nil, "sos": map[string]interface{}{"active": false}}
	for _, token := range tokens {
		h.SendToGroup("watch:"+token, "watchUpdate", payload)
	}
}

func (h *Hub) cleanupExpireLiveTokens() {
	now := time.Now().UnixMilli()
	list := h.cache.CollectExpiredLiveTokens(now)
	for _, e := range list {
		h.SendToGroup("live:"+e.Token, "liveExpired", map[string]interface{}{"message": "Link expired"})
	}
	if len(list) > 0 {
		if _, err := db.DeleteExpiredLiveTokens(context.Background(), h.pool.DB); err != nil {
			slog.Error("Failed to delete expired live tokens from DB", "error", err)
		}
	}
}

func (h *Hub) cleanupEmptyOldRooms() {
	now := time.Now().UnixMilli()
	_ = h.cache.CollectEmptyOldRooms(now, sevenDaysMs)
	if err := db.DeleteEmptyOldRooms(context.Background(), h.pool.DB, sevenDaysMs); err != nil {
		slog.Error("Failed to delete empty old rooms from DB", "error", err)
	}
}

func (h *Hub) cleanupExpireRoomAdmins() {
	now := time.Now().UnixMilli()
	list := h.cache.ExpireRoomAdminsInCache(now)
	payload := func(roomCode, userID string) map[string]interface{} {
		return map[string]interface{}{
			"roomCode":   roomCode,
			"userId":     userID,
			"role":       "member",
			"expiresAt":  nil,
		}
	}
	for _, e := range list {
		p := payload(e.RoomCode, e.UserID)
		h.SendToClients(e.MemberSids, "roomAdminUpdated", p)
	}
	if len(list) > 0 {
		if _, err := db.ExpireRoomAdmins(context.Background(), h.pool.DB, now); err != nil {
			slog.Error("Failed to expire room admins in DB", "error", err)
		}
	}
}

func (h *Hub) cleanupExpireGuardianships() {
	now := time.Now().UnixMilli()
	list := h.cache.CollectExpiredGuardianships(now)
	updatePayload := func(gID, wID string) map[string]interface{} {
		return map[string]interface{}{
			"guardianId": gID,
			"wardId":     wID,
			"status":     "expired",
			"expiresAt":  nil,
		}
	}
	for _, e := range list {
		p := updatePayload(e.GuardianID, e.WardID)
		if c := h.GetClientByUserID(e.GuardianID); c != nil {
			c.Send("guardianUpdated", p)
		}
		if c := h.GetClientByUserID(e.WardID); c != nil {
			c.Send("guardianUpdated", p)
		}
	}
	if len(list) > 0 {
		if _, err := db.ExpireGuardianships(context.Background(), h.pool.DB, now); err != nil {
			slog.Error("Failed to expire guardianships in DB", "error", err)
		}
	}
}

func (h *Hub) cleanupCheckInOverdue() {
	now := time.Now().UnixMilli()
	h.cache.ForEachActiveUser(func(socketID string, user *cache.ActiveUser) {
		ch := &user.CheckIn
		if !ch.Enabled {
			return
		}
		lastAt := ch.LastCheckInAt
		if lastAt == 0 {
			lastAt = now
		}
		intervalMs := int64(ch.IntervalMin) * 60 * 1000
		overdueMs := int64(ch.OverdueMin) * 60 * 1000
		since := now - lastAt

		if since >= intervalMs {
			h.SendToClient(socketID, "checkInRequest", map[string]interface{}{
				"intervalMinutes":  ch.IntervalMin,
				"overdueMinutes":   ch.OverdueMin,
			})
		}
		if since >= overdueMs {
			missedPayload := map[string]interface{}{
				"socketId":        socketID,
				"userId":          user.UserID,
				"displayName":     user.DisplayName,
				"lastCheckInAt":   lastAt,
				"overdueMinutes":  ch.OverdueMin,
			}
			h.emitToVisible(user, "checkInMissed", missedPayload)
		}
	})
}
