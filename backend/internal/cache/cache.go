package cache

import (
	"log/slog"
	"strings"
	"sync"

	"kinnect-v3/internal/db"
)

// SOS holds SOS alert state for an active user.
type SOS struct {
	Active   bool
	At       *int64
	Reason   *string
	Type     *string
	Acks     []string
	Token    *string
	TokenExp *int64
}

// Geofence holds geofence config for an active user.
type Geofence struct {
	Enabled   bool
	CenterLat *float64
	CenterLng *float64
	RadiusM   float64
	WasInside *bool
}

// AutoSOS holds auto-SOS config for an active user.
type AutoSOS struct {
	Enabled       bool
	NoMoveMinutes int
	HardStopMin   int
	Geofence      bool
}

// CheckIn holds check-in config for an active user.
type CheckIn struct {
	Enabled        bool
	IntervalMin    int
	OverdueMin     int
	LastCheckInAt  int64
}

// Retention holds retention mode for an active user.
type Retention struct {
	Mode    string
	ClientID string
}

// ActiveUser represents a connected user with full runtime state.
type ActiveUser struct {
	SocketID         string
	UserID           string
	DisplayName      string
	Role             string
	Latitude         *float64
	Longitude        *float64
	Speed            float64
	LastUpdate       int64
	FormattedTime    string
	Accuracy         *float64
	BatteryPct       *int
	DeviceType       *string
	ConnectionQuality *string
	LastMoveAt       int64
	LastSpeed        float64
	HardStopAt       *int64
	SOS              SOS
	Geofence         Geofence
	AutoSOS          AutoSOS
	CheckIn          CheckIn
	Retention        *Retention
	Rooms            []string
	Online           bool
	ForceDelete      bool
}

// WatchTokenEntry holds watch token state.
type WatchTokenEntry struct {
	SocketID string
	UserID   string
	Exp      int64
}

// OfflineEntry holds an offline user with expiry.
type OfflineEntry struct {
	User     *ActiveUser
	ExpiresAt *int64
}

// Cache is the thread-safe in-memory cache. All access goes through methods.
type Cache struct {
	mu sync.RWMutex

	// Persistent (from DB)
	UsersCache      map[string]*db.UserCacheEntry
	ShareCodes      map[string]string
	EmailIndex      map[string]string
	MobileIndex     map[string]string
	Rooms           map[string]*db.RoomEntry
	RoomMemberRoles map[string]map[string]*db.RoomMemberRole
	Contacts        map[string]map[string]bool
	LiveTokens      map[string]*db.LiveTokenEntry
	Guardianships   map[string]map[string]*db.GuardianshipEntry

	// Reverse indexes for O(1) lookups
	WardToGuardians  map[string]map[string]bool // wardID -> set of guardianIDs
	OfflineBySocketID map[string]string         // socketID -> userID

	// Ephemeral
	WatchTokens      map[string]*WatchTokenEntry
	ActiveUsers      map[string]*ActiveUser
	OfflineUsers     map[string]*OfflineEntry
	VisibilityCache  map[string]map[string]bool
	LastVisibleSets  map[string]map[string]bool
	LastPositionAt   map[string]int64
	LastDbSaveAt     map[string]int64
	PendingRequests  map[string][]interface{}
	UserIdToSocketId map[string]string
	LiveTokensByUser map[string]map[string]bool
	UserRooms        map[string]map[string]bool
	AdminClientIds   map[string]bool

	// Lazy loading
	lazyLoader *LazyLoader
}

// New creates a new Cache.
func New() *Cache {
	return &Cache{
		UsersCache:        make(map[string]*db.UserCacheEntry),
		ShareCodes:        make(map[string]string),
		EmailIndex:        make(map[string]string),
		MobileIndex:       make(map[string]string),
		Rooms:             make(map[string]*db.RoomEntry),
		RoomMemberRoles:   make(map[string]map[string]*db.RoomMemberRole),
		Contacts:          make(map[string]map[string]bool),
		LiveTokens:        make(map[string]*db.LiveTokenEntry),
		Guardianships:     make(map[string]map[string]*db.GuardianshipEntry),
		WardToGuardians:   make(map[string]map[string]bool),
		OfflineBySocketID: make(map[string]string),
		WatchTokens:       make(map[string]*WatchTokenEntry),
		ActiveUsers:       make(map[string]*ActiveUser),
		OfflineUsers:      make(map[string]*OfflineEntry),
		VisibilityCache:   make(map[string]map[string]bool),
		LastVisibleSets:   make(map[string]map[string]bool),
		LastPositionAt:    make(map[string]int64),
		LastDbSaveAt:      make(map[string]int64),
		PendingRequests:   make(map[string][]interface{}),
		UserIdToSocketId:  make(map[string]string),
		LiveTokensByUser:  make(map[string]map[string]bool),
		UserRooms:         make(map[string]map[string]bool),
		AdminClientIds:    make(map[string]bool),
		lazyLoader:        nil, // Set via SetLazyLoader
	}
}

// Init populates the cache from LoadAllResult.
func (c *Cache) Init(result *db.LoadAllResult) {
	if result == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	c.UsersCache = result.UsersCache
	if c.UsersCache == nil {
		c.UsersCache = make(map[string]*db.UserCacheEntry)
	}
	c.ShareCodes = result.ShareCodes
	if c.ShareCodes == nil {
		c.ShareCodes = make(map[string]string)
	}
	c.EmailIndex = result.EmailIndex
	if c.EmailIndex == nil {
		c.EmailIndex = make(map[string]string)
	}
	c.MobileIndex = result.MobileIndex
	if c.MobileIndex == nil {
		c.MobileIndex = make(map[string]string)
	}
	c.Rooms = result.Rooms
	if c.Rooms == nil {
		c.Rooms = make(map[string]*db.RoomEntry)
	}
	c.RoomMemberRoles = result.RoomMemberRoles
	if c.RoomMemberRoles == nil {
		c.RoomMemberRoles = make(map[string]map[string]*db.RoomMemberRole)
	}
	c.Contacts = result.Contacts
	if c.Contacts == nil {
		c.Contacts = make(map[string]map[string]bool)
	}
	c.LiveTokens = result.LiveTokens
	if c.LiveTokens == nil {
		c.LiveTokens = make(map[string]*db.LiveTokenEntry)
	}
	c.Guardianships = result.Guardianships
	if c.Guardianships == nil {
		c.Guardianships = make(map[string]map[string]*db.GuardianshipEntry)
	}

	// Build WardToGuardians reverse index from loaded guardianships
	c.WardToGuardians = make(map[string]map[string]bool)
	for guardianID, wards := range c.Guardianships {
		for wardID := range wards {
			if c.WardToGuardians[wardID] == nil {
				c.WardToGuardians[wardID] = make(map[string]bool)
			}
			c.WardToGuardians[wardID][guardianID] = true
		}
	}

	for key, reqs := range result.RoomAdminRequests {
		if c.PendingRequests == nil {
			c.PendingRequests = make(map[string][]interface{})
		}
		for _, r := range reqs {
			c.PendingRequests[key] = append(c.PendingRequests[key], r)
		}
	}

	for token, entry := range c.LiveTokens {
		if c.LiveTokensByUser == nil {
			c.LiveTokensByUser = make(map[string]map[string]bool)
		}
		if c.LiveTokensByUser[entry.UserID] == nil {
			c.LiveTokensByUser[entry.UserID] = make(map[string]bool)
		}
		c.LiveTokensByUser[entry.UserID][token] = true
	}

	for code, room := range c.Rooms {
		for memberID := range room.Members {
			if c.UserRooms == nil {
				c.UserRooms = make(map[string]map[string]bool)
			}
			if c.UserRooms[memberID] == nil {
				c.UserRooms[memberID] = make(map[string]bool)
			}
			c.UserRooms[memberID][code] = true
		}
	}

	slog.Info("Cache initialized",
		"users", len(c.UsersCache),
		"rooms", len(c.Rooms),
		"contacts", len(c.Contacts),
		"live_tokens", len(c.LiveTokens),
		"guardianships", len(c.Guardianships))
}

// GetUserIDByEmail returns user ID for an email (case-insensitive).
func (c *Cache) GetUserIDByEmail(email string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.EmailIndex[strings.ToLower(email)]
}

// GetUserIDByMobile returns user ID for a mobile number.
func (c *Cache) GetUserIDByMobile(mobile string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.MobileIndex[mobile]
}

// GetUserRole returns the role for a user.
func (c *Cache) GetUserRole(userID string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if u := c.UsersCache[userID]; u != nil {
		return u.Role
	}
	return ""
}

// RoomCount returns the number of rooms in the cache.
func (c *Cache) RoomCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.Rooms)
}

// ShareCodeExists returns true if the share code is already used.
func (c *Cache) ShareCodeExists(code string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.ShareCodes[code]
	return ok
}

// GetLiveToken returns the live token entry, or nil.
func (c *Cache) GetLiveToken(token string) *db.LiveTokenEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.LiveTokens[token]
}

// DeleteLiveToken removes a live token from the cache.
func (c *Cache) DeleteLiveToken(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.LiveTokens[token]; e != nil {
		delete(c.LiveTokens, token)
		if c.LiveTokensByUser[e.UserID] != nil {
			delete(c.LiveTokensByUser[e.UserID], token)
		}
	}
}

// GetWatchToken returns the watch token entry, or nil.
func (c *Cache) GetWatchToken(token string) *WatchTokenEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.WatchTokens[token]
}

// DeleteWatchToken removes a watch token from the cache.
func (c *Cache) DeleteWatchToken(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.WatchTokens, token)
}

// GetDisplayName returns the display name for a user.
func (c *Cache) GetDisplayName(userID string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	u, ok := c.UsersCache[userID]
	if !ok {
		return "Unknown"
	}
	name := u.FirstName + " " + u.LastName
	if name == "" {
		return "Unknown"
	}
	return name
}

// GetUsersCache returns a copy of UsersCache (caller must hold lock for direct access patterns).
// For simple reads, use RLock and read.
func (c *Cache) GetUsersCache() map[string]*db.UserCacheEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.UsersCache
}

// GetUserRooms returns room codes the user is a member of.
func (c *Cache) GetUserRooms(userID string) []string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	roomSet, ok := c.UserRooms[userID]
	if !ok || len(roomSet) == 0 {
		return nil
	}
	out := make([]string, 0, len(roomSet))
	for code := range roomSet {
		out = append(out, code)
	}
	return out
}

// GetVisibleSet returns the set of user IDs visible to the given user (rooms, contacts both ways).
// Uses VisibilityCache when available; otherwise computes and caches.
func (c *Cache) GetVisibleSet(userID string) map[string]bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	if cached, ok := c.VisibilityCache[userID]; ok && len(cached) > 0 {
		return cached
	}
	visible := make(map[string]bool)
	visible[userID] = true

	// Room members
	if roomSet, ok := c.UserRooms[userID]; ok {
		for code := range roomSet {
			if room, ok := c.Rooms[code]; ok {
				for mid := range room.Members {
					visible[mid] = true
				}
			}
		}
	}

	// Contacts are stored bidirectionally, so Contacts[userID] covers both directions.
	if contactSet, ok := c.Contacts[userID]; ok {
		for cid := range contactSet {
			visible[cid] = true
		}
	}

	c.VisibilityCache[userID] = visible
	return visible
}

// InvalidateVisibility clears cached visibility for a user (call after room/contact mutations).
func (c *Cache) InvalidateVisibility(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.VisibilityCache, userID)
}

// GetVisibleSocketIDs returns socket IDs of users who can see targetUser (for emitToVisible).
// Includes admins. Excludes targetUser's own socket.
func (c *Cache) GetVisibleSocketIDs(targetUser *ActiveUser) []string {
	c.mu.Lock()
	defer c.mu.Unlock()

	visibleSet := c.getVisibleSetLocked(targetUser.UserID)
	var out []string
	for uid := range visibleSet {
		if uid == targetUser.UserID {
			continue
		}
		if sid, ok := c.UserIdToSocketId[uid]; ok && sid != targetUser.SocketID {
			out = append(out, sid)
		}
	}
	for sid := range c.AdminClientIds {
		if sid != targetUser.SocketID {
			out = append(out, sid)
		}
	}
	return out
}

// getVisibleSetLocked assumes c.mu is held. Returns visible set for userID.
// Includes: self, room members, contacts (both directions), guardians/wards.
func (c *Cache) getVisibleSetLocked(userID string) map[string]bool {
	if cached, ok := c.VisibilityCache[userID]; ok && len(cached) > 0 {
		return cached
	}
	visible := make(map[string]bool)
	visible[userID] = true
	if roomSet, ok := c.UserRooms[userID]; ok {
		for code := range roomSet {
			if room, ok := c.Rooms[code]; ok {
				for mid := range room.Members {
					visible[mid] = true
				}
			}
		}
	}
	// Contacts are stored bidirectionally, so Contacts[userID] already covers both directions.
	if contactSet, ok := c.Contacts[userID]; ok {
		for cid := range contactSet {
			visible[cid] = true
		}
	}
	// Guardians: I see my wards (I am guardian) and my guardians (WardToGuardians index)
	if wards, ok := c.Guardianships[userID]; ok {
		for wID, e := range wards {
			if e != nil && (e.Status == "active" || e.Status == "pending") {
				visible[wID] = true
			}
		}
	}
	for gID := range c.WardToGuardians[userID] {
		if wards, ok := c.Guardianships[gID]; ok {
			if e := wards[userID]; e != nil && (e.Status == "active" || e.Status == "pending") {
				visible[gID] = true
			}
		}
	}
	c.VisibilityCache[userID] = visible
	return visible
}

// SanitizeUser produces a map suitable for JSON emission to clients.
// Always returns a fresh map; callers may safely mutate it.
func (c *Cache) SanitizeUser(user *ActiveUser) map[string]interface{} {
	result := map[string]interface{}{
		"socketId":        user.SocketID,
		"userId":          user.UserID,
		"displayName":     user.DisplayName,
		"role":            user.Role,
		"latitude":        user.Latitude,
		"longitude":       user.Longitude,
		"speed":           user.Speed,
		"lastUpdate":      user.LastUpdate,
		"formattedTime":   user.FormattedTime,
		"batteryPct":      user.BatteryPct,
		"deviceType":      user.DeviceType,
		"connectionQuality": user.ConnectionQuality,
		"online":          user.Online,
		"rooms":           user.Rooms,
		"sos": map[string]interface{}{
			"active": user.SOS.Active,
			"at":     user.SOS.At,
			"reason": user.SOS.Reason,
			"type":   user.SOS.Type,
		},
		"geofence": map[string]interface{}{
			"enabled":   user.Geofence.Enabled,
			"centerLat": user.Geofence.CenterLat,
			"centerLng": user.Geofence.CenterLng,
			"radiusM":   user.Geofence.RadiusM,
		},
		"autoSos": map[string]interface{}{
			"enabled":   user.AutoSOS.Enabled,
			"noMoveMinutes":  user.AutoSOS.NoMoveMinutes,
			"hardStopMin":    user.AutoSOS.HardStopMin,
			"geofence": user.AutoSOS.Geofence,
		},
		"checkIn": map[string]interface{}{
			"enabled":       user.CheckIn.Enabled,
			"intervalMin":   user.CheckIn.IntervalMin,
			"overdueMin":    user.CheckIn.OverdueMin,
			"lastCheckInAt": user.CheckIn.LastCheckInAt,
		},
		"retention": nil,
	}
	if user.Retention != nil {
		result["retention"] = map[string]interface{}{"mode": user.Retention.Mode}
	}
	return result
}

// GetUser returns a user cache entry by ID. Caller must not modify.
func (c *Cache) GetUser(userID string) *db.UserCacheEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.UsersCache[userID]
}

// HasShareCode returns true if the share code exists.
func (c *Cache) HasShareCode(code string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.ShareCodes[code]
	return ok
}

// GetUserIDByShareCode returns the user ID for a share code, or "".
func (c *Cache) GetUserIDByShareCode(code string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ShareCodes[code]
}

// SetActiveUser adds or replaces an active user. Also updates UserIdToSocketId and AdminClientIds.
func (c *Cache) SetActiveUser(socketID string, user *ActiveUser) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ActiveUsers[socketID] = user
	c.UserIdToSocketId[user.UserID] = socketID
	if user.Role == "admin" {
		c.AdminClientIds[socketID] = true
	}
}

// DeleteActiveUser removes an active user by socket ID and cleans related maps.
func (c *Cache) DeleteActiveUser(socketID string) *ActiveUser {
	c.mu.Lock()
	defer c.mu.Unlock()
	u := c.ActiveUsers[socketID]
	if u != nil && c.UserIdToSocketId[u.UserID] == socketID {
		delete(c.UserIdToSocketId, u.UserID)
	}
	delete(c.ActiveUsers, socketID)
	delete(c.AdminClientIds, socketID)
	delete(c.LastVisibleSets, socketID)
	return u
}

// GetActiveUser returns the active user by socket ID, or nil.
func (c *Cache) GetActiveUser(socketID string) *ActiveUser {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ActiveUsers[socketID]
}

// SetUserIdToSocketId sets the mapping from user ID to socket ID.
func (c *Cache) SetUserIdToSocketId(userID, socketID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.UserIdToSocketId[userID] = socketID
}

// DeleteUserIdToSocketId removes the mapping for a user ID.
func (c *Cache) DeleteUserIdToSocketId(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.UserIdToSocketId, userID)
}

// GetUserIdToSocketId returns the socket ID for a user, or "".
func (c *Cache) GetUserIdToSocketId(userID string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.UserIdToSocketId[userID]
}

// GetOfflineUser returns the offline entry for a user, or nil.
func (c *Cache) GetOfflineUser(userID string) *OfflineEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.OfflineUsers[userID]
}

// SetOfflineUser adds or updates an offline user entry.
func (c *Cache) SetOfflineUser(userID string, entry *OfflineEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Remove old socketID index entry if present
	if old := c.OfflineUsers[userID]; old != nil && old.User != nil {
		delete(c.OfflineBySocketID, old.User.SocketID)
	}
	c.OfflineUsers[userID] = entry
	if entry != nil && entry.User != nil {
		c.OfflineBySocketID[entry.User.SocketID] = userID
	}
}

// DeleteOfflineUser removes an offline user.
func (c *Cache) DeleteOfflineUser(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry := c.OfflineUsers[userID]; entry != nil && entry.User != nil {
		delete(c.OfflineBySocketID, entry.User.SocketID)
	}
	delete(c.OfflineUsers, userID)
}

// GetOfflineUserBySocketID returns the ActiveUser for an offline user with the given socket ID, or nil.
func (c *Cache) GetOfflineUserBySocketID(socketID string) *ActiveUser {
	c.mu.RLock()
	defer c.mu.RUnlock()
	uid := c.OfflineBySocketID[socketID]
	if uid == "" {
		return nil
	}
	if entry := c.OfflineUsers[uid]; entry != nil {
		return entry.User
	}
	return nil
}

// SetAdminClientId adds or removes a client ID from admin clients.
func (c *Cache) SetAdminClientId(clientID string, isAdmin bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if isAdmin {
		c.AdminClientIds[clientID] = true
	} else {
		delete(c.AdminClientIds, clientID)
	}
}

// DeleteAdminClientId removes a client from admin clients.
func (c *Cache) DeleteAdminClientId(clientID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.AdminClientIds, clientID)
}

// DeleteLastVisibleSet removes the last visible set for a socket.
func (c *Cache) DeleteLastVisibleSet(socketID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.LastVisibleSets, socketID)
}

// GetLastPositionAt returns last position timestamp for a client (by clientID). Used for 100ms cooldown.
func (c *Cache) GetLastPositionAt(clientID string) int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.LastPositionAt[clientID]
}

// SetLastPositionAt sets last position timestamp for a client.
func (c *Cache) SetLastPositionAt(clientID string, ts int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.LastPositionAt == nil {
		c.LastPositionAt = make(map[string]int64)
	}
	c.LastPositionAt[clientID] = ts
}

// DeleteLastPositionAt removes last position timestamp for a client (by clientID).
func (c *Cache) DeleteLastPositionAt(clientID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.LastPositionAt, clientID)
}

// GetLastDbSaveAt returns last DB save timestamp for a user. Used for 30s throttle.
func (c *Cache) GetLastDbSaveAt(userID string) int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.LastDbSaveAt[userID]
}

// SetLastDbSaveAt sets last DB save timestamp for a user.
func (c *Cache) SetLastDbSaveAt(userID string, ts int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.LastDbSaveAt == nil {
		c.LastDbSaveAt = make(map[string]int64)
	}
	c.LastDbSaveAt[userID] = ts
}

// DeleteLastDbSaveAt removes last DB save timestamp for a user.
func (c *Cache) DeleteLastDbSaveAt(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.LastDbSaveAt, userID)
}

// BuildExistingUsersPayload builds the existingUsers array for a viewer (under cache lock).
func (c *Cache) BuildExistingUsersPayload(viewerUserID string) []map[string]interface{} {
	c.mu.Lock()
	defer c.mu.Unlock()

	visibleSet := c.getVisibleSetLocked(viewerUserID)
	seen := make(map[string]bool)
	var out []map[string]interface{}

	for _, u := range c.ActiveUsers {
		if u.UserID == viewerUserID {
			continue // Skip self
		}
		if !visibleSet[u.UserID] {
			continue
		}
		if seen[u.UserID] {
			continue
		}
		seen[u.UserID] = true
		m := c.sanitizeUserLocked(u)
		m["online"] = true
		out = append(out, m)
	}

	for _, entry := range c.OfflineUsers {
		if entry.User.UserID == viewerUserID {
			continue // Skip self
		}
		if !visibleSet[entry.User.UserID] || seen[entry.User.UserID] {
			continue
		}
		seen[entry.User.UserID] = true
		m := c.sanitizeUserLocked(entry.User)
		m["online"] = false
		m["offlineExpiresAt"] = entry.ExpiresAt
		out = append(out, m)
	}

	for uid, uc := range c.UsersCache {
		if uid == viewerUserID {
			continue // Skip self
		}
		if seen[uid] || !visibleSet[uid] || uc.LastLat == nil || uc.LastLng == nil {
			continue
		}
		seen[uid] = true
		m := map[string]interface{}{
			"socketId":     "stored-" + uid,
			"userId":       uid,
			"displayName":  c.getDisplayNameLocked(uid),
			"role":         uc.Role,
			"latitude":     uc.LastLat,
			"longitude":    uc.LastLng,
			"speed":        uc.LastSpeed,
			"lastUpdate":   uc.LastUpdate,
			"formattedTime": "",
			"sos":          map[string]interface{}{"active": false},
			"online":       false,
		}
		out = append(out, m)
	}
	return out
}

// getDisplayNameLocked assumes c.mu is held.
func (c *Cache) getDisplayNameLocked(userID string) string {
	u, ok := c.UsersCache[userID]
	if !ok {
		return "Unknown"
	}
	name := u.FirstName + " " + u.LastName
	if name == "" {
		return "Unknown"
	}
	return name
}

// sanitizeUserLocked assumes c.mu is held. Returns a new map.
func (c *Cache) sanitizeUserLocked(user *ActiveUser) map[string]interface{} {
	return map[string]interface{}{
		"socketId": user.SocketID, "userId": user.UserID, "displayName": user.DisplayName,
		"role": user.Role, "latitude": user.Latitude, "longitude": user.Longitude,
		"speed": user.Speed, "lastUpdate": user.LastUpdate, "formattedTime": user.FormattedTime,
		"batteryPct": user.BatteryPct, "deviceType": user.DeviceType, "connectionQuality": user.ConnectionQuality,
		"sos": map[string]interface{}{"active": user.SOS.Active, "at": user.SOS.At, "reason": user.SOS.Reason, "type": user.SOS.Type},
		"geofence": map[string]interface{}{"enabled": user.Geofence.Enabled, "centerLat": user.Geofence.CenterLat, "centerLng": user.Geofence.CenterLng, "radiusM": user.Geofence.RadiusM},
		"autoSos": map[string]interface{}{"enabled": user.AutoSOS.Enabled, "noMoveMinutes": user.AutoSOS.NoMoveMinutes, "hardStopMinutes": user.AutoSOS.HardStopMin, "geofence": user.AutoSOS.Geofence},
		"checkIn": map[string]interface{}{"enabled": user.CheckIn.Enabled, "intervalMinutes": user.CheckIn.IntervalMin, "overdueMinutes": user.CheckIn.OverdueMin, "lastCheckInAt": user.CheckIn.LastCheckInAt},
		"retention": func() interface{} {
			if user.Retention != nil {
				return map[string]interface{}{"mode": user.Retention.Mode}
			}
			return map[string]interface{}{"mode": "default"}
		}(),
		"rooms": user.Rooms,
	}
}

// GetShareCodeInfo returns shareCode, email, mobile for a user.
func (c *Cache) GetShareCodeInfo(userID string) (shareCode, email, mobile string) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	u := c.UsersCache[userID]
	if u == nil {
		return "", "", ""
	}
	shareCode = u.ShareCode
	if u.Email != nil {
		email = *u.Email
	}
	if u.Mobile != nil {
		mobile = *u.Mobile
	}
	return shareCode, email, mobile
}

// AddUser adds a new user to the cache. Call after creating user in DB.
func (c *Cache) AddUser(userID string, entry *db.UserCacheEntry, shareCode string, email, mobile *string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.UsersCache[userID] = entry
	c.ShareCodes[shareCode] = userID
	if email != nil && *email != "" {
		c.EmailIndex[strings.ToLower(*email)] = userID
	}
	if mobile != nil && *mobile != "" {
		c.MobileIndex[*mobile] = userID
	}
}

// UpdateUserRole updates a user's role in the cache.
func (c *Cache) UpdateUserRole(userID, newRole string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if u := c.UsersCache[userID]; u != nil {
		u.Role = newRole
	}
}

// CacheSize returns an estimated size of the cache in bytes.
func (c *Cache) CacheSize() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var size int64
	const ptrSize = 8

	// Estimate for maps (key + value + overhead per entry)
	mapOverhead := int64(48)
	entryOverhead := int64(24)

	// UsersCache
	size += mapOverhead + int64(len(c.UsersCache))*(entryOverhead+ptrSize*2+256)

	// ShareCodes, EmailIndex, MobileIndex (string maps)
	size += mapOverhead + int64(len(c.ShareCodes))*(entryOverhead+64)
	size += mapOverhead + int64(len(c.EmailIndex))*(entryOverhead+64)
	size += mapOverhead + int64(len(c.MobileIndex))*(entryOverhead+64)

	// Rooms
	size += mapOverhead + int64(len(c.Rooms))*(entryOverhead+ptrSize*2+256)

	// RoomMemberRoles (nested map)
	size += mapOverhead
	for _, roles := range c.RoomMemberRoles {
		size += mapOverhead + int64(len(roles))*(entryOverhead+ptrSize*2+128)
	}

	// Contacts (nested map)
	size += mapOverhead
	for _, contacts := range c.Contacts {
		size += mapOverhead + int64(len(contacts))*(entryOverhead+ptrSize)
	}

	// LiveTokens
	size += mapOverhead + int64(len(c.LiveTokens))*(entryOverhead+ptrSize*2+128)

	// Guardianships (nested map)
	size += mapOverhead
	for _, gships := range c.Guardianships {
		size += mapOverhead + int64(len(gships))*(entryOverhead+ptrSize*2+128)
	}

	// ActiveUsers (largest contributor)
	size += mapOverhead
	for _, user := range c.ActiveUsers {
		userSize := int64(ptrSize * 20) // Various fields
		userSize += int64(len(user.SocketID) + len(user.UserID) + len(user.DisplayName) + len(user.Role))
		if user.Retention != nil {
			userSize += int64(len(user.Retention.ClientID))
		}
		if user.Rooms != nil {
			for _, room := range user.Rooms {
				userSize += int64(len(room))
			}
		}
		size += entryOverhead + userSize
	}

	// OfflineUsers
	size += mapOverhead + int64(len(c.OfflineUsers))*(entryOverhead+ptrSize*2+512)

	// Other maps
	size += mapOverhead + int64(len(c.VisibilityCache))*(entryOverhead+ptrSize*2+256)
	size += mapOverhead + int64(len(c.LastVisibleSets))*(entryOverhead+ptrSize*2+256)
	size += mapOverhead + int64(len(c.LastPositionAt))*(entryOverhead+64)
	size += mapOverhead + int64(len(c.LastDbSaveAt))*(entryOverhead+64)
	size += mapOverhead + int64(len(c.PendingRequests))*(entryOverhead+ptrSize*2+256)
	size += mapOverhead + int64(len(c.UserIdToSocketId))*(entryOverhead+64)

	// LiveTokensByUser (nested map)
	size += mapOverhead
	for _, tokens := range c.LiveTokensByUser {
		size += mapOverhead + int64(len(tokens))*(entryOverhead+ptrSize)
	}

	// UserRooms (nested map)
	size += mapOverhead
	for _, rooms := range c.UserRooms {
		size += mapOverhead + int64(len(rooms))*(entryOverhead+ptrSize)
	}

	size += mapOverhead + int64(len(c.AdminClientIds))*(entryOverhead+ptrSize)

	return size
}
