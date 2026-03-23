package cache

// ExpiredOfflineUser holds data for cleanup when an offline user expires.
type ExpiredOfflineUser struct {
	UserID      string
	SocketID    string
	VisibleSids []string
}

// ExpiredLiveToken holds token and user ID for cleanup.
type ExpiredLiveToken struct {
	Token  string
	UserID string
}

// ExpiredRoomAdmin holds room code and user ID for roomAdminUpdated emit.
type ExpiredRoomAdmin struct {
	RoomCode   string
	UserID     string
	MemberSids []string
}

// ExpiredGuardianship holds guardian and ward IDs for cleanup.
type ExpiredGuardianship struct {
	GuardianID string
	WardID    string
}

// CollectExpiredOfflineUsers finds offline users past expiry and removes them.
// Returns the list for emitting userDisconnect. Caller must emit after.
func (c *Cache) CollectExpiredOfflineUsers(now int64) []ExpiredOfflineUser {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []ExpiredOfflineUser
	for userID, entry := range c.OfflineUsers {
		if entry.ExpiresAt == nil || *entry.ExpiresAt > now {
			continue
		}
		visibleSet := c.getVisibleSetLocked(userID)
		var sids []string
		for uid := range visibleSet {
			if uid == userID {
				continue
			}
			if sid, ok := c.UserIdToSocketId[uid]; ok {
				sids = append(sids, sid)
			}
		}
		for sid := range c.AdminClientIds {
			sids = append(sids, sid)
		}
		out = append(out, ExpiredOfflineUser{
			UserID:      userID,
			SocketID:    entry.User.SocketID,
			VisibleSids: sids,
		})
		delete(c.OfflineUsers, userID)
	}
	return out
}

// CollectExpiredWatchTokens finds watch tokens past expiry and removes them.
// Returns token list. Caller must emit watchUpdate and delete.
func (c *Cache) CollectExpiredWatchTokens(now int64) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []string
	for token, entry := range c.WatchTokens {
		if entry.Exp > now {
			continue
		}
		out = append(out, token)
		delete(c.WatchTokens, token)
	}
	return out
}

// CollectExpiredLiveTokens finds live tokens past expiry and removes them from cache.
// Returns list for emit and DB cleanup.
func (c *Cache) CollectExpiredLiveTokens(now int64) []ExpiredLiveToken {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []ExpiredLiveToken
	for token, entry := range c.LiveTokens {
		if entry.ExpiresAt == nil || *entry.ExpiresAt > now {
			continue
		}
		out = append(out, ExpiredLiveToken{Token: token, UserID: entry.UserID})
		delete(c.LiveTokens, token)
		if c.LiveTokensByUser[entry.UserID] != nil {
			delete(c.LiveTokensByUser[entry.UserID], token)
		}
	}
	return out
}

// CollectEmptyOldRooms finds empty rooms older than maxAgeMs and removes them from cache.
func (c *Cache) CollectEmptyOldRooms(now int64, maxAgeMs int64) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	cutoff := now - maxAgeMs
	var out []string
	for code, room := range c.Rooms {
		if len(room.Members) != 0 {
			continue
		}
		if room.CreatedAt > cutoff {
			continue
		}
		out = append(out, code)
		delete(c.Rooms, code)
		delete(c.RoomMemberRoles, code)
	}
	return out
}

// ExpireRoomAdminsInCache demotes expired admins and returns list for emit.
func (c *Cache) ExpireRoomAdminsInCache(now int64) []ExpiredRoomAdmin {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []ExpiredRoomAdmin
	for code, roleMap := range c.RoomMemberRoles {
		room := c.Rooms[code]
		if room == nil {
			continue
		}
		var memberSids []string
		for mid := range room.Members {
			if sid, ok := c.UserIdToSocketId[mid]; ok {
				memberSids = append(memberSids, sid)
			}
		}
		for userID, role := range roleMap {
			if role.Role != "admin" || role.ExpiresAt == nil || *role.ExpiresAt > now {
				continue
			}
			role.Role = "member"
			role.ExpiresAt = nil
			out = append(out, ExpiredRoomAdmin{
				RoomCode:   code,
				UserID:     userID,
				MemberSids: memberSids,
			})
		}
	}
	return out
}

// CollectExpiredGuardianships finds active guardianships past expiry and removes them.
func (c *Cache) CollectExpiredGuardianships(now int64) []ExpiredGuardianship {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []ExpiredGuardianship
	for gID, wardMap := range c.Guardianships {
		for wID, entry := range wardMap {
			if entry.Status != "active" || entry.ExpiresAt == nil || *entry.ExpiresAt > now {
				continue
			}
			out = append(out, ExpiredGuardianship{GuardianID: gID, WardID: wID})
			delete(wardMap, wID)
		}
		if len(wardMap) == 0 {
			delete(c.Guardianships, gID)
		}
	}
	return out
}

// ForEachActiveUser calls f for each active user. Must not modify cache in f.
func (c *Cache) ForEachActiveUser(f func(socketID string, user *ActiveUser)) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for sid, u := range c.ActiveUsers {
		f(sid, u)
	}
}

// GetRoomMemberSocketIDs returns socket IDs for all members of a room.
func (c *Cache) GetRoomMemberSocketIDs(roomCode string) []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room := c.Rooms[roomCode]
	if room == nil {
		return nil
	}
	var sids []string
	for mid := range room.Members {
		if sid, ok := c.UserIdToSocketId[mid]; ok {
			sids = append(sids, sid)
		}
	}
	return sids
}
