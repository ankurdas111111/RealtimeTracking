package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"kinnect-v3/internal/auth"
	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/config"
	"kinnect-v3/internal/db"
	"nhooyr.io/websocket"
)

const (
	chanRegisterBuf  = 256
	chanUnregisterBuf = 256
	chanDispatchBuf  = 1024
	chanBroadcastBuf = 512
	offlineGrace24h   = 24 * 60 * 60 * 1000
	offlineGrace48h   = 48 * 60 * 60 * 1000
)

type dispatchMsg struct {
	client *Client
	msg    *Message
}

type broadcastMsg struct {
	targetIDs []string
	event     string
	data      interface{}
}

// positionBroadcast holds a queued position update for batched broadcast.
type positionBroadcast struct {
	user *cache.ActiveUser
	data map[string]interface{}
}

// Hub is the central WebSocket hub — single goroutine multiplexes client management and broadcasts.
type Hub struct {
	Cache    *cache.Cache
	pool     *db.Pool
	config   *config.Config
	clients  map[string]*Client
	handlers map[string]func(*Client, json.RawMessage) // built once in NewHub

	register   chan *Client
	unregister chan *Client
	dispatch   chan *dispatchMsg
	broadcast  chan *broadcastMsg

	groups map[string]map[string]bool // groupName -> set of clientIDs

	positionBuffer []PositionRecord
	positionBufMu  sync.Mutex

	pendingPositions map[string]positionBroadcast
	positionTimer    *time.Timer
	positionTimerMu  sync.Mutex

	// Free-tier optimizations
	ConnLimiter     *ConnectionLimiter
	MemoryMonitor   *MemoryMonitor
	ShutdownOnce    sync.Once
	IsShuttingDown  bool

	// Redis (optional, for Render production)
	RedisCache       *cache.RedisCache
	RedisSessionStore *cache.RedisSessionStore

	mu sync.RWMutex
}

// NewHub creates a new Hub.
func NewHub(c *cache.Cache, p *db.Pool, cfg *config.Config) *Hub {
	h := &Hub{
		Cache:            c,
		pool:             p,
		config:           cfg,
		clients:          make(map[string]*Client),
		register:         make(chan *Client, chanRegisterBuf),
		unregister:       make(chan *Client, chanUnregisterBuf),
		dispatch:         make(chan *dispatchMsg, chanDispatchBuf),
		broadcast:        make(chan *broadcastMsg, chanBroadcastBuf),
		groups:           make(map[string]map[string]bool),
		pendingPositions: make(map[string]positionBroadcast),
		ConnLimiter:      NewConnectionLimiter(config.MaxWebSocketConnections),
		MemoryMonitor:    NewMemoryMonitor(10 * time.Second),
		IsShuttingDown:   false,
	}
	h.handlers = h.buildEventHandlers()
	return h
}

// buildEventHandlers constructs the event dispatch table once at startup.
func (h *Hub) buildEventHandlers() map[string]func(*Client, json.RawMessage) {
	return map[string]func(*Client, json.RawMessage){
		"position":             h.handlePosition,
		"positionBatch":        h.handlePositionBatch,
		"profileUpdate":        h.handleProfileUpdate,
		"setRetention":         h.handleSetRetention,
		"setRetentionForever":  h.handleSetRetentionForever,
		"adminDeleteUser":      h.handleAdminDeleteUser,
		"createRoom":           h.handleCreateRoom,
		"joinRoom":             h.handleJoinRoom,
		"leaveRoom":            h.handleLeaveRoom,
		"addContact":           h.handleAddContact,
		"removeContact":        h.handleRemoveContact,
		"createLiveLink":       h.handleCreateLiveLink,
		"revokeLiveLink":       h.handleRevokeLiveLink,
		"watchJoin":            h.handleWatchJoin,
		"liveJoin":             h.handleLiveJoin,
		"requestAdminOverview": h.handleRequestAdminOverview,
		"requestRoomAdmin":     h.handleRequestRoomAdmin,
		"voteRoomAdmin":        h.handleVoteRoomAdmin,
		"revokeRoomAdmin":      h.handleRevokeRoomAdmin,
		"requestGuardian":      h.handleRequestGuardian,
		"inviteGuardian":       h.handleInviteGuardian,
		"approveGuardian":      h.handleApproveGuardian,
		"denyGuardian":         h.handleDenyGuardian,
		"revokeGuardian":       h.handleRevokeGuardian,
		"triggerSOS":           h.handleTriggerSOS,
		"cancelSOS":            h.handleCancelSOS,
		"ackSOS":               h.handleAckSOS,
		"checkInAck":           h.handleCheckInAck,
		"setCheckInRules":      h.handleSetCheckInRules,
		"setGeofence":          h.handleSetGeofence,
		"setAutoSos":           h.handleSetAutoSos,
		"liveAckSOS":           h.handleLiveAckSOS,
	}
}

// Run is the main hub loop. Run in a goroutine.
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return

		case c := <-h.register:
			h.handleRegister(c)

		case c := <-h.unregister:
			h.handleUnregister(c)

		case dm := <-h.dispatch:
			h.handleDispatch(dm)

		case bm := <-h.broadcast:
			h.handleBroadcast(bm)
		}
	}
}

func (h *Hub) handleRegister(c *Client) {
	userID := c.UserID()
	role := c.Role()
	if role == "" {
		role = "user"
	}
	clientID := c.ID()

	displayName := h.Cache.GetDisplayName(userID)

	// 1. Check if user already connected (evict old connection)
	prevSid := h.Cache.GetUserIdToSocketId(userID)
	if prevSid != "" && prevSid != clientID {
		prevClient := h.GetClient(prevSid)
		if prevClient != nil {
			h.Cache.DeleteAdminClientId(prevSid)
			prevUser := h.Cache.GetActiveUser(prevSid)
			if prevUser != nil {
				visibleSids := h.Cache.GetVisibleSocketIDs(prevUser)
				for _, sid := range visibleSids {
					h.SendToClient(sid, "userDisconnect", prevSid)
				}
			}
			prevClient.Close()
		}
		h.Cache.DeleteActiveUser(prevSid)
		h.Cache.DeleteLastVisibleSet(prevSid)
	}

	// 2. Check if user is in offlineUsers (restore from offline)
	restoredFromOffline := false
	if offEntry := h.Cache.GetOfflineUser(userID); offEntry != nil {
		h.Cache.DeleteOfflineUser(userID)
		user := offEntry.User
		oldSocketId := user.SocketID
		visibleSids := h.Cache.GetVisibleSocketIDs(user)
		for _, sid := range visibleSids {
			h.SendToClient(sid, "userDisconnect", oldSocketId)
		}
		user.SocketID = clientID
		user.Role = role
		user.DisplayName = displayName
		user.Online = true
		user.Rooms = h.Cache.GetUserRooms(userID)
		h.Cache.SetActiveUser(clientID, user)
		h.Cache.SetUserIdToSocketId(userID, clientID)
		if role == "admin" {
			h.Cache.SetAdminClientId(clientID, true)
		}
		restoredFromOffline = true
	} else {
		// 3. Create ActiveUser entry in cache
		user := &cache.ActiveUser{
			SocketID:    clientID,
			UserID:      userID,
			DisplayName: displayName,
			Role:        role,
			LastUpdate:  time.Now().UnixMilli(),
			LastMoveAt:  time.Now().UnixMilli(),
			Rooms:       h.Cache.GetUserRooms(userID),
			Online:      true,
		}
		user.Retention = &cache.Retention{Mode: "default", ClientID: clientID}
		h.Cache.SetActiveUser(clientID, user)
		h.Cache.SetUserIdToSocketId(userID, clientID)
		if role == "admin" {
			h.Cache.SetAdminClientId(clientID, true)
		}
	}

	h.mu.Lock()
	h.clients[clientID] = c
	h.mu.Unlock()

	me := h.Cache.GetActiveUser(clientID)
	if me == nil {
		slog.Error("handleRegister: active user not found after register", "client", clientID)
		return
	}

	// 5. Build existingUsers list
	existingUsers := h.Cache.BuildExistingUsersPayload(userID)

	// 6. Send existingUsers to new client
	c.Send("existingUsers", existingUsers)

	// 7. Emit userConnected to visible users
	userConnectedData := map[string]interface{}{
		"socketId":    clientID,
		"userId":      userID,
		"displayName": displayName,
		"role":        role,
	}
	visibleSids := h.Cache.GetVisibleSocketIDs(me)
	for _, sid := range visibleSids {
		h.SendToClient(sid, "userConnected", userConnectedData)
	}

	if restoredFromOffline {
		sanitized := h.Cache.SanitizeUser(me)
		sanitized["online"] = true
		c.Send("userUpdate", sanitized)
		for _, sid := range visibleSids {
			h.SendToClient(sid, "userUpdate", sanitized)
		}
	}

	// 8. Send myShareCode, myRooms, myContacts, myGuardians, myLiveLinks, pendingRequests
	shareCode, email, mobile := h.Cache.GetShareCodeInfo(userID)
	c.Send("myShareCode", map[string]interface{}{
		"shareCode": shareCode,
		"email":     email,
		"mobile":    mobile,
	})
	h.emitMyRooms(c, userID)
	h.emitMyContacts(c, userID)
	h.emitMyGuardians(c, userID)
	h.emitMyLiveLinks(c, userID)
	h.emitPendingRequests(c, userID)
}

func (h *Hub) handleUnregister(c *Client) {
	clientID := c.ID()

	h.mu.Lock()
	delete(h.clients, clientID)
	h.leaveAllGroupsLocked(clientID)
	h.mu.Unlock()

	user := h.Cache.GetActiveUser(clientID)
	if user == nil {
		return
	}

	h.Cache.DeleteLastPositionAt(clientID)
	h.Cache.DeleteLastDbSaveAt(user.UserID)
	h.Cache.DeleteLastVisibleSet(clientID)
	h.Cache.DeleteAdminClientId(clientID)

	if user.ForceDelete {
		h.Cache.DeleteActiveUser(clientID)
		h.Cache.DeleteOfflineUser(user.UserID)
		visibleSids := h.Cache.GetVisibleSocketIDs(user)
		for _, sid := range visibleSids {
			h.SendToClient(sid, "userDisconnect", clientID)
		}
		return
	}

	h.Cache.DeleteActiveUser(clientID)
	h.Cache.DeleteUserIdToSocketId(user.UserID)

	// Retention mode
	var expiresAt *int64
	mode := "default"
	if user.Retention != nil {
		mode = user.Retention.Mode
	}
	now := time.Now().UnixMilli()
	if mode == "forever" {
		expiresAt = nil
	} else if mode == "48h" {
		t := now + offlineGrace48h
		expiresAt = &t
	} else {
		t := now + offlineGrace24h
		expiresAt = &t
	}

	user.Online = false
	h.Cache.SetOfflineUser(user.UserID, &cache.OfflineEntry{User: user, ExpiresAt: expiresAt})

	sanitized := h.Cache.SanitizeUser(user)
	sanitized["online"] = false
	sanitized["offlineExpiresAt"] = expiresAt
	visibleSids := h.Cache.GetVisibleSocketIDs(user)
	for _, sid := range visibleSids {
		h.SendToClient(sid, "userOffline", sanitized)
	}

	slog.Debug("User disconnected", "userId", user.UserID, "retention", mode)
}

func (h *Hub) leaveAllGroupsLocked(clientID string) {
	for groupName, members := range h.groups {
		if members[clientID] {
			delete(members, clientID)
			if len(members) == 0 {
				delete(h.groups, groupName)
			}
		}
	}
}

func (h *Hub) handleDispatch(dm *dispatchMsg) {
	handler, ok := h.handlers[dm.msg.Event]
	if ok {
		handler(dm.client, dm.msg.Data)
	} else {
		slog.Debug("Unknown event", "event", dm.msg.Event, "client", dm.client.ID())
	}
}

func (h *Hub) handleBroadcast(bm *broadcastMsg) {
	for _, id := range bm.targetIDs {
		if cli := h.GetClient(id); cli != nil {
			cli.Send(bm.event, bm.data)
		}
	}
}

// HandleUpgrade upgrades HTTP to WebSocket using nhooyr/websocket.
func (h *Hub) HandleUpgrade(w http.ResponseWriter, r *http.Request, sessionData *auth.SessionData) {
	if sessionData == nil || sessionData.User == nil || sessionData.User.ID == "" {
		slog.Warn("WebSocket upgrade rejected: no session/user",
			"hasSession", sessionData != nil,
			"hasUser", sessionData != nil && sessionData.User != nil,
			"origin", r.Header.Get("Origin"),
			"cookie", r.Header.Get("Cookie") != "")
		http.Error(w, "Session expired", http.StatusUnauthorized)
		return
	}

	userID := sessionData.User.ID
	role := sessionData.User.Role
	if role == "" {
		role = "user"
	}

	// Derive host:port patterns from configured CORS origins for origin validation.
	// In non-production environments, allow all origins for developer convenience.
	var acceptOpts *websocket.AcceptOptions
	if h.config.NodeEnv == "production" && len(h.config.CORSAllowedOrigins) > 0 {
		patterns := make([]string, 0, len(h.config.CORSAllowedOrigins))
		for _, o := range h.config.CORSAllowedOrigins {
			o = strings.TrimPrefix(o, "https://")
			o = strings.TrimPrefix(o, "http://")
			patterns = append(patterns, o)
		}
		acceptOpts = &websocket.AcceptOptions{OriginPatterns: patterns}
	} else {
		acceptOpts = &websocket.AcceptOptions{InsecureSkipVerify: true}
	}
	conn, err := websocket.Accept(w, r, acceptOpts)
	if err != nil {
		slog.Warn("WebSocket upgrade failed", "error", err, "userID", userID)
		return
	}
	slog.Info("WebSocket connected", "userID", userID, "role", role)

	client := NewClient(h, conn, userID, role)
	// Do not bind pumps to request context: net/http may cancel it as soon as
	// the handler returns, which would stop read/write pumps immediately and
	// leave a seemingly-open but non-functional websocket.
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-client.done
		cancel()
	}()

	go client.WritePump(ctx)
	go client.ReadPump(ctx)

	select {
	case h.register <- client:
	default:
		slog.Warn("Register channel full")
		client.Close()
	}
}

// GetClient returns a client by ID.
func (h *Hub) GetClient(id string) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.clients[id]
}

// GetClientByUserID returns the client for a user ID, or nil.
func (h *Hub) GetClientByUserID(userID string) *Client {
	sid := h.Cache.GetUserIdToSocketId(userID)
	if sid == "" {
		return nil
	}
	return h.GetClient(sid)
}

// SendToClient sends an event to a specific client.
func (h *Hub) SendToClient(clientID string, event string, data interface{}) {
	if c := h.GetClient(clientID); c != nil {
		c.Send(event, data)
	}
}

// SendToClients sends an event to multiple clients.
func (h *Hub) SendToClients(clientIDs []string, event string, data interface{}) {
	select {
	case h.broadcast <- &broadcastMsg{targetIDs: clientIDs, event: event, data: data}:
	default:
		slog.Debug("Broadcast channel full, dropping", "event", event)
	}
}

// BroadcastToAll sends an event to all connected clients.
func (h *Hub) BroadcastToAll(event string, data interface{}) {
	h.mu.RLock()
	ids := make([]string, 0, len(h.clients))
	for id := range h.clients {
		ids = append(ids, id)
	}
	h.mu.RUnlock()
	h.SendToClients(ids, event, data)
}

// DisconnectClient closes a client and unregisters it.
func (h *Hub) DisconnectClient(clientID string) {
	if c := h.GetClient(clientID); c != nil {
		c.Close()
	}
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// JoinGroup adds a client to a group.
func (h *Hub) JoinGroup(clientID, group string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.groups[group] == nil {
		h.groups[group] = make(map[string]bool)
	}
	h.groups[group][clientID] = true
}

// LeaveGroup removes a client from a group.
func (h *Hub) LeaveGroup(clientID, group string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if members := h.groups[group]; members != nil {
		delete(members, clientID)
		if len(members) == 0 {
			delete(h.groups, group)
		}
	}
}

// SendToGroup sends an event to all clients in a group.
func (h *Hub) SendToGroup(group, event string, data interface{}) {
	h.mu.RLock()
	members := h.groups[group]
	if members == nil {
		h.mu.RUnlock()
		return
	}
	ids := make([]string, 0, len(members))
	for id := range members {
		ids = append(ids, id)
	}
	h.mu.RUnlock()
	h.SendToClients(ids, event, data)
}
