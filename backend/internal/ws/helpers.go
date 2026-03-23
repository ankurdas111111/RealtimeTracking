package ws

import (
	"strings"
	"time"

	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/shared"
)

const (
	batchIntervalMs = 40
	maxPositionQueue = 500
)

// emitMyRooms builds and sends myRooms payload.
func (h *Hub) emitMyRooms(c *Client, userID string) {
	rooms := h.Cache.GetUserRooms(userID)
	payload := make([]map[string]interface{}, 0, len(rooms))
	for _, code := range rooms {
		room := h.Cache.GetRoom(code)
		if room == nil {
			continue
		}
		members := make([]map[string]interface{}, 0, len(room.Members))
		for mid := range room.Members {
			memberRole := h.Cache.GetRoomMemberRole(code, mid)
			memberRoomRole := "member"
			var roleExpiresAt *int64
			if memberRole != nil {
				memberRoomRole = memberRole.Role
				roleExpiresAt = memberRole.ExpiresAt
			}
			members = append(members, map[string]interface{}{
				"userId":       mid,
				"displayName":  h.Cache.GetDisplayName(mid),
				"roomRole":     memberRoomRole,
				"roleExpiresAt": roleExpiresAt,
			})
		}

		myRole := "member"
		if r := h.Cache.GetRoomMemberRole(code, userID); r != nil {
			myRole = r.Role
		}

		// Include pending admin requests for this room.
		pending := make([]map[string]interface{}, 0)
		reqs := h.Cache.GetRoomAdminRequests(code)
		totalEligible := len(room.Members) - 1
		for _, req := range reqs {
			if req == nil {
				continue
			}
			myVote := interface{}(nil)
			if req.Approvals != nil && req.Approvals[userID] {
				myVote = "approve"
			} else if req.Denials != nil && req.Denials[userID] {
				myVote = "deny"
			}
			pending = append(pending, map[string]interface{}{
				"from":          req.From,
				"fromName":      h.Cache.GetDisplayName(req.From),
				"expiresIn":     req.ExpiresIn,
				"approvals":     len(req.Approvals),
				"denials":       len(req.Denials),
				"totalEligible": totalEligible,
				"myVote":        myVote,
				"isMe":          req.From == userID,
			})
		}

		payload = append(payload, map[string]interface{}{
			"code":                 code,
			"name":                 room.Name,
			"members":              members,
			"createdBy":            room.CreatedBy,
			"myRoomRole":           myRole,
			"pendingAdminRequests": pending,
		})
	}
	c.Send("myRooms", payload)
}

// emitMyContacts builds and sends myContacts payload.
func (h *Hub) emitMyContacts(c *Client, userID string) {
	rooms := h.Cache.GetUserRooms(userID)
	contacts := h.Cache.GetContactsForUser(userID)
	payload := make([]map[string]interface{}, 0, len(contacts))
	for _, uid := range contacts {
		name := h.Cache.GetDisplayName(uid)
		payload = append(payload, map[string]interface{}{
			"userId": uid, "displayName": name, "inRooms": h.userInRooms(uid, rooms),
		})
	}
	c.Send("myContacts", payload)
}

// emitMyGuardians builds and sends myGuardians payload.
func (h *Hub) emitMyGuardians(c *Client, userID string) {
	asGuardian := h.Cache.GetGuardianshipsAsGuardian(userID)
	asWard := h.Cache.GetGuardianshipsAsWard(userID)
	manageable := h.getManageableUsers(userID)
	payload := map[string]interface{}{
		"asGuardian": asGuardian, "asWard": asWard, "manageable": manageable,
	}
	c.Send("myGuardians", payload)
}

// emitMyLiveLinks builds and sends myLiveLinks payload.
func (h *Hub) emitMyLiveLinks(c *Client, userID string) {
	tokens := h.Cache.GetLiveTokensForUser(userID)
	payload := make([]map[string]interface{}, 0, len(tokens))
	for token, exp := range tokens {
		payload = append(payload, map[string]interface{}{"token": token, "expiresAt": exp})
	}
	c.Send("myLiveLinks", payload)
}

// emitPendingRequests builds and sends pendingRequests payload.
func (h *Hub) emitPendingRequests(c *Client, userID string) {
	reqs := h.Cache.BuildPendingRequestsPayload(userID)
	c.Send("pendingRequests", reqs)
}

// emitToVisible sends event to all visible sockets (excludes self).
func (h *Hub) emitToVisible(user *cache.ActiveUser, event string, data interface{}) {
	sids := h.Cache.GetVisibleSocketIDs(user)
	h.SendToClients(sids, event, data)
}

// emitToVisibleAndSelf sends to self + all visible.
func (h *Hub) emitToVisibleAndSelf(user *cache.ActiveUser, event string, data interface{}) {
	h.SendToClient(user.SocketID, event, data)
	h.emitToVisible(user, event, data)
}

// scheduleVisibilityRefresh re-sends visible user list if changed.
func (h *Hub) scheduleVisibilityRefresh(c *Client, user *cache.ActiveUser) {
	visible := h.Cache.GetVisibleSet(user.UserID)
	lastSet := h.Cache.GetLastVisibleSet(c.ID())
	_ = visible
	if lastSet != nil && len(lastSet) == len(visible) {
		changed := false
		for uid := range visible {
			if !lastSet[uid] {
				changed = true
				break
			}
		}
		if !changed {
			return
		}
	}
	h.Cache.SetLastVisibleSet(c.ID(), visible)
	payload := h.Cache.BuildExistingUsersPayload(user.UserID)
	c.Send("visibilityRefresh", payload)
}

// getVisibleSet returns visible user IDs for a user.
func (h *Hub) getVisibleSet(userID string) map[string]bool {
	return h.Cache.GetVisibleSet(userID)
}

// getVisibleSocketIDs returns socket IDs of visible users.
func (h *Hub) getVisibleSocketIDs(user *cache.ActiveUser) []string {
	return h.Cache.GetVisibleSocketIDs(user)
}

// invalidateVisibility clears visibility cache for user.
func (h *Hub) invalidateVisibility(userID string) {
	h.Cache.InvalidateVisibility(userID)
}

// invalidateVisibilityForUsers clears visibility cache for multiple users.
func (h *Hub) invalidateVisibilityForUsers(userIDs []string) {
	for _, uid := range userIDs {
		h.Cache.InvalidateVisibility(uid)
	}
	// Also invalidate anyone whose cached set includes one of these
	h.Cache.InvalidateVisibilityForUsers(userIDs)
}

// parseExpiresIn parses "1h","6h","24h","48h","7d","30d" to ms timestamp.
func (h *Hub) parseExpiresIn(exp string) *int64 {
	if exp == "" {
		return nil
	}
	now := time.Now().UnixMilli()
	var ms int64
	switch exp {
	case "1h":
		ms = 60 * 60 * 1000
	case "6h":
		ms = 6 * 60 * 60 * 1000
	case "24h":
		ms = 24 * 60 * 60 * 1000
	case "48h":
		ms = 48 * 60 * 60 * 1000
	case "7d":
		ms = 7 * 24 * 60 * 60 * 1000
	case "30d":
		ms = 30 * 24 * 60 * 60 * 1000
	default:
		return nil
	}
	t := now + ms
	return &t
}

// runAutoRules runs geofence, no-move, hard-stop auto-SOS rules.
func (h *Hub) runAutoRules(user *cache.ActiveUser) {
	if !user.AutoSOS.Enabled {
		return
	}
	now := time.Now().UnixMilli()

	// Hard stop: was moving fast, then stopped
	if user.AutoSOS.HardStopMin > 0 && user.HardStopAt != nil {
		elapsed := (now - *user.HardStopAt) / 60000
		if elapsed >= int64(user.AutoSOS.HardStopMin) && !user.SOS.Active {
			reason := "Hard stop detected"
			h.setSos(user, true, reason, "", "auto")
			return
		}
	}

	// No move
	if user.AutoSOS.NoMoveMinutes > 0 && user.LastMoveAt > 0 {
		elapsed := (now - user.LastMoveAt) / 60000
		if elapsed >= int64(user.AutoSOS.NoMoveMinutes) && !user.SOS.Active {
			reason := "No movement detected"
			h.setSos(user, true, reason, "", "auto")
			return
		}
	}

	// Geofence
	if user.AutoSOS.Geofence && user.Geofence.Enabled && user.Geofence.CenterLat != nil && user.Geofence.CenterLng != nil {
		if user.Latitude != nil && user.Longitude != nil {
			dist := shared.HaversineM(*user.Geofence.CenterLat, *user.Geofence.CenterLng, *user.Latitude, *user.Longitude)
			if dist > user.Geofence.RadiusM && !user.SOS.Active {
				reason := "Left geofence area"
				h.setSos(user, true, reason, "", "auto")
			}
		}
	}
}

// emitSosUpdate broadcasts SOS to contacts, visible, self, and live links.
func (h *Hub) emitSosUpdate(user *cache.ActiveUser) {
	payload := h.publicSos(user)
	h.emitToVisibleAndSelf(user, "sosUpdate", payload)
	h.emitLiveSos(user)
}

// emitLiveSos broadcasts SOS to live links.
func (h *Hub) emitLiveSos(user *cache.ActiveUser) {
	payload := h.publicSos(user)
	tokens := h.Cache.GetLiveTokensForUser(user.UserID)
	for token := range tokens {
		h.SendToGroup("live:"+token, "liveSosUpdate", payload)
	}
}

// emitLiveCheckIn broadcasts check-in to live links.
func (h *Hub) emitLiveCheckIn(user *cache.ActiveUser) {
	ci := map[string]interface{}{
		"userId": user.UserID, "lastCheckInAt": user.CheckIn.LastCheckInAt,
	}
	tokens := h.Cache.GetLiveTokensForUser(user.UserID)
	for token := range tokens {
		h.SendToGroup("live:"+token, "liveCheckInUpdate", ci)
	}
}

// publicSos builds public SOS payload.
func (h *Hub) publicSos(user *cache.ActiveUser) map[string]interface{} {
	return map[string]interface{}{
		"socketId": user.SocketID, "userId": user.UserID, "displayName": user.DisplayName,
		"sos": map[string]interface{}{
			"active": user.SOS.Active, "at": user.SOS.At, "reason": user.SOS.Reason,
			"type": user.SOS.Type, "acks": user.SOS.Acks,
		},
	}
}

// setSos sets or clears SOS state on user.
func (h *Hub) setSos(user *cache.ActiveUser, active bool, reason, ackBy, sosType string) {
	user.SOS.Active = active
	if active {
		now := time.Now().UnixMilli()
		user.SOS.At = &now
		r := reason
		user.SOS.Reason = &r
		t := sosType
		user.SOS.Type = &t
		if ackBy != "" {
			user.SOS.Acks = append(user.SOS.Acks, ackBy)
		}
	} else {
		user.SOS.At = nil
		user.SOS.Reason = nil
		user.SOS.Type = nil
		user.SOS.Acks = nil
		user.SOS.Token = nil
		user.SOS.TokenExp = nil
	}
}

// emitWatch broadcasts to watch:token group.
func (h *Hub) emitWatch(user *cache.ActiveUser) {
	if user.SOS.Token == nil {
		return
	}
	payload := h.publicSos(user)
	h.SendToGroup("watch:"+*user.SOS.Token, "watchUpdate", payload)
}

// maskEmail masks email for display.
func (h *Hub) maskEmail(email string) string {
	if email == "" {
		return ""
	}
	at := strings.Index(email, "@")
	if at <= 0 {
		return "***"
	}
	return email[:1] + "***" + email[at:]
}

// maskMobile masks mobile for display.
func (h *Hub) maskMobile(mobile string) string {
	if mobile == "" {
		return ""
	}
	if len(mobile) <= 4 {
		return "***"
	}
	return "***" + mobile[len(mobile)-4:]
}

// getManageableUsers returns user IDs this user can manage (wards).
func (h *Hub) getManageableUsers(userID string) []string {
	return h.Cache.GetManageableUsers(userID)
}

// emitAdminOverview builds and sends full admin overview.
func (h *Hub) emitAdminOverview(c *Client) {
	payload := h.Cache.BuildAdminOverviewPayload()
	c.Send("adminOverview", payload)
}

// queuePositionBroadcast queues a position update for batched broadcast.
func (h *Hub) queuePositionBroadcast(user *cache.ActiveUser, data map[string]interface{}) {
	h.positionTimerMu.Lock()
	defer h.positionTimerMu.Unlock()
	if len(h.pendingPositions) >= maxPositionQueue {
		// Drop oldest
		for k := range h.pendingPositions {
			delete(h.pendingPositions, k)
			break
		}
	}
	h.pendingPositions[user.SocketID] = positionBroadcast{user: user, data: data}
	if h.positionTimer == nil {
		h.positionTimer = time.AfterFunc(batchIntervalMs*time.Millisecond, h.flushPositionBroadcasts)
	}
}

// flushPositionBroadcasts sends all queued position updates.
func (h *Hub) flushPositionBroadcasts() {
	h.positionTimerMu.Lock()
	batch := make(map[string]positionBroadcast)
	for k, v := range h.pendingPositions {
		batch[k] = v
	}
	h.pendingPositions = make(map[string]positionBroadcast)
	h.positionTimer = nil
	h.positionTimerMu.Unlock()

	serverTs := time.Now().UnixMilli()
	for _, pb := range batch {
		pb.data["serverTs"] = serverTs
		h.emitToVisible(pb.user, "userUpdate", pb.data)
	}
}

// userInRooms returns room codes from roomCodes that userID is a member of.
func (h *Hub) userInRooms(userID string, roomCodes []string) []string {
	userRooms := h.Cache.GetUserRooms(userID)
	set := make(map[string]bool)
	for _, c := range userRooms {
		set[c] = true
	}
	var out []string
	for _, code := range roomCodes {
		if set[code] {
			out = append(out, code)
		}
	}
	return out
}
