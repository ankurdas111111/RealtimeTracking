package cache

import (
	"kinnect-v3/internal/db"
)

// GetRoom returns the room by code, or nil.
func (c *Cache) GetRoom(code string) *db.RoomEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Rooms[code]
}

// AddRoom adds a room to the cache.
func (c *Cache) AddRoom(code, dbID, name, createdBy string, createdAt int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Rooms == nil {
		c.Rooms = make(map[string]*db.RoomEntry)
	}
	c.Rooms[code] = &db.RoomEntry{
		DbID:      dbID,
		Name:      name,
		Members:   map[string]bool{createdBy: true},
		CreatedBy: createdBy,
		CreatedAt: createdAt,
	}
	if c.RoomMemberRoles == nil {
		c.RoomMemberRoles = make(map[string]map[string]*db.RoomMemberRole)
	}
	if c.RoomMemberRoles[code] == nil {
		c.RoomMemberRoles[code] = make(map[string]*db.RoomMemberRole)
	}
	c.RoomMemberRoles[code][createdBy] = &db.RoomMemberRole{Role: "admin", ExpiresAt: nil}
	if c.UserRooms == nil {
		c.UserRooms = make(map[string]map[string]bool)
	}
	if c.UserRooms[createdBy] == nil {
		c.UserRooms[createdBy] = make(map[string]bool)
	}
	c.UserRooms[createdBy][code] = true
}

// AddRoomMember adds a member to a room.
func (c *Cache) AddRoomMember(code, userID, role string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if room := c.Rooms[code]; room != nil {
		room.Members[userID] = true
	}
	if c.RoomMemberRoles[code] == nil {
		c.RoomMemberRoles[code] = make(map[string]*db.RoomMemberRole)
	}
	if role == "" {
		role = "member"
	}
	c.RoomMemberRoles[code][userID] = &db.RoomMemberRole{Role: role, ExpiresAt: nil}
	if c.UserRooms == nil {
		c.UserRooms = make(map[string]map[string]bool)
	}
	if c.UserRooms[userID] == nil {
		c.UserRooms[userID] = make(map[string]bool)
	}
	c.UserRooms[userID][code] = true
}

// RemoveRoomMember removes a member from a room.
func (c *Cache) RemoveRoomMember(code, userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if room := c.Rooms[code]; room != nil {
		delete(room.Members, userID)
	}
	if rmr := c.RoomMemberRoles[code]; rmr != nil {
		delete(rmr, userID)
	}
	if ur := c.UserRooms[userID]; ur != nil {
		delete(ur, code)
	}
}

// DeleteRoom removes a room and all its members from UserRooms.
func (c *Cache) DeleteRoom(code string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if room := c.Rooms[code]; room != nil {
		for mid := range room.Members {
			if ur := c.UserRooms[mid]; ur != nil {
				delete(ur, code)
			}
		}
	}
	delete(c.Rooms, code)
	delete(c.RoomMemberRoles, code)
}

// GetUserRoomCount returns the number of rooms the user is in.
func (c *Cache) GetUserRoomCount(userID string) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.UserRooms[userID])
}

// AddContactBidirectional adds both directions of contact.
func (c *Cache) AddContactBidirectional(userA, userB string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Contacts == nil {
		c.Contacts = make(map[string]map[string]bool)
	}
	if c.Contacts[userA] == nil {
		c.Contacts[userA] = make(map[string]bool)
	}
	if c.Contacts[userB] == nil {
		c.Contacts[userB] = make(map[string]bool)
	}
	c.Contacts[userA][userB] = true
	c.Contacts[userB][userA] = true
}

// RemoveContactBidirectional removes both directions.
func (c *Cache) RemoveContactBidirectional(userA, userB string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Contacts[userA] != nil {
		delete(c.Contacts[userA], userB)
	}
	if c.Contacts[userB] != nil {
		delete(c.Contacts[userB], userA)
	}
}

// GetContactCount returns the number of contacts for a user.
func (c *Cache) GetContactCount(userID string) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.Contacts[userID])
}

// AddLiveToken adds a live token to cache and index.
func (c *Cache) AddLiveToken(token, userID string, expiresAt *int64, createdAt int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.LiveTokens == nil {
		c.LiveTokens = make(map[string]*db.LiveTokenEntry)
	}
	c.LiveTokens[token] = &db.LiveTokenEntry{UserID: userID, ExpiresAt: expiresAt, CreatedAt: createdAt}
	if c.LiveTokensByUser == nil {
		c.LiveTokensByUser = make(map[string]map[string]bool)
	}
	if c.LiveTokensByUser[userID] == nil {
		c.LiveTokensByUser[userID] = make(map[string]bool)
	}
	c.LiveTokensByUser[userID][token] = true
}

// GetLiveTokenCount returns the number of live tokens for a user.
func (c *Cache) GetLiveTokenCount(userID string) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.LiveTokensByUser[userID])
}

// SetWatchToken adds or replaces a watch token entry.
func (c *Cache) SetWatchToken(token, socketID, userID string, exp int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.WatchTokens == nil {
		c.WatchTokens = make(map[string]*WatchTokenEntry)
	}
	c.WatchTokens[token] = &WatchTokenEntry{SocketID: socketID, UserID: userID, Exp: exp}
}

// GetGuardianship returns the guardianship entry, or nil.
func (c *Cache) GetGuardianship(guardianID, wardID string) *db.GuardianshipEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if wards := c.Guardianships[guardianID]; wards != nil {
		return wards[wardID]
	}
	return nil
}

// SetGuardianship sets or updates a guardianship entry.
func (c *Cache) SetGuardianship(guardianID, wardID string, entry *db.GuardianshipEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Guardianships == nil {
		c.Guardianships = make(map[string]map[string]*db.GuardianshipEntry)
	}
	if c.Guardianships[guardianID] == nil {
		c.Guardianships[guardianID] = make(map[string]*db.GuardianshipEntry)
	}
	c.Guardianships[guardianID][wardID] = entry
	// Maintain WardToGuardians reverse index
	if c.WardToGuardians == nil {
		c.WardToGuardians = make(map[string]map[string]bool)
	}
	if c.WardToGuardians[wardID] == nil {
		c.WardToGuardians[wardID] = make(map[string]bool)
	}
	c.WardToGuardians[wardID][guardianID] = true
}

// DeleteGuardianship removes a guardianship.
func (c *Cache) DeleteGuardianship(guardianID, wardID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if wards := c.Guardianships[guardianID]; wards != nil {
		delete(wards, wardID)
		if len(wards) == 0 {
			delete(c.Guardianships, guardianID)
		}
	}
	// Maintain WardToGuardians reverse index
	if guardians := c.WardToGuardians[wardID]; guardians != nil {
		delete(guardians, guardianID)
		if len(guardians) == 0 {
			delete(c.WardToGuardians, wardID)
		}
	}
}

// AddPendingRequest appends a request to the keyed list.
func (c *Cache) AddPendingRequest(key string, req interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.PendingRequests == nil {
		c.PendingRequests = make(map[string][]interface{})
	}
	// avoid duplicate from same user
	for _, r := range c.PendingRequests[key] {
		if m, ok := r.(map[string]interface{}); ok {
			if from, _ := m["from"].(string); from != "" {
				if targetFrom, _ := req.(map[string]interface{})["from"].(string); targetFrom == from {
					return
				}
			}
		}
		if e, ok := r.(*db.RoomAdminRequestEntry); ok {
			if fromReq, ok := req.(*db.RoomAdminRequestEntry); ok && e.From == fromReq.From {
				return
			}
		}
	}
	c.PendingRequests[key] = append(c.PendingRequests[key], req)
}

// GetPendingRequests returns the requests for a key.
func (c *Cache) GetPendingRequests(key string) []interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.PendingRequests[key]
}

// RemovePendingRequestByFrom removes the first request where from matches.
func (c *Cache) RemovePendingRequestByFrom(key, fromID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	reqs := c.PendingRequests[key]
	for i, r := range reqs {
		if m, ok := r.(map[string]interface{}); ok {
			if f, _ := m["from"].(string); f == fromID {
				c.PendingRequests[key] = append(reqs[:i], reqs[i+1:]...)
				return
			}
		}
		if e, ok := r.(*db.RoomAdminRequestEntry); ok && e.From == fromID {
			c.PendingRequests[key] = append(reqs[:i], reqs[i+1:]...)
			return
		}
	}
}

// SetRoomMemberRole updates role for a room member.
func (c *Cache) SetRoomMemberRole(code, userID, role string, expiresAt *int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.RoomMemberRoles[code] == nil {
		c.RoomMemberRoles[code] = make(map[string]*db.RoomMemberRole)
	}
	c.RoomMemberRoles[code][userID] = &db.RoomMemberRole{Role: role, ExpiresAt: expiresAt}
}

// GetRoomAdminRequests returns room admin requests for a room code.
func (c *Cache) GetRoomAdminRequests(roomCode string) []*db.RoomAdminRequestEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	key := roomCode + ":roomAdmin"
	raw := c.PendingRequests[key]
	if len(raw) == 0 {
		return nil
	}
	out := make([]*db.RoomAdminRequestEntry, 0, len(raw))
	for _, r := range raw {
		if e, ok := r.(*db.RoomAdminRequestEntry); ok {
			out = append(out, e)
		}
	}
	return out
}

// AddRoomAdminRequest adds a room admin request.
func (c *Cache) AddRoomAdminRequest(entry *db.RoomAdminRequestEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := entry.RoomCode + ":roomAdmin"
	if c.PendingRequests == nil {
		c.PendingRequests = make(map[string][]interface{})
	}
	for _, r := range c.PendingRequests[key] {
		if e, ok := r.(*db.RoomAdminRequestEntry); ok && e.From == entry.From {
			return // already exists
		}
	}
	c.PendingRequests[key] = append(c.PendingRequests[key], entry)
}

// AddRoomAdminVote adds or updates a vote on a room admin request.
func (c *Cache) AddRoomAdminVote(roomCode, requesterID, voterID, vote string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := roomCode + ":roomAdmin"
	for _, r := range c.PendingRequests[key] {
		if e, ok := r.(*db.RoomAdminRequestEntry); ok && e.From == requesterID {
			if e.Approvals == nil {
				e.Approvals = make(map[string]bool)
			}
			if e.Denials == nil {
				e.Denials = make(map[string]bool)
			}
			delete(e.Approvals, voterID)
			delete(e.Denials, voterID)
			if vote == "approve" {
				e.Approvals[voterID] = true
			} else if vote == "deny" {
				e.Denials[voterID] = true
			}
			return
		}
	}
}

// RemoveRoomAdminRequest removes a room admin request.
func (c *Cache) RemoveRoomAdminRequest(roomCode, userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := roomCode + ":roomAdmin"
	reqs := c.PendingRequests[key]
	for i, r := range reqs {
		if e, ok := r.(*db.RoomAdminRequestEntry); ok && e.From == userID {
			c.PendingRequests[key] = append(reqs[:i], reqs[i+1:]...)
			return
		}
	}
}

// GetRoomMemberRole returns the role for a user in a room.
func (c *Cache) GetRoomMemberRole(code, userID string) *db.RoomMemberRole {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if rmr := c.RoomMemberRoles[code]; rmr != nil {
		return rmr[userID]
	}
	return nil
}

// GetContactsForUser returns contact user IDs for a user.
func (c *Cache) GetContactsForUser(userID string) []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	cm := c.Contacts[userID]
	if cm == nil {
		return nil
	}
	out := make([]string, 0, len(cm))
	for id := range cm {
		out = append(out, id)
	}
	return out
}

// GetGuardianshipsAsGuardian returns guardianship entries where user is guardian.
func (c *Cache) GetGuardianshipsAsGuardian(userID string) []map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()
	wards := c.Guardianships[userID]
	if wards == nil {
		return nil
	}
	var out []map[string]interface{}
	for wID, e := range wards {
		if e != nil {
			out = append(out, map[string]interface{}{
				"wardId": wID, "wardName": c.getDisplayNameLocked(wID),
				"status": e.Status, "expiresAt": e.ExpiresAt, "initiatedBy": e.InitiatedBy,
			})
		}
	}
	return out
}

// GetGuardianshipsAsWard returns guardianship entries where user is ward.
func (c *Cache) GetGuardianshipsAsWard(userID string) []map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var out []map[string]interface{}
	for gID, wards := range c.Guardianships {
		if e := wards[userID]; e != nil {
			out = append(out, map[string]interface{}{
				"guardianId": gID, "guardianName": c.getDisplayNameLocked(gID),
				"status": e.Status, "expiresAt": e.ExpiresAt, "initiatedBy": e.InitiatedBy,
			})
		}
	}
	return out
}

// GetManageableUsers returns ward user IDs for a guardian (active only).
func (c *Cache) GetManageableUsers(userID string) []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	wards := c.Guardianships[userID]
	if wards == nil {
		return nil
	}
	out := make([]string, 0, len(wards))
	for wID, e := range wards {
		if e != nil && e.Status == "active" {
			out = append(out, wID)
		}
	}
	return out
}

// GetLiveTokensForUser returns map of token -> expiresAt for a user.
func (c *Cache) GetLiveTokensForUser(userID string) map[string]*int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	tokens := c.LiveTokensByUser[userID]
	if tokens == nil {
		return nil
	}
	out := make(map[string]*int64)
	for token := range tokens {
		if e := c.LiveTokens[token]; e != nil {
			out[token] = e.ExpiresAt
		}
	}
	return out
}

// BuildPendingRequestsPayload builds pending requests for a user.
func (c *Cache) BuildPendingRequestsPayload(userID string) []interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()

	normalizeMap := func(m map[string]interface{}, fallbackType string) map[string]interface{} {
		nm := make(map[string]interface{}, len(m)+4)
		for k, v := range m {
			nm[k] = v
		}
		if _, ok := nm["type"]; !ok {
			if t, ok := nm["Type"].(string); ok && t != "" {
				nm["type"] = t
			} else if fallbackType != "" {
				nm["type"] = fallbackType
			}
		}
		if _, ok := nm["from"]; !ok {
			if f, ok := nm["From"].(string); ok {
				nm["from"] = f
			}
		}
		if _, ok := nm["roomCode"]; !ok {
			if rc, ok := nm["RoomCode"].(string); ok {
				nm["roomCode"] = rc
			}
		}
		if from, ok := nm["from"].(string); ok && from != "" {
			if _, has := nm["fromName"]; !has {
				nm["fromName"] = c.getDisplayNameLocked(from)
			}
		}
		return nm
	}

	var out []interface{}
	keyGuardian := userID + ":guardian"
	keyInvite := userID + ":guardianInvite"
	for _, r := range c.PendingRequests[keyGuardian] {
		if m, ok := r.(map[string]interface{}); ok {
			out = append(out, normalizeMap(m, "guardian"))
		}
	}
	for _, r := range c.PendingRequests[keyInvite] {
		if m, ok := r.(map[string]interface{}); ok {
			out = append(out, normalizeMap(m, "guardianInvite"))
		}
	}
	// Room admin requests for rooms user is in
	for code := range c.UserRooms[userID] {
		key := code + ":roomAdmin"
		totalEligible := 0
		if room := c.Rooms[code]; room != nil {
			totalEligible = len(room.Members) - 1
			if totalEligible < 0 {
				totalEligible = 0
			}
		}
		for _, r := range c.PendingRequests[key] {
			if e, ok := r.(*db.RoomAdminRequestEntry); ok {
				myVote := interface{}(nil)
				if e.Approvals != nil && e.Approvals[userID] {
					myVote = "approve"
				} else if e.Denials != nil && e.Denials[userID] {
					myVote = "deny"
				}
				out = append(out, map[string]interface{}{
					"type":          "roomAdmin",
					"from":          e.From,
					"fromName":      c.getDisplayNameLocked(e.From),
					"roomCode":      code,
					"expiresIn":     e.ExpiresIn,
					"approvals":     len(e.Approvals),
					"denials":       len(e.Denials),
					"totalEligible": totalEligible,
					"myVote":        myVote,
					"isMe":          e.From == userID,
				})
				continue
			}
			if m, ok := r.(map[string]interface{}); ok {
				out = append(out, normalizeMap(m, "roomAdmin"))
				continue
			}
			out = append(out, r)
		}
	}
	return out
}

// GetLastVisibleSet returns the last visible set for a socket.
func (c *Cache) GetLastVisibleSet(socketID string) map[string]bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.LastVisibleSets[socketID]
}

// SetLastVisibleSet sets the last visible set for a socket.
func (c *Cache) SetLastVisibleSet(socketID string, vis map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.LastVisibleSets == nil {
		c.LastVisibleSets = make(map[string]map[string]bool)
	}
	c.LastVisibleSets[socketID] = vis
}

// InvalidateVisibilityForUsers invalidates visibility for users and anyone who has them in their set.
func (c *Cache) InvalidateVisibilityForUsers(userIDs []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, uid := range userIDs {
		delete(c.VisibilityCache, uid)
	}
	affectedSet := make(map[string]bool)
	for _, uid := range userIDs {
		affectedSet[uid] = true
	}
	for uid, vis := range c.VisibilityCache {
		for vid := range affectedSet {
			if vis[vid] {
				delete(c.VisibilityCache, uid)
				break
			}
		}
	}
}

// BuildAdminOverviewPayload builds the full admin overview.
func (c *Cache) BuildAdminOverviewPayload() map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()
	users := make([]map[string]interface{}, 0, len(c.UsersCache))
	for uid, uc := range c.UsersCache {
		users = append(users, map[string]interface{}{
			"userId": uid, "displayName": c.getDisplayNameLocked(uid), "role": uc.Role,
			"shareCode": uc.ShareCode, "contacts": len(c.Contacts[uid]),
		})
	}
	rooms := make([]map[string]interface{}, 0, len(c.Rooms))
	for code, room := range c.Rooms {
		members := make([]string, 0, len(room.Members))
		for mid := range room.Members {
			members = append(members, mid)
		}
		rooms = append(rooms, map[string]interface{}{
			"code": code, "name": room.Name, "members": members,
		})
	}
	guardianships := make([]map[string]interface{}, 0)
	for gID, wards := range c.Guardianships {
		for wID, e := range wards {
			if e != nil {
				guardianships = append(guardianships, map[string]interface{}{
					"guardianId": gID, "wardId": wID, "status": e.Status,
				})
			}
		}
	}
	return map[string]interface{}{
		"users": len(c.UsersCache), "rooms": len(c.Rooms),
		"usersList": users, "roomsList": rooms, "guardianships": guardianships,
	}
}
