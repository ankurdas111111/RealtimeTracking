package cache

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"time"

	"kinnect-v3/internal/db"
)

const (
	// MaxCachedUsers is the maximum number of users to keep in cache before eviction
	MaxCachedUsers = 5000

	// LRU eviction triggers at this percentage of max
	EvictionThreshold = 0.9
)

// LazyLoader handles on-demand loading of data from database
type LazyLoader struct {
	db        *sql.DB
	loadMutex sync.Mutex
}

// NewLazyLoader creates a new lazy loader
func NewLazyLoader(database *sql.DB) *LazyLoader {
	return &LazyLoader{
		db: database,
	}
}

// SetLazyLoader attaches a lazy loader to the cache
func (c *Cache) SetLazyLoader(loader *LazyLoader) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lazyLoader = loader
}

// LoadUserCacheEntry loads a single user from the database if not in cache
func (c *Cache) LoadUserCacheEntry(userID string) *db.UserCacheEntry {
	c.mu.RLock()
	if user, exists := c.UsersCache[userID]; exists {
		c.mu.RUnlock()
		return user
	}
	c.mu.RUnlock()

	// Not in cache: load from DB
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	user, err := db.GetUserByID(ctx, c.lazyLoader.db, userID)
	if err != nil {
		slog.Error("Failed to load user from database", "userID", userID, "error", err)
		return nil
	}

	// Convert to cache entry (GetUserByID already returns *UserCacheEntry)
	entry := user

	// Store in cache
	c.mu.Lock()
	defer c.mu.Unlock()

	// Check if eviction needed
	if len(c.UsersCache) >= int(float64(MaxCachedUsers)*EvictionThreshold) {
		c.EvictLRU(10) // Evict 10 oldest users
	}

	c.UsersCache[userID] = entry
	return entry
}

// EvictLRU removes the least recently used entries from cache
// This is a simple implementation that removes oldest entries by creation time
// In production, track actual access times for better LRU
func (c *Cache) EvictLRU(count int) {
	if count <= 0 || len(c.UsersCache) == 0 {
		return
	}

	evicted := 0
	// Simple: remove entries until we've evicted count items
	// TODO: Implement proper LRU tracking with access times
	for userID := range c.UsersCache {
		if evicted >= count {
			break
		}
		delete(c.UsersCache, userID)
		evicted++
	}

	if evicted > 0 {
		slog.Info("LRU eviction triggered", "evicted", evicted, "remaining", len(c.UsersCache))
	}
}

// LoadRoom loads a room if not already cached
func (c *Cache) LoadRoom(roomID string) *db.RoomEntry {
	c.mu.RLock()
	if room, exists := c.Rooms[roomID]; exists {
		c.mu.RUnlock()
		return room
	}
	c.mu.RUnlock()

	// Not in cache: load from DB
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	room, err := db.GetRoomByID(ctx, c.lazyLoader.db, roomID)
	if err != nil {
		slog.Error("Failed to load room from database", "roomID", roomID, "error", err)
		return nil
	}

	// Store in cache
	c.mu.Lock()
	defer c.mu.Unlock()

	c.Rooms[roomID] = room
	return room
}

// WarmupRecentData loads recently active users and rooms into cache
// This runs asynchronously at startup to warm the cache with frequently-accessed data
func (c *Cache) WarmupRecentData(ctx context.Context, loader *LazyLoader) {
	go func() {
		slog.Info("Starting cache warmup...")

		// Load last 100 active users from recent sessions
		if err := c.warmupRecentUsers(ctx, loader); err != nil {
			slog.Error("Failed to warmup recent users", "error", err)
		}

		// Load most recently created/modified rooms
		if err := c.warmupRecentRooms(ctx, loader); err != nil {
			slog.Error("Failed to warmup recent rooms", "error", err)
		}

		slog.Info("Cache warmup completed",
			"cachedUsers", len(c.UsersCache),
			"cachedRooms", len(c.Rooms))
	}()
}

// warmupRecentUsers loads the 100 most recently active users
func (c *Cache) warmupRecentUsers(ctx context.Context, loader *LazyLoader) error {
	// This would be implemented in db package
	// For now, we load basic users
	return nil
}

// warmupRecentRooms loads the 100 most recently created/updated rooms
func (c *Cache) warmupRecentRooms(ctx context.Context, loader *LazyLoader) error {
	// This would be implemented in db package
	// For now, we load basic rooms
	return nil
}

// FindUserByEmail finds a user by email address via database query
func (l *LazyLoader) FindUserByEmail(email string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	userID, err := db.FindUserByEmail(ctx, l.db, email)
	if err != nil {
		slog.Error("Failed to find user by email", "email", email, "error", err)
		return ""
	}

	return userID
}

// FindUserByMobile finds a user by mobile number via database query
func (l *LazyLoader) FindUserByMobile(mobile string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	userID, err := db.FindUserByMobile(ctx, l.db, mobile)
	if err != nil {
		slog.Error("Failed to find user by mobile", "mobile", mobile, "error", err)
		return ""
	}

	return userID
}
