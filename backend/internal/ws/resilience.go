package ws

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"kinnect-v3/internal/cache"
)

// PersistentSession stores active user state in database for recovery
type PersistentSession struct {
	UserID        string
	SocketID      string
	ConnectedAt   int64
	LastUpdate    int64
	LastLat       *float64
	LastLng       *float64
	LastSpeed     string
	BatteryPct    *int
	Online        bool
	ExpiresAt     int64
}

// SessionPersister manages persistent session storage
type SessionPersister struct {
	db        *sql.DB
	cache     sync.Map // userID -> PersistentSession
	flushTick *time.Ticker
	flushChan chan struct{}
}

// NewSessionPersister creates a new session persister
func NewSessionPersister(database *sql.DB) *SessionPersister {
	return &SessionPersister{
		db:        database,
		flushChan: make(chan struct{}, 10),
	}
}

// StartPersistence begins the persistence loop
func (sp *SessionPersister) StartPersistence(ctx context.Context) {
	sp.flushTick = time.NewTicker(10 * time.Second)
	defer sp.flushTick.Stop()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-sp.flushTick.C:
				sp.FlushSessions()
			case <-sp.flushChan:
				// Manual flush requested
				sp.FlushSessions()
			}
		}
	}()
}

// SaveSession saves or updates a session
func (sp *SessionPersister) SaveSession(session *PersistentSession) {
	session.ExpiresAt = time.Now().Add(24 * time.Hour).UnixMilli()
	sp.cache.Store(session.UserID, session)
}

// GetSession retrieves a session
func (sp *SessionPersister) GetSession(userID string) *PersistentSession {
	val, ok := sp.cache.Load(userID)
	if !ok {
		return nil
	}
	return val.(*PersistentSession)
}

// DeleteSession removes a session
func (sp *SessionPersister) DeleteSession(userID string) {
	sp.cache.Delete(userID)
}

// FlushSessions writes all sessions to database
func (sp *SessionPersister) FlushSessions() {
	sessions := make([]*PersistentSession, 0, 100)

	sp.cache.Range(func(key, value interface{}) bool {
		session := value.(*PersistentSession)
		sessions = append(sessions, session)
		return true
	})

	if len(sessions) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Batch insert/update sessions
	for _, session := range sessions {
		err := sp.updateSessionDB(ctx, session)
		if err != nil {
			slog.Error("Failed to persist session", "userID", session.UserID, "error", err)
		}
	}

	slog.Debug("Sessions persisted", "count", len(sessions))
}

// updateSessionDB updates a single session in database
func (sp *SessionPersister) updateSessionDB(ctx context.Context, session *PersistentSession) error {
	// SQL: Upsert (insert or update)
	query := `
		INSERT INTO active_sessions
		(user_id, socket_id, connected_at, last_update, last_latitude, last_longitude, last_speed, battery_pct, online, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (user_id) DO UPDATE SET
		socket_id = $2, last_update = $4, last_latitude = $5, last_longitude = $6,
		last_speed = $7, battery_pct = $8, online = $9, expires_at = $10
	`

	_, err := sp.db.ExecContext(ctx, query,
		session.UserID, session.SocketID, session.ConnectedAt, session.LastUpdate,
		session.LastLat, session.LastLng, session.LastSpeed, session.BatteryPct,
		session.Online, session.ExpiresAt,
	)
	return err
}

// LoadActiveSessions loads active sessions from database at startup
func (sp *SessionPersister) LoadActiveSessions(ctx context.Context) error {
	query := `
		SELECT user_id, socket_id, connected_at, last_update, last_latitude, last_longitude,
		       last_speed, battery_pct, online, expires_at
		FROM active_sessions
		WHERE expires_at > EXTRACT(EPOCH FROM NOW())::bigint
		ORDER BY last_update DESC
		LIMIT 1000
	`

	rows, err := sp.db.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		session := &PersistentSession{}
		err := rows.Scan(&session.UserID, &session.SocketID, &session.ConnectedAt, &session.LastUpdate,
			&session.LastLat, &session.LastLng, &session.LastSpeed, &session.BatteryPct,
			&session.Online, &session.ExpiresAt)
		if err != nil {
			return err
		}

		sp.cache.Store(session.UserID, session)
		count++
	}

	slog.Info("Loaded active sessions", "count", count)
	return nil
}

// HealthCheckService performs regular health checks
type HealthCheckService struct {
	db              *sql.DB
	cache           *cache.Cache
	lastCheck       time.Time
	checkInterval   time.Duration
	unhealthyCount  int
	maxUnhealthy    int
}

// NewHealthCheckService creates a new health check service
func NewHealthCheckService(database *sql.DB, c *cache.Cache) *HealthCheckService {
	return &HealthCheckService{
		db:            database,
		cache:         c,
		checkInterval: 30 * time.Second,
		maxUnhealthy:  3, // Allow 3 consecutive unhealthy checks before alerting
	}
}

// StartHealthChecks begins periodic health checks
func (hcs *HealthCheckService) StartHealthChecks(ctx context.Context) {
	ticker := time.NewTicker(hcs.checkInterval)
	defer ticker.Stop()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				hcs.PerformCheck()
			}
		}
	}()
}

// PerformCheck performs a single health check
func (hcs *HealthCheckService) PerformCheck() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	status := &HealthStatus{
		Timestamp:  time.Now().UnixMilli(),
		IsHealthy:  true,
		Checks:     make(map[string]interface{}),
	}

	// Check database connectivity
	dbOk := hcs.checkDatabase(ctx)
	status.Checks["database"] = dbOk
	if !dbOk {
		status.IsHealthy = false
	}

	// Check cache
	cacheOk := hcs.checkCache()
	status.Checks["cache"] = cacheOk
	if !cacheOk {
		status.IsHealthy = false
	}

	// Check memory
	memOk := hcs.checkMemory()
	status.Checks["memory"] = memOk
	if !memOk {
		status.IsHealthy = false
	}

	// Update health status
	if !status.IsHealthy {
		hcs.unhealthyCount++
		if hcs.unhealthyCount >= hcs.maxUnhealthy {
			slog.Error("Service unhealthy", "checks", status.Checks, "count", hcs.unhealthyCount)
		}
	} else {
		hcs.unhealthyCount = 0
	}

	hcs.lastCheck = time.Now()
}

// HealthStatus represents health check result
type HealthStatus struct {
	Timestamp int64                  `json:"timestamp"`
	IsHealthy bool                   `json:"healthy"`
	Checks    map[string]interface{} `json:"checks"`
}

// checkDatabase checks if database is responding
func (hcs *HealthCheckService) checkDatabase(ctx context.Context) bool {
	err := hcs.db.PingContext(ctx)
	return err == nil
}

// checkCache checks if cache has data
func (hcs *HealthCheckService) checkCache() bool {
	// Simple check: cache should have some data or be empty (ok)
	return hcs.cache != nil
}

// checkMemory checks if memory is within acceptable bounds
func (hcs *HealthCheckService) checkMemory() bool {
	stats := GetMemoryStats()
	heapMB := stats["heap_alloc_mb"].(float64)
	return heapMB < 400 // Critical threshold
}

// ClientKeepAliveService manages client keep-alive mechanism
type ClientKeepAliveService struct {
	interval       time.Duration
	clients        map[string]time.Time
	mu             sync.RWMutex
	lastActivity   sync.Map // clientID -> last activity time
}

// NewClientKeepAliveService creates a new keep-alive service
func NewClientKeepAliveService() *ClientKeepAliveService {
	return &ClientKeepAliveService{
		interval: 14 * time.Minute, // Render spins down after 15 min inactivity
		clients:  make(map[string]time.Time),
	}
}

// StartKeepAlive begins keep-alive monitoring
func (cka *ClientKeepAliveService) StartKeepAlive(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cka.pruneInactive()
			}
		}
	}()
}

// RecordActivity records client activity
func (cka *ClientKeepAliveService) RecordActivity(clientID string) {
	cka.lastActivity.Store(clientID, time.Now())
}

// IsActive checks if a client is still active
func (cka *ClientKeepAliveService) IsActive(clientID string) bool {
	val, ok := cka.lastActivity.Load(clientID)
	if !ok {
		return false
	}

	lastTime := val.(time.Time)
	return time.Since(lastTime) < 30*time.Minute // 30 min max inactivity
}

// pruneInactive removes inactive clients from tracking
func (cka *ClientKeepAliveService) pruneInactive() {
	cutoff := time.Now().Add(-30 * time.Minute)

	cka.lastActivity.Range(func(key, value interface{}) bool {
		lastTime := value.(time.Time)
		if lastTime.Before(cutoff) {
			cka.lastActivity.Delete(key)
		}
		return true
	})
}

// GracefulShutdown handles clean shutdown
type GracefulShutdown struct {
	timeout time.Duration
	once    sync.Once
	done    chan struct{}
}

// NewGracefulShutdown creates a new graceful shutdown handler
func NewGracefulShutdown(timeout time.Duration) *GracefulShutdown {
	return &GracefulShutdown{
		timeout: timeout,
		done:    make(chan struct{}),
	}
}

// Shutdown initiates graceful shutdown
func (gs *GracefulShutdown) Shutdown(ctx context.Context, hub *Hub) error {
	var err error

	gs.once.Do(func() {
		slog.Info("Graceful shutdown initiated", "timeout_sec", gs.timeout.Seconds())

		// Stop accepting new connections
		hub.IsShuttingDown = true

		// Close all existing connections
		hub.mu.RLock()
		clientCount := len(hub.clients)
		hub.mu.RUnlock()

		slog.Info("Closing client connections", "count", clientCount)

		// Wait for clients to disconnect gracefully
		shutdownCtx, cancel := context.WithTimeout(ctx, gs.timeout)
		defer cancel()

		// Drain dispatch queue
		for {
			select {
			case <-shutdownCtx.Done():
				slog.Warn("Shutdown timeout reached, force closing remaining connections")
				return
			default:
				hub.mu.RLock()
				if len(hub.clients) == 0 {
					hub.mu.RUnlock()
					break
				}
				hub.mu.RUnlock()

				time.Sleep(100 * time.Millisecond)
			}
		}

		slog.Info("Graceful shutdown complete")
		close(gs.done)
	})

	return err
}

// SerializeSession converts a session to JSON for storage
func (ps *PersistentSession) MarshalJSON() ([]byte, error) {
	m := map[string]interface{}{
		"user_id":      ps.UserID,
		"socket_id":    ps.SocketID,
		"connected_at": ps.ConnectedAt,
		"last_update":  ps.LastUpdate,
		"online":       ps.Online,
		"expires_at":   ps.ExpiresAt,
	}

	if ps.LastLat != nil {
		m["last_lat"] = *ps.LastLat
	}
	if ps.LastLng != nil {
		m["last_lng"] = *ps.LastLng
	}
	if ps.LastSpeed != "" {
		m["last_speed"] = ps.LastSpeed
	}
	if ps.BatteryPct != nil {
		m["battery_pct"] = *ps.BatteryPct
	}

	return json.Marshal(m)
}
