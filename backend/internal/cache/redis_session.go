package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// RedisSessionStore manages user sessions using Redis
// Provides distributed session storage for multi-instance deployments
type RedisSessionStore struct {
	redis *RedisCache
	ttl   time.Duration // Default session TTL (24 hours)
}

// ActiveSessionData represents cached session state
type ActiveSessionData struct {
	UserID        string                 `json:"user_id"`
	SocketID      string                 `json:"socket_id"`
	ConnectedAt   int64                  `json:"connected_at"`
	LastUpdate    int64                  `json:"last_update"`
	LastLatitude  *float64               `json:"last_latitude,omitempty"`
	LastLongitude *float64               `json:"last_longitude,omitempty"`
	LastSpeed     string                 `json:"last_speed,omitempty"`
	BatteryPct    *int                   `json:"battery_pct,omitempty"`
	Online        bool                   `json:"online"`
	ExpiresAt     int64                  `json:"expires_at"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

// NewRedisSessionStore creates a new Redis session store
func NewRedisSessionStore(rc *RedisCache) *RedisSessionStore {
	return &RedisSessionStore{
		redis: rc,
		ttl:   24 * time.Hour, // Default 24 hour session TTL
	}
}

// SaveActiveSession saves a user's active session to Redis
func (rss *RedisSessionStore) SaveActiveSession(ctx context.Context, session *ActiveSessionData) error {
	if session.UserID == "" {
		return fmt.Errorf("user_id is required")
	}

	session.ExpiresAt = time.Now().Add(rss.ttl).UnixMilli()

	data, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}

	key := "active:" + session.UserID
	if err := rss.redis.client.Set(ctx, rss.redis.prefix+key, data, rss.ttl).Err(); err != nil {
		slog.Error("Failed to save active session", "userID", session.UserID, "error", err)
		return err
	}

	// Add to set of active sessions for easy tracking
	rss.redis.client.SAdd(ctx, rss.redis.prefix+"active_sessions", session.UserID)

	return nil
}

// GetActiveSession retrieves a user's session from Redis
func (rss *RedisSessionStore) GetActiveSession(ctx context.Context, userID string) (*ActiveSessionData, error) {
	if userID == "" {
		return nil, fmt.Errorf("user_id is required")
	}

	key := "active:" + userID
	data, err := rss.redis.client.Get(ctx, key).Bytes()
	if err != nil {
		if err.Error() == "redis: nil" {
			return nil, nil // Not found
		}
		slog.Error("Failed to get active session", "userID", userID, "error", err)
		return nil, err
	}

	var session ActiveSessionData
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, fmt.Errorf("failed to unmarshal session: %w", err)
	}

	return &session, nil
}

// UpdateSessionPosition updates only position-related fields
func (rss *RedisSessionStore) UpdateSessionPosition(ctx context.Context, userID string,
	latitude, longitude *float64, speed string, batteryPct *int) error {

	// Get existing session
	session, err := rss.GetActiveSession(ctx, userID)
	if err != nil {
		return err
	}
	if session == nil {
		return fmt.Errorf("session not found for user: %s", userID)
	}

	// Update position fields
	if latitude != nil {
		session.LastLatitude = latitude
	}
	if longitude != nil {
		session.LastLongitude = longitude
	}
	if speed != "" {
		session.LastSpeed = speed
	}
	if batteryPct != nil {
		session.BatteryPct = batteryPct
	}
	session.LastUpdate = time.Now().UnixMilli()

	// Save updated session
	return rss.SaveActiveSession(ctx, session)
}

// DeleteActiveSession removes a session from Redis
func (rss *RedisSessionStore) DeleteActiveSession(ctx context.Context, userID string) error {
	key := "active:" + userID
	rss.redis.client.SRem(ctx, rss.redis.prefix+"active_sessions", userID)
	return rss.redis.client.Del(ctx, rss.redis.prefix+key).Err()
}

// GetAllActiveSessions retrieves all active sessions (for recovery/monitoring)
func (rss *RedisSessionStore) GetAllActiveSessions(ctx context.Context) ([]*ActiveSessionData, error) {
	// Get all user IDs from set
	userIDs, err := rss.redis.client.SMembers(ctx, rss.redis.prefix+"active_sessions").Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get active user IDs: %w", err)
	}

	sessions := make([]*ActiveSessionData, 0, len(userIDs))

	for _, userID := range userIDs {
		session, err := rss.GetActiveSession(ctx, userID)
		if err != nil {
			slog.Error("Failed to load session for recovery", "userID", userID, "error", err)
			continue
		}
		if session != nil {
			sessions = append(sessions, session)
		}
	}

	return sessions, nil
}

// GetActiveSessionCount returns the number of active sessions
func (rss *RedisSessionStore) GetActiveSessionCount(ctx context.Context) (int64, error) {
	return rss.redis.client.SCard(ctx, rss.redis.prefix+"active_sessions").Result()
}

// BatchSaveSessions saves multiple sessions efficiently
func (rss *RedisSessionStore) BatchSaveSessions(ctx context.Context, sessions []*ActiveSessionData) error {
	if len(sessions) == 0 {
		return nil
	}

	// Use pipeline for efficient batch operations
	pipe := rss.redis.client.Pipeline()

	for _, session := range sessions {
		session.ExpiresAt = time.Now().Add(rss.ttl).UnixMilli()
		data, err := json.Marshal(session)
		if err != nil {
			slog.Error("Failed to marshal session for batch", "userID", session.UserID, "error", err)
			continue
		}

		key := rss.redis.prefix + "active:" + session.UserID
		pipe.Set(ctx, key, data, rss.ttl)
		pipe.SAdd(ctx, rss.redis.prefix+"active_sessions", session.UserID)
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("batch save failed: %w", err)
	}

	return nil
}

// ClearExpiredSessions removes sessions that have expired
// Note: Redis automatically expires keys, but this ensures cleanup
func (rss *RedisSessionStore) ClearExpiredSessions(ctx context.Context) error {
	sessions, err := rss.GetAllActiveSessions(ctx)
	if err != nil {
		return err
	}

	now := time.Now().UnixMilli()
	expired := make([]string, 0)

	for _, session := range sessions {
		if session.ExpiresAt < now {
			expired = append(expired, session.UserID)
		}
	}

	if len(expired) > 0 {
		slog.Info("Removing expired sessions", "count", len(expired))
		for _, userID := range expired {
			rss.DeleteActiveSession(ctx, userID)
		}
	}

	return nil
}

// IsSessionOnline checks if a session is marked as online
func (rss *RedisSessionStore) IsSessionOnline(ctx context.Context, userID string) (bool, error) {
	session, err := rss.GetActiveSession(ctx, userID)
	if err != nil {
		return false, err
	}
	if session == nil {
		return false, nil
	}
	return session.Online, nil
}

// SetSessionOnlineStatus updates the online status of a session
func (rss *RedisSessionStore) SetSessionOnlineStatus(ctx context.Context, userID string, online bool) error {
	session, err := rss.GetActiveSession(ctx, userID)
	if err != nil {
		return err
	}
	if session == nil {
		return fmt.Errorf("session not found for user: %s", userID)
	}

	session.Online = online
	session.LastUpdate = time.Now().UnixMilli()

	return rss.SaveActiveSession(ctx, session)
}

// ============================================================================
// Statistics & Monitoring
// ============================================================================

// GetSessionStats returns statistics about active sessions
func (rss *RedisSessionStore) GetSessionStats(ctx context.Context) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	// Get active session count
	count, err := rss.GetActiveSessionCount(ctx)
	if err == nil {
		stats["active_sessions"] = count
	}

	// Get all sessions for analysis
	sessions, err := rss.GetAllActiveSessions(ctx)
	if err == nil {
		onlineCount := 0
		for _, s := range sessions {
			if s.Online {
				onlineCount++
			}
		}
		stats["online_sessions"] = onlineCount
		stats["offline_sessions"] = count - int64(onlineCount)
	}

	return stats, nil
}

// ============================================================================
// User Location Tracking (distributed)
// ============================================================================

// CacheUserLocation caches a user's current location for quick access
// Used for proximity searches and quick location lookups
func (rss *RedisSessionStore) CacheUserLocation(ctx context.Context, userID string,
	latitude, longitude float64) error {

	key := fmt.Sprintf("location:%s", userID)
	location := map[string]float64{
		"lat": latitude,
		"lng": longitude,
		"ts":  float64(time.Now().UnixMilli()),
	}

	data, err := json.Marshal(location)
	if err != nil {
		return err
	}

	// Cache location for 5 minutes
	return rss.redis.client.Set(ctx, rss.redis.prefix+key, data, 5*time.Minute).Err()
}

// GetUserLocation retrieves a user's cached location
func (rss *RedisSessionStore) GetUserLocation(ctx context.Context, userID string) (lat, lng float64, found bool, err error) {
	key := fmt.Sprintf("location:%s", userID)
	data, err := rss.redis.client.Get(ctx, rss.redis.prefix+key).Bytes()
	if err != nil {
		if err.Error() == "redis: nil" {
			return 0, 0, false, nil
		}
		return 0, 0, false, err
	}

	var location map[string]float64
	if err := json.Unmarshal(data, &location); err != nil {
		return 0, 0, false, err
	}

	return location["lat"], location["lng"], true, nil
}
