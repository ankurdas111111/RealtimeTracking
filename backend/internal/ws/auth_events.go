package ws

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/db"
	"kinnect-v3/internal/shared"
)

const (
	positionCooldownMs   = 100
	positionRateMin      = 360
	positionBatchRateMin = 5
	dbSaveThrottleMs     = 30000
	maxRoomsPerUser      = 20
	maxContactsPerUser   = 50
	maxLiveLinksPerUser  = 10
)

func toMap(data json.RawMessage) map[string]interface{} {
	if len(data) == 0 {
		return nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	return m
}

// handlePosition handles position updates with rate limit, cooldown, validation.
func (h *Hub) handlePosition(c *Client, data json.RawMessage) {
	clientID := c.ID()
	now := time.Now().UnixMilli()

	if !c.CheckRateLimit("position", positionRateMin) {
		return
	}
	if now-h.cache.GetLastPositionAt(clientID) < positionCooldownMs {
		return
	}
	h.cache.SetLastPositionAt(clientID, now)

	m := toMap(data)
	pos := shared.ValidatePosition(m)
	if pos == nil {
		return
	}

	user := h.cache.GetActiveUser(clientID)
	if user == nil {
		return
	}

	// Update user fields
	user.Latitude = &pos.Latitude
	user.Longitude = &pos.Longitude
	user.Speed = pos.Speed
	user.LastUpdate = now
	user.FormattedTime = pos.FormattedTime
	user.Accuracy = pos.Accuracy
	if pos.Timestamp != nil {
		// Store clientTimestamp in a field if cache.ActiveUser has it - check struct
		// ActiveUser doesn't have ClientTimestamp; skip or add - skip for now
	}
	prevSpeed := user.LastSpeed
	user.LastSpeed = pos.Speed
	if pos.Speed > 0.8 {
		user.LastMoveAt = now
	}
	if prevSpeed > 25 && pos.Speed < 2 {
		t := now
		user.HardStopAt = &t
	}

	// Record in position buffer
	var speedPtr *float64
	if pos.Speed != 0 {
		speedPtr = &pos.Speed
	}
	h.RecordPosition(user.UserID, pos.Latitude, pos.Longitude, speedPtr, pos.Accuracy)

	// DB save throttle (30s)
	if now-h.cache.GetLastDbSaveAt(user.UserID) > dbSaveThrottleMs {
		h.cache.SetLastDbSaveAt(user.UserID, now)
		speedStr := fmt.Sprintf("%.2f", pos.Speed)
		_ = db.UpdateUserLocation(context.Background(), h.pool.DB, user.UserID, pos.Latitude, pos.Longitude, speedStr, now)
	}

	sanitized := h.cache.SanitizeUser(user)
	sanitized["online"] = true
	h.queuePositionBroadcast(user, sanitized)

	// Emit liveUpdate to live:token groups
	tokens := h.cache.GetLiveTokensForUser(user.UserID)
	for token := range tokens {
		h.SendToGroup("live:"+token, "liveUpdate", map[string]interface{}{"user": sanitized})
	}

	h.runAutoRules(user)
}

// handlePositionBatch handles batched position updates.
func (h *Hub) handlePositionBatch(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("positionBatch", positionBatchRateMin) {
		return
	}

	var batch []map[string]interface{}
	if err := json.Unmarshal(data, &batch); err != nil || len(batch) == 0 {
		return
	}
	if len(batch) > 200 {
		batch = batch[:200]
	}

	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}

	for _, m := range batch {
		pos := shared.ValidatePosition(m)
		if pos == nil {
			continue
		}
		user.Latitude = &pos.Latitude
		user.Longitude = &pos.Longitude
		user.Speed = pos.Speed
		user.LastUpdate = time.Now().UnixMilli()
		user.FormattedTime = pos.FormattedTime
		user.Accuracy = pos.Accuracy
	}

	sanitized := h.cache.SanitizeUser(user)
	sanitized["online"] = true
	h.queuePositionBroadcast(user, sanitized)
	tokens := h.cache.GetLiveTokensForUser(user.UserID)
	for token := range tokens {
		h.SendToGroup("live:"+token, "liveUpdate", map[string]interface{}{"user": sanitized})
	}
}

// handleProfileUpdate updates battery, deviceType, connectionQuality.
func (h *Hub) handleProfileUpdate(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("profileUpdate", 20) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	if m == nil {
		return
	}
	if v, ok := m["batteryPct"].(float64); ok && v >= 0 && v <= 100 {
		pct := int(v)
		user.BatteryPct = &pct
	}
	if s, ok := m["deviceType"].(string); ok {
		sanitized := shared.SanitizeString(s, 20)
		user.DeviceType = &sanitized
	}
	if s, ok := m["connectionQuality"].(string); ok {
		sanitized := shared.SanitizeString(s, 20)
		user.ConnectionQuality = &sanitized
	}
	sanitized := h.cache.SanitizeUser(user)
	sanitized["online"] = true
	h.emitToVisibleAndSelf(user, "userUpdate", sanitized)
}

// handleSetRetention sets retention mode (48h/default).
func (h *Hub) handleSetRetention(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("setRetention", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	if m == nil {
		return
	}
	if user.Retention == nil {
		user.Retention = &cache.Retention{Mode: "default", ClientID: c.ID()}
	}
	if mode, ok := m["mode"].(string); ok && (mode == "48h" || mode == "default") {
		user.Retention.Mode = mode
	}
	sanitized := h.cache.SanitizeUser(user)
	sanitized["online"] = true
	h.emitToVisibleAndSelf(user, "userUpdate", sanitized)
}

// handleSetRetentionForever sets retention to forever (admin only).
func (h *Hub) handleSetRetentionForever(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("setRetentionForever", 10) {
		return
	}
	if c.Role() != "admin" {
		return
	}
	m := toMap(data)
	if m == nil {
		return
	}
	targetSocketID, _ := m["socketId"].(string)
	if targetSocketID == "" {
		return
	}

	target := h.cache.GetActiveUser(targetSocketID)
	if target == nil {
		target = h.cache.GetOfflineUserBySocketID(targetSocketID)
	}
	if target == nil {
		return
	}

	forever, _ := m["forever"].(bool)
	if target.Retention == nil {
		target.Retention = &cache.Retention{Mode: "default", ClientID: targetSocketID}
	}
	if forever {
		target.Retention.Mode = "forever"
	} else if target.Retention.Mode == "forever" {
		target.Retention.Mode = "default"
	}

	sanitized := h.cache.SanitizeUser(target)
	sanitized["online"] = h.cache.GetUserIdToSocketId(target.UserID) != ""
	h.emitToVisibleAndSelf(target, "userUpdate", sanitized)
}

// handleAdminDeleteUser force-deletes a user (admin only).
func (h *Hub) handleAdminDeleteUser(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("adminDeleteUser", 5) {
		return
	}
	if c.Role() != "admin" {
		return
	}
	m := toMap(data)
	if m == nil {
		return
	}
	targetSocketID, _ := m["socketId"].(string)
	if targetSocketID == "" {
		return
	}

	targetUser := h.cache.GetActiveUser(targetSocketID)
	if targetUser != nil {
		targetUser.ForceDelete = true
		h.cache.DeleteOfflineUser(targetUser.UserID)
		h.DisconnectClient(targetSocketID)
		visibleSids := h.cache.GetVisibleSocketIDs(targetUser)
		for _, sid := range visibleSids {
			h.SendToClient(sid, "userDisconnect", targetSocketID)
		}
		slog.Info("Admin deleted user", "targetUserId", targetUser.UserID, "by", c.UserID())
		return
	}
	// Offline user with socketId - would need to search offline; skip for simplicity
}

// handleCreateRoom creates a new room.
func (h *Hub) handleCreateRoom(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("createRoom", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	if h.cache.GetUserRoomCount(user.UserID) >= maxRoomsPerUser {
		c.Send("roomError", map[string]interface{}{"message": "Room limit reached (" + string(rune(maxRoomsPerUser)) + ")"})
		return
	}
	m := toMap(data)
	name := ""
	if m != nil {
		if s, ok := m["name"].(string); ok {
			name = shared.SanitizeString(s, 50)
		}
	}
	code := h.generateUniqueRoomCode()
	roomName := name
	if roomName == "" {
		roomName = "Room " + code
	}
	createdAt := time.Now().UnixMilli()

	roomDbID, err := db.CreateRoom(context.Background(), h.pool.DB, code, roomName, user.UserID, createdAt)
	if err != nil {
		slog.Error("Failed to create room", "error", err)
		c.Send("roomError", map[string]interface{}{"message": "Failed to create room"})
		return
	}

	h.cache.AddRoom(code, roomDbID, roomName, user.UserID, createdAt)
	user.Rooms = h.cache.GetUserRooms(user.UserID)
	h.invalidateVisibility(user.UserID)

	c.Send("roomCreated", map[string]interface{}{"code": code, "name": roomName})
	h.emitMyRooms(c, user.UserID)
}

// generateUniqueRoomCode generates a unique 6-char room code.
func (h *Hub) generateUniqueRoomCode() string {
	for {
		code := shared.GenerateCode()
		if !h.cache.ShareCodeExists(code) && h.cache.GetRoom(code) == nil {
			return code
		}
	}
}

// handleJoinRoom joins a room by code.
func (h *Hub) handleJoinRoom(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("joinRoom", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	code := ""
	if m != nil {
		if s, ok := m["code"].(string); ok {
			code = strings.TrimSpace(strings.ToUpper(s))
		}
	}
	if code == "" {
		c.Send("roomError", map[string]interface{}{"message": "Invalid code"})
		return
	}

	room := h.cache.GetRoom(code)
	if room == nil {
		c.Send("roomError", map[string]interface{}{"message": "Room not found"})
		return
	}

	if err := db.AddRoomMember(context.Background(), h.pool.DB, room.DbID, user.UserID, "member"); err != nil {
		slog.Error("Failed to add room member", "error", err)
		c.Send("roomError", map[string]interface{}{"message": "Failed to join"})
		return
	}

	h.cache.AddRoomMember(code, user.UserID, "member")
	user.Rooms = h.cache.GetUserRooms(user.UserID)

	memberIDs := make([]string, 0, len(room.Members))
	for mid := range room.Members {
		memberIDs = append(memberIDs, mid)
	}
	h.invalidateVisibilityForUsers(memberIDs)

	c.Send("roomJoined", map[string]interface{}{"code": code, "name": room.Name})
	h.emitMyRooms(c, user.UserID)
	h.scheduleVisibilityRefresh(c, user)
}

// handleLeaveRoom leaves a room.
func (h *Hub) handleLeaveRoom(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("leaveRoom", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	code := ""
	if m != nil {
		if s, ok := m["code"].(string); ok {
			code = strings.TrimSpace(strings.ToUpper(s))
		}
	}
	if code == "" {
		return
	}

	room := h.cache.GetRoom(code)
	if room == nil {
		return
	}

	if err := db.RemoveRoomMember(context.Background(), h.pool.DB, room.DbID, user.UserID); err != nil {
		slog.Error("Failed to remove room member", "error", err)
		return
	}

	h.cache.RemoveRoomMember(code, user.UserID)
	if len(room.Members) <= 1 {
		_ = db.DeleteRoom(context.Background(), h.pool.DB, room.DbID)
		h.cache.DeleteRoom(code)
	}

	user.Rooms = h.cache.GetUserRooms(user.UserID)
	memberIDs := make([]string, 0, len(room.Members))
	for mid := range room.Members {
		memberIDs = append(memberIDs, mid)
	}
	memberIDs = append(memberIDs, user.UserID)
	h.invalidateVisibilityForUsers(memberIDs)

	c.Send("roomLeft", map[string]interface{}{"code": code})
	h.emitMyRooms(c, user.UserID)
	h.scheduleVisibilityRefresh(c, user)
}

// handleAddContact adds a contact by share code.
func (h *Hub) handleAddContact(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("addContact", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	if h.cache.GetContactCount(user.UserID) >= maxContactsPerUser {
		c.Send("contactError", map[string]interface{}{"message": "Contact limit reached"})
		return
	}
	m := toMap(data)
	shareCode := ""
	if m != nil {
		if s, ok := m["shareCode"].(string); ok {
			shareCode = strings.TrimSpace(strings.ToUpper(s))
		}
	}
	if shareCode == "" {
		c.Send("contactError", map[string]interface{}{"message": "Invalid share code"})
		return
	}

	targetID := h.cache.GetUserIDByShareCode(shareCode)
	if targetID == "" || targetID == user.UserID {
		c.Send("contactError", map[string]interface{}{"message": "User not found"})
		return
	}

	if err := db.AddContactBidirectional(context.Background(), h.pool.DB, user.UserID, targetID); err != nil {
		slog.Error("Failed to add contact", "error", err)
		c.Send("contactError", map[string]interface{}{"message": "Failed to add contact"})
		return
	}

	h.cache.AddContactBidirectional(user.UserID, targetID)
	h.invalidateVisibilityForUsers([]string{user.UserID, targetID})

	c.Send("contactAdded", map[string]interface{}{"userId": targetID, "displayName": h.cache.GetDisplayName(targetID)})
	h.emitMyContacts(c, user.UserID)
	h.scheduleVisibilityRefresh(c, user)

	if other := h.GetClientByUserID(targetID); other != nil {
		ou := h.cache.GetActiveUser(other.ID())
		if ou != nil {
			h.emitMyContacts(other, targetID)
			h.scheduleVisibilityRefresh(other, ou)
		}
	}
}

// handleRemoveContact removes a contact.
func (h *Hub) handleRemoveContact(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("removeContact", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	targetID := ""
	if m != nil {
		if s, ok := m["userId"].(string); ok {
			targetID = strings.TrimSpace(s)
		}
	}
	if targetID == "" {
		return
	}

	if err := db.RemoveContactBidirectional(context.Background(), h.pool.DB, user.UserID, targetID); err != nil {
		slog.Error("Failed to remove contact", "error", err)
		return
	}

	h.cache.RemoveContactBidirectional(user.UserID, targetID)
	h.invalidateVisibilityForUsers([]string{user.UserID, targetID})

	c.Send("contactRemoved", map[string]interface{}{"userId": targetID})
	h.emitMyContacts(c, user.UserID)
	h.scheduleVisibilityRefresh(c, user)

	if other := h.GetClientByUserID(targetID); other != nil {
		ou := h.cache.GetActiveUser(other.ID())
		if ou != nil {
			h.emitMyContacts(other, targetID)
			h.scheduleVisibilityRefresh(other, ou)
		}
	}
}

// handleCreateLiveLink creates a live sharing link.
func (h *Hub) handleCreateLiveLink(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("createLiveLink", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	if h.cache.GetLiveTokenCount(user.UserID) >= maxLiveLinksPerUser {
		c.Send("liveLinkError", map[string]interface{}{"message": "Live link limit reached"})
		return
	}
	m := toMap(data)
	expStr := "24h"
	if m != nil {
		// v1/v2-style payload
		if v, ok := m["expiresIn"]; ok {
			if s, ok := v.(string); ok {
				expStr = strings.TrimSpace(s)
			} else {
				// explicit null means "forever"
				expStr = ""
			}
		}
		// frontend currently sends "duration"
		if v, ok := m["duration"]; ok {
			if s, ok := v.(string); ok {
				expStr = strings.TrimSpace(s)
			} else {
				// explicit null means "forever"
				expStr = ""
			}
		}
	}

	expiresAt := h.parseExpiresIn(expStr)
	token := generateLiveToken()
	createdAt := time.Now().UnixMilli()

	if err := db.CreateLiveToken(context.Background(), h.pool.DB, token, user.UserID, expiresAt, createdAt); err != nil {
		slog.Error("Failed to create live token", "error", err)
		c.Send("liveLinkError", map[string]interface{}{"message": "Failed to create link"})
		return
	}

	h.cache.AddLiveToken(token, user.UserID, expiresAt, createdAt)
	c.Send("liveLinkCreated", map[string]interface{}{"token": token, "expiresAt": expiresAt})
	h.emitMyLiveLinks(c, user.UserID)
}

func generateLiveToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// handleRevokeLiveLink revokes a live link.
func (h *Hub) handleRevokeLiveLink(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("revokeLiveLink", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	token := ""
	if m != nil {
		if s, ok := m["token"].(string); ok {
			token = strings.TrimSpace(s)
		}
	}
	if token == "" {
		return
	}

	entry := h.cache.GetLiveToken(token)
	if entry == nil || entry.UserID != user.UserID {
		return
	}

	_ = db.DeleteLiveToken(context.Background(), h.pool.DB, token)
	h.cache.DeleteLiveToken(token)
	h.SendToGroup("live:"+token, "liveExpired", map[string]interface{}{"message": "Link revoked"})
	c.Send("liveLinkRevoked", map[string]interface{}{"token": token})
	h.emitMyLiveLinks(c, user.UserID)
}

// handleWatchJoin joins watch:token group and sends watchInit.
func (h *Hub) handleWatchJoin(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("watchJoin", 10) {
		return
	}
	m := toMap(data)
	token := ""
	if m != nil {
		if s, ok := m["token"].(string); ok {
			token = strings.TrimSpace(s)
		}
	}
	if token == "" {
		return
	}

	entry := h.cache.GetWatchToken(token)
	if entry == nil {
		c.Send("watchError", map[string]interface{}{"message": "Invalid or expired token"})
		return
	}

	h.JoinGroup(c.ID(), "watch:"+token)
	target := h.cache.GetActiveUser(entry.SocketID)
	if target == nil {
		// Target offline - send minimal init
		c.Send("watchInit", map[string]interface{}{"userId": entry.UserID})
		return
	}
	c.Send("watchInit", h.cache.SanitizeUser(target))
}

// handleLiveJoin joins live:token group and sends liveInit.
func (h *Hub) handleLiveJoin(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("liveJoin", 10) {
		return
	}
	m := toMap(data)
	token := ""
	viewerName := "Viewer"
	if m != nil {
		if s, ok := m["token"].(string); ok {
			token = strings.TrimSpace(s)
		}
		if s, ok := m["viewerName"].(string); ok {
			viewerName = shared.SanitizeString(s, 50)
		}
	}
	if token == "" {
		return
	}

	entry := h.cache.GetLiveToken(token)
	if entry == nil {
		c.Send("liveError", map[string]interface{}{"message": "Invalid or expired link"})
		return
	}

	h.JoinGroup(c.ID(), "live:"+token)
	c.liveToken = token
	c.liveViewerName = viewerName

	target := h.cache.GetActiveUser(h.cache.GetUserIdToSocketId(entry.UserID))
	if target == nil {
		c.Send("liveInit", map[string]interface{}{"userId": entry.UserID})
		return
	}
	c.Send("liveInit", map[string]interface{}{"user": h.cache.SanitizeUser(target)})
}

// handleRequestAdminOverview sends full admin overview (admin only).
func (h *Hub) handleRequestAdminOverview(c *Client, data json.RawMessage) {
	if c.Role() != "admin" {
		return
	}
	h.emitAdminOverview(c)
}

// handleRequestRoomAdmin requests room admin role.
func (h *Hub) handleRequestRoomAdmin(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("requestRoomAdmin", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	code := ""
	expiresIn := "7d"
	if m != nil {
		if s, ok := m["roomCode"].(string); ok {
			code = strings.TrimSpace(strings.ToUpper(s))
		}
		if s, ok := m["expiresIn"].(string); ok {
			expiresIn = s
		}
	}
	if code == "" {
		return
	}

	room := h.cache.GetRoom(code)
	if room == nil || !room.Members[user.UserID] {
		return
	}

	expPtr := &expiresIn
	createdAt := time.Now().UnixMilli()
	entry := &db.RoomAdminRequestEntry{Type: "roomAdmin", From: user.UserID, RoomCode: code, ExpiresIn: expPtr, CreatedAt: createdAt, Approvals: make(map[string]bool), Denials: make(map[string]bool)}

	if err := db.CreateRoomAdminRequest(context.Background(), h.pool.DB, code, user.UserID, expPtr, createdAt); err != nil {
		return
	}
	h.cache.AddRoomAdminRequest(entry)

	for mid := range room.Members {
		if cli := h.GetClientByUserID(mid); cli != nil {
			h.emitMyRooms(cli, mid)
		}
	}
}

// handleVoteRoomAdmin votes on room admin request.
func (h *Hub) handleVoteRoomAdmin(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("voteRoomAdmin", 20) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	roomCode, targetUserID, vote := "", "", ""
	if m != nil {
		if s, ok := m["roomCode"].(string); ok {
			roomCode = strings.TrimSpace(strings.ToUpper(s))
		}
		if s, ok := m["userId"].(string); ok {
			targetUserID = strings.TrimSpace(s)
		}
		if s, ok := m["vote"].(string); ok {
			vote = strings.TrimSpace(s)
		}
	}
	if roomCode == "" || targetUserID == "" || (vote != "approve" && vote != "deny") {
		return
	}

	room := h.cache.GetRoom(roomCode)
	if room == nil || !room.Members[user.UserID] {
		return
	}

	_ = db.UpsertRoomAdminVote(context.Background(), h.pool.DB, roomCode, targetUserID, user.UserID, vote)
	h.cache.AddRoomAdminVote(roomCode, targetUserID, user.UserID, vote)

	reqs := h.cache.GetRoomAdminRequests(roomCode)
	var targetReq *db.RoomAdminRequestEntry
	for _, r := range reqs {
		if r.From == targetUserID {
			targetReq = r
			break
		}
	}
	if targetReq == nil {
		return
	}

	totalEligible := len(room.Members) - 1
	if totalEligible <= 0 {
		return
	}
	majority := totalEligible/2 + 1

	if len(targetReq.Approvals) >= majority {
		expStr := ""
		if targetReq.ExpiresIn != nil {
			expStr = *targetReq.ExpiresIn
		}
		expiresAt := h.parseExpiresIn(expStr)
		h.cache.SetRoomMemberRole(roomCode, targetUserID, "admin", expiresAt)
		_ = db.SetRoomMemberRole(context.Background(), h.pool.DB, room.DbID, targetUserID, "admin", expiresAt)
		_ = db.DeleteRoomAdminRequest(context.Background(), h.pool.DB, roomCode, targetUserID)
		h.cache.RemoveRoomAdminRequest(roomCode, targetUserID)
		for mid := range room.Members {
			if cli := h.GetClientByUserID(mid); cli != nil {
				h.SendToClient(cli.ID(), "roomAdminUpdated", map[string]interface{}{"roomCode": roomCode, "userId": targetUserID, "role": "admin", "expiresAt": expiresAt})
				h.emitMyRooms(cli, mid)
			}
		}
	} else if len(targetReq.Denials) >= majority {
		_ = db.DeleteRoomAdminRequest(context.Background(), h.pool.DB, roomCode, targetUserID)
		h.cache.RemoveRoomAdminRequest(roomCode, targetUserID)
		for mid := range room.Members {
			if cli := h.GetClientByUserID(mid); cli != nil {
				h.SendToClient(cli.ID(), "roomAdminUpdated", map[string]interface{}{"roomCode": roomCode, "userId": targetUserID, "role": "denied", "expiresAt": nil})
				h.emitMyRooms(cli, mid)
			}
		}
	} else {
		for mid := range room.Members {
			if cli := h.GetClientByUserID(mid); cli != nil {
				h.emitMyRooms(cli, mid)
			}
		}
	}
}

// handleRevokeRoomAdmin revokes room admin role.
func (h *Hub) handleRevokeRoomAdmin(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("revokeRoomAdmin", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	roomCode, targetUserID := "", ""
	if m != nil {
		if s, ok := m["roomCode"].(string); ok {
			roomCode = strings.TrimSpace(strings.ToUpper(s))
		}
		if s, ok := m["userId"].(string); ok {
			targetUserID = strings.TrimSpace(s)
		}
	}
	if roomCode == "" || targetUserID == "" {
		return
	}

	room := h.cache.GetRoom(roomCode)
	if room == nil || !room.Members[targetUserID] {
		return
	}

	actorRole := h.cache.GetRoomMemberRole(roomCode, user.UserID)
	isSelf := user.UserID == targetUserID
	if !isSelf && (actorRole == nil || actorRole.Role != "admin") {
		return
	}

	h.cache.SetRoomMemberRole(roomCode, targetUserID, "member", nil)
	_ = db.SetRoomMemberRole(context.Background(), h.pool.DB, room.DbID, targetUserID, "member", nil)

	for mid := range room.Members {
		if cli := h.GetClientByUserID(mid); cli != nil {
			h.SendToClient(cli.ID(), "roomAdminUpdated", map[string]interface{}{"roomCode": roomCode, "userId": targetUserID, "role": "member", "expiresAt": nil})
		}
	}
}

// handleRequestGuardian requests guardian role (guardian initiates).
func (h *Hub) handleRequestGuardian(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("requestGuardian", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	wardID := ""
	expiresIn := ""
	if m != nil {
		if s, ok := m["contactUserId"].(string); ok {
			wardID = strings.TrimSpace(s)
		}
		if s, ok := m["expiresIn"].(string); ok {
			expiresIn = s
		}
	}
	if wardID == "" || wardID == user.UserID {
		return
	}

	myContacts := h.cache.GetContactsForUser(user.UserID)
	theirContacts := h.cache.GetContactsForUser(wardID)
	hasMutual := false
	for _, cid := range myContacts {
		if cid == wardID {
			for _, tid := range theirContacts {
				if tid == user.UserID {
					hasMutual = true
					break
				}
			}
			break
		}
	}
	if !hasMutual {
		c.Send("contactError", map[string]interface{}{"message": "Both must be mutual contacts to request guardian role"})
		return
	}

	existing := h.cache.GetGuardianship(user.UserID, wardID)
	if existing != nil && (existing.Status == "active" || existing.Status == "pending") {
		c.Send("contactError", map[string]interface{}{"message": "Request already pending"})
		return
	}

	entry := &db.GuardianshipEntry{Status: "pending", InitiatedBy: "guardian", ExpiresAt: nil, CreatedAt: time.Now().UnixMilli()}
	h.cache.SetGuardianship(user.UserID, wardID, entry)
	_ = db.CreateGuardianship(context.Background(), h.pool.DB, user.UserID, wardID, "pending", nil, entry.CreatedAt, "guardian")

	h.cache.AddPendingRequest(wardID+":guardian", map[string]interface{}{"type": "guardian", "from": user.UserID, "expiresIn": expiresIn})

	if wardCli := h.GetClientByUserID(wardID); wardCli != nil {
		wardCli.Send("guardianRequest", map[string]interface{}{"fromUserId": user.UserID, "fromName": user.DisplayName, "expiresIn": expiresIn, "initiatedBy": "guardian"})
		h.emitMyGuardians(wardCli, wardID)
		h.emitPendingRequests(wardCli, wardID)
	}
	c.Send("contactError", map[string]interface{}{"message": "Guardian request sent"})
	h.emitMyGuardians(c, user.UserID)
}

// handleInviteGuardian invites someone to be guardian (ward initiates).
func (h *Hub) handleInviteGuardian(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("inviteGuardian", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	guardianID := ""
	expiresIn := ""
	if m != nil {
		if s, ok := m["contactUserId"].(string); ok {
			guardianID = strings.TrimSpace(s)
		}
		if s, ok := m["expiresIn"].(string); ok {
			expiresIn = s
		}
	}
	if guardianID == "" || guardianID == user.UserID {
		return
	}

	myContacts := h.cache.GetContactsForUser(user.UserID)
	theirContacts := h.cache.GetContactsForUser(guardianID)
	hasMutual := false
	for _, cid := range myContacts {
		if cid == guardianID {
			for _, tid := range theirContacts {
				if tid == user.UserID {
					hasMutual = true
					break
				}
			}
			break
		}
	}
	if !hasMutual {
		c.Send("contactError", map[string]interface{}{"message": "Both must be mutual contacts"})
		return
	}

	existing := h.cache.GetGuardianship(guardianID, user.UserID)
	if existing != nil && (existing.Status == "active" || existing.Status == "pending") {
		c.Send("contactError", map[string]interface{}{"message": "Request already pending"})
		return
	}

	entry := &db.GuardianshipEntry{Status: "pending", InitiatedBy: "ward", ExpiresAt: nil, CreatedAt: time.Now().UnixMilli()}
	h.cache.SetGuardianship(guardianID, user.UserID, entry)
	_ = db.CreateGuardianship(context.Background(), h.pool.DB, guardianID, user.UserID, "pending", nil, entry.CreatedAt, "ward")

	h.cache.AddPendingRequest(guardianID+":guardianInvite", map[string]interface{}{"type": "guardianInvite", "from": user.UserID, "expiresIn": expiresIn})

	if gCli := h.GetClientByUserID(guardianID); gCli != nil {
		gCli.Send("guardianInvite", map[string]interface{}{"fromUserId": user.UserID, "fromName": user.DisplayName, "expiresIn": expiresIn, "initiatedBy": "ward"})
		h.emitMyGuardians(gCli, guardianID)
		h.emitPendingRequests(gCli, guardianID)
	}
	c.Send("contactError", map[string]interface{}{"message": "Guardian invite sent"})
	h.emitMyGuardians(c, user.UserID)
}

// handleApproveGuardian approves a guardianship.
func (h *Hub) handleApproveGuardian(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("approveGuardian", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	guardianID, _ := m["guardianUserId"].(string)
	wardID, _ := m["wardUserId"].(string)
	if guardianID != "" {
		guardianID = strings.TrimSpace(guardianID)
	}
	if wardID != "" {
		wardID = strings.TrimSpace(wardID)
	}

	var gID, wID, pendingKey string
	if guardianID != "" {
		gID = guardianID
		wID = user.UserID
		pendingKey = user.UserID + ":guardian"
	} else if wardID != "" {
		gID = user.UserID
		wID = wardID
		pendingKey = user.UserID + ":guardianInvite"
	} else {
		return
	}

	entry := h.cache.GetGuardianship(gID, wID)
	if entry == nil || entry.Status != "pending" {
		return
	}

	expiresAt := h.parseExpiresIn("")
	if payloadExp, ok := m["expiresIn"].(string); ok {
		expiresAt = h.parseExpiresIn(payloadExp)
	}
	reqs := h.cache.GetPendingRequests(pendingKey)
	fromID := gID
	if guardianID != "" {
		fromID = guardianID
	} else {
		fromID = wardID
	}
	for _, r := range reqs {
		if m2, ok := r.(map[string]interface{}); ok {
			if f, _ := m2["from"].(string); f == fromID {
				if e, _ := m2["expiresIn"].(string); e != "" {
					expiresAt = h.parseExpiresIn(e)
				}
				break
			}
		}
	}
	h.cache.RemovePendingRequestByFrom(pendingKey, fromID)

	entry.Status = "active"
	entry.ExpiresAt = expiresAt
	h.cache.SetGuardianship(gID, wID, &db.GuardianshipEntry{Status: "active", InitiatedBy: entry.InitiatedBy, ExpiresAt: expiresAt, CreatedAt: entry.CreatedAt})
	_ = db.CreateGuardianship(context.Background(), h.pool.DB, gID, wID, "active", expiresAt, entry.CreatedAt, entry.InitiatedBy)

	h.invalidateVisibilityForUsers([]string{gID, wID})

	payload := map[string]interface{}{"guardianId": gID, "wardId": wID, "status": "active", "expiresAt": expiresAt}
	c.Send("guardianUpdated", payload)
	h.emitMyGuardians(c, user.UserID)
	h.emitPendingRequests(c, user.UserID)

	otherID := wID
	if user.UserID == wID {
		otherID = gID
	}
	if otherCli := h.GetClientByUserID(otherID); otherCli != nil {
		otherCli.Send("guardianUpdated", payload)
		h.emitMyGuardians(otherCli, otherID)
		h.emitPendingRequests(otherCli, otherID)
	}
}

// handleDenyGuardian denies a guardianship.
func (h *Hub) handleDenyGuardian(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("denyGuardian", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	guardianID, _ := m["guardianUserId"].(string)
	wardID, _ := m["wardUserId"].(string)
	if guardianID != "" {
		guardianID = strings.TrimSpace(guardianID)
	}
	if wardID != "" {
		wardID = strings.TrimSpace(wardID)
	}

	var gID, wID, pendingKey string
	if guardianID != "" {
		gID = guardianID
		wID = user.UserID
		pendingKey = user.UserID + ":guardian"
	} else if wardID != "" {
		gID = user.UserID
		wID = wardID
		pendingKey = user.UserID + ":guardianInvite"
	} else {
		return
	}

	entry := h.cache.GetGuardianship(gID, wID)
	if entry == nil || entry.Status != "pending" {
		return
	}

	h.cache.DeleteGuardianship(gID, wID)
	fromID := guardianID
	if fromID == "" {
		fromID = wardID
	}
	h.cache.RemovePendingRequestByFrom(pendingKey, fromID)
	if guardianID != "" {
		h.cache.RemovePendingRequestByFrom(wID+":guardianInvite", user.UserID)
	} else {
		h.cache.RemovePendingRequestByFrom(gID+":guardian", user.UserID)
	}
	_ = db.UpdateGuardianshipStatus(context.Background(), h.pool.DB, gID, wID, "revoked")

	h.invalidateVisibilityForUsers([]string{gID, wID})

	payload := map[string]interface{}{"guardianId": gID, "wardId": wID, "status": "denied", "expiresAt": nil}
	c.Send("guardianUpdated", payload)
	h.emitMyGuardians(c, user.UserID)
	h.emitPendingRequests(c, user.UserID)

	otherID := wID
	if user.UserID == wID {
		otherID = gID
	}
	if otherCli := h.GetClientByUserID(otherID); otherCli != nil {
		otherCli.Send("guardianUpdated", payload)
		h.emitMyGuardians(otherCli, otherID)
		h.emitPendingRequests(otherCli, otherID)
	}
}

// handleRevokeGuardian revokes a guardianship.
func (h *Hub) handleRevokeGuardian(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("revokeGuardian", 10) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	guardianID, _ := m["guardianUserId"].(string)
	wardID, _ := m["wardUserId"].(string)
	if guardianID != "" {
		guardianID = strings.TrimSpace(guardianID)
	}
	if wardID != "" {
		wardID = strings.TrimSpace(wardID)
	}

	var gID, wID string
	if guardianID != "" {
		gID = guardianID
		wID = user.UserID
	} else if wardID != "" {
		gID = user.UserID
		wID = wardID
	} else {
		return
	}

	entry := h.cache.GetGuardianship(gID, wID)
	if entry == nil || (entry.Status != "active" && entry.Status != "pending") {
		return
	}

	if entry.Status == "active" && user.UserID != gID {
		c.Send("error", map[string]interface{}{"message": "Only the guardian can revoke an active guardianship."})
		return
	}
	if entry.Status == "pending" {
		isInitiator := (entry.InitiatedBy == "guardian" && user.UserID == gID) || (entry.InitiatedBy == "ward" && user.UserID == wID)
		if !isInitiator {
			c.Send("error", map[string]interface{}{"message": "Only the requester can cancel a pending guardianship request."})
			return
		}
	}

	h.cache.DeleteGuardianship(gID, wID)
	h.cache.RemovePendingRequestByFrom(wID+":guardian", gID)
	h.cache.RemovePendingRequestByFrom(gID+":guardianInvite", wID)
	_ = db.UpdateGuardianshipStatus(context.Background(), h.pool.DB, gID, wID, "revoked")

	h.invalidateVisibilityForUsers([]string{gID, wID})

	payload := map[string]interface{}{"guardianId": gID, "wardId": wID, "status": "revoked", "expiresAt": nil}
	c.Send("guardianUpdated", payload)
	h.emitMyGuardians(c, user.UserID)
	h.emitPendingRequests(c, user.UserID)

	otherID := wID
	if user.UserID == wID {
		otherID = gID
	}
	if otherCli := h.GetClientByUserID(otherID); otherCli != nil {
		otherCli.Send("guardianUpdated", payload)
		h.emitMyGuardians(otherCli, otherID)
		h.emitPendingRequests(otherCli, otherID)
	}
}
