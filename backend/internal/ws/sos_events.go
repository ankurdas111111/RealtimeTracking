package ws

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"time"

	"kinnect-v3/internal/shared"
)

const (
	sosTokenBytes   = 16
	sosWatchExpiryMs = 24 * 60 * 60 * 1000
)

// generateSosToken returns a base64url random token for SOS watch links.
func generateSosToken() string {
	b := make([]byte, sosTokenBytes)
	_, _ = rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)[:22]
}

// handleTriggerSOS sets SOS active, creates watch token, emits to contacts/visible/live.
func (h *Hub) handleTriggerSOS(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("triggerSOS", 5) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	reason := ""
	if r, ok := m["reason"].(string); ok {
		reason = shared.SanitizeString(r, 100)
	}
	sosType := "manual"
	if t, ok := m["type"].(string); ok {
		sosType = shared.SanitizeString(t, 20)
	}
	if reason == "" {
		reason = "SOS triggered"
	}

	token := generateSosToken()
	exp := time.Now().UnixMilli() + sosWatchExpiryMs
	h.setSos(user, true, reason, "", sosType)
	user.SOS.Token = &token
	user.SOS.TokenExp = &exp

	// Store watch token for public /watch/:token page
	h.cache.SetWatchToken(token, user.SocketID, user.UserID, exp)

	// DB: live_tokens-style entry for watch - reuses watch token cache
	// No separate DB table for watch tokens in schema; watch uses in-memory only
	h.emitSosUpdate(user)
	h.emitWatch(user)
}

// handleCancelSOS clears SOS, deletes watch token, emits watchUpdate and sosUpdate.
func (h *Hub) handleCancelSOS(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("cancelSOS", 5) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	token := user.SOS.Token
	h.setSos(user, false, "", "", "")
	if token != nil {
		h.cache.DeleteWatchToken(*token)
	}
	h.emitWatch(user)
	payload := h.publicSos(user)
	h.emitToVisibleAndSelf(user, "sosUpdate", payload)
	h.emitLiveSos(user)
}

// handleAckSOS finds target by socketId, adds ack, emits sosUpdate.
func (h *Hub) handleAckSOS(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("ackSOS", 10) {
		return
	}
	m := toMap(data)
	socketId, _ := m["socketId"].(string)
	if socketId == "" {
		return
	}
	target := h.cache.GetActiveUser(socketId)
	if target == nil {
		return
	}
	ackerName := h.cache.GetDisplayName(c.UserID())
	target.SOS.Acks = append(target.SOS.Acks, ackerName)
	h.emitSosUpdate(target)
	h.emitWatch(target)
}

// handleCheckInAck updates lastCheckInAt, emits to visible+self and live links.
func (h *Hub) handleCheckInAck(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("checkInAck", 20) {
		return
	}
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	user.CheckIn.LastCheckInAt = time.Now().UnixMilli()
	sanitized := h.cache.SanitizeUser(user)
	sanitized["online"] = true
	ci := map[string]interface{}{
		"userId": user.UserID, "lastCheckInAt": user.CheckIn.LastCheckInAt,
	}
	h.emitToVisibleAndSelf(user, "checkInUpdate", ci)
	h.emitLiveCheckIn(user)
}

// handleSetCheckInRules updates check-in config on user, broadcasts userUpdate.
func (h *Hub) handleSetCheckInRules(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("setCheckInRules", 10) {
		return
	}
	m := toMap(data)
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	if v, ok := m["enabled"].(bool); ok {
		user.CheckIn.Enabled = v
	}
	if v, ok := toInt(m["intervalMin"]); ok && v >= 0 {
		user.CheckIn.IntervalMin = v
	}
	if v, ok := toInt(m["overdueMin"]); ok && v >= 0 {
		user.CheckIn.OverdueMin = v
	}
	sanitized := h.cache.SanitizeUser(user)
	sanitized["online"] = true
	h.emitToVisibleAndSelf(user, "userUpdate", sanitized)
}

// handleSetGeofence updates geofence config, broadcasts userUpdate.
func (h *Hub) handleSetGeofence(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("setGeofence", 10) {
		return
	}
	m := toMap(data)
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	if v, ok := m["enabled"].(bool); ok {
		user.Geofence.Enabled = v
	}
	if v, ok := toFloat64(m["centerLat"]); ok {
		user.Geofence.CenterLat = &v
	}
	if v, ok := toFloat64(m["centerLng"]); ok {
		user.Geofence.CenterLng = &v
	}
	if v, ok := toFloat64(m["radiusM"]); ok && v >= 0 {
		user.Geofence.RadiusM = v
	}
	sanitized := h.cache.SanitizeUser(user)
	sanitized["online"] = true
	h.emitToVisibleAndSelf(user, "userUpdate", sanitized)
}

// handleSetAutoSos updates auto-SOS config, broadcasts userUpdate.
func (h *Hub) handleSetAutoSos(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("setAutoSos", 10) {
		return
	}
	m := toMap(data)
	user := h.cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	if v, ok := m["enabled"].(bool); ok {
		user.AutoSOS.Enabled = v
	}
	if v, ok := toInt(m["noMoveMinutes"]); ok && v >= 0 {
		user.AutoSOS.NoMoveMinutes = v
	}
	if v, ok := toInt(m["hardStopMin"]); ok && v >= 0 {
		user.AutoSOS.HardStopMin = v
	}
	if v, ok := m["geofence"].(bool); ok {
		user.AutoSOS.Geofence = v
	}
	sanitized := h.cache.SanitizeUser(user)
	sanitized["online"] = true
	h.emitToVisibleAndSelf(user, "userUpdate", sanitized)
}

// handleLiveAckSOS: live viewer acks SOS; uses c.liveToken, c.liveViewerName.
func (h *Hub) handleLiveAckSOS(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("liveAckSOS", 10) {
		return
	}
	token := c.liveToken
	if token == "" {
		return
	}
	entry := h.cache.GetLiveToken(token)
	if entry == nil {
		return
	}
	targetSid := h.cache.GetUserIdToSocketId(entry.UserID)
	target := h.cache.GetActiveUser(targetSid)
	if target == nil {
		// Target offline - could use offlineUsers
		return
	}
	viewerName := c.liveViewerName
	if viewerName == "" {
		viewerName = "Viewer"
	}
	ackLabel := viewerName + " (via link)"
	target.SOS.Acks = append(target.SOS.Acks, ackLabel)
	h.emitSosUpdate(target)
	h.emitWatch(target)
}

func toInt(v interface{}) (int, bool) {
	switch x := v.(type) {
	case float64:
		return int(x), true
	case int:
		return x, true
	case int64:
		return int(x), true
	default:
		return 0, false
	}
}

func toFloat64(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	default:
		return 0, false
	}
}
