package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisCache wraps Redis client with application-specific methods
type RedisCache struct {
	client *redis.Client
	prefix string // Key prefix for namespacing (e.g., "kinnect:")
}

// RedisConfig holds Redis connection configuration
type RedisConfig struct {
	URL    string        // Redis URL from Aiven (redis://user:password@host:port)
	Prefix string        // Key prefix (default: "kinnect:")
	DBNum  int           // Database number (default: 0)
	MaxRetries int       // Max retries (default: 3)
}

// NewRedisCache creates a new Redis cache connection
// url: Redis connection string from Aiven
// Example: "redis://avnadmin:password@redis-abc123.a.aivencloud.com:12345"
func NewRedisCache(ctx context.Context, cfg RedisConfig) (*RedisCache, error) {
	if cfg.URL == "" {
		return nil, fmt.Errorf("redis URL is required")
	}

	if cfg.Prefix == "" {
		cfg.Prefix = "kinnect:"
	}

	if cfg.MaxRetries == 0 {
		cfg.MaxRetries = 3
	}

	// Parse Redis URL and create client
	opt, err := redis.ParseURL(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid redis URL: %w", err)
	}

	// Optimize for 1GB Redis instance
	opt.DB = cfg.DBNum
	opt.MaxRetries = cfg.MaxRetries
	opt.PoolSize = 10 // Connection pool size
	opt.MinIdleConns = 2

	client := redis.NewClient(opt)

	// Test connection
	testCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := client.Ping(testCtx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	slog.Info("Redis connected successfully", "prefix", cfg.Prefix)

	return &RedisCache{
		client: client,
		prefix: cfg.Prefix,
	}, nil
}

// ============================================================================
// Session Storage (for distributed session management)
// ============================================================================

// SaveSession stores a user session in Redis with TTL
func (rc *RedisCache) SaveSession(ctx context.Context, userID string, session interface{}, ttl time.Duration) error {
	data, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}

	key := rc.prefix + "session:" + userID
	if err := rc.client.Set(ctx, key, data, ttl).Err(); err != nil {
		slog.Error("Failed to save session to Redis", "userID", userID, "error", err)
		return err
	}

	return nil
}

// GetSession retrieves a user session from Redis
func (rc *RedisCache) GetSession(ctx context.Context, userID string) ([]byte, error) {
	key := rc.prefix + "session:" + userID
	data, err := rc.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil // Session not found (expired or not cached)
	}
	if err != nil {
		slog.Error("Failed to get session from Redis", "userID", userID, "error", err)
		return nil, err
	}
	return data, nil
}

// DeleteSession removes a session from Redis
func (rc *RedisCache) DeleteSession(ctx context.Context, userID string) error {
	key := rc.prefix + "session:" + userID
	return rc.client.Del(ctx, key).Err()
}

// ============================================================================
// Distributed Locking (for preventing race conditions)
// ============================================================================

// AcquireLock acquires a distributed lock with timeout
func (rc *RedisCache) AcquireLock(ctx context.Context, lockKey string, ttl time.Duration) (bool, error) {
	key := rc.prefix + "lock:" + lockKey
	// SET NX: only set if key doesn't exist
	result, err := rc.client.SetNX(ctx, key, "1", ttl).Result()
	if err != nil {
		return false, err
	}
	return result, nil
}

// ReleaseLock releases a distributed lock
func (rc *RedisCache) ReleaseLock(ctx context.Context, lockKey string) error {
	key := rc.prefix + "lock:" + lockKey
	return rc.client.Del(ctx, key).Err()
}

// ============================================================================
// Cache Management (user/room data caching)
// ============================================================================

// CacheUser stores a user object in Redis
func (rc *RedisCache) CacheUser(ctx context.Context, userID string, user interface{}) error {
	data, err := json.Marshal(user)
	if err != nil {
		return fmt.Errorf("failed to marshal user: %w", err)
	}

	key := rc.prefix + "user:" + userID
	// Cache users for 1 hour
	if err := rc.client.Set(ctx, key, data, 1*time.Hour).Err(); err != nil {
		slog.Error("Failed to cache user", "userID", userID, "error", err)
		return err
	}

	// Add user ID to set for tracking
	rc.client.SAdd(ctx, rc.prefix+"users", userID)

	return nil
}

// GetCachedUser retrieves a cached user
func (rc *RedisCache) GetCachedUser(ctx context.Context, userID string) ([]byte, error) {
	key := rc.prefix + "user:" + userID
	data, err := rc.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return data, nil
}

// InvalidateUser removes a user from cache
func (rc *RedisCache) InvalidateUser(ctx context.Context, userID string) error {
	key := rc.prefix + "user:" + userID
	rc.client.SRem(ctx, rc.prefix+"users", userID)
	return rc.client.Del(ctx, key).Err()
}

// ============================================================================
// Rate Limiting (for API protection)
// ============================================================================

// CheckRateLimit checks if a request should be rate limited
// Returns remaining quota, true if allowed, false if limited
func (rc *RedisCache) CheckRateLimit(ctx context.Context, clientID string, limit int64, window time.Duration) (int64, bool, error) {
	key := rc.prefix + "ratelimit:" + clientID

	// INCR and set expiry if first request
	val, err := rc.client.Incr(ctx, key).Result()
	if err != nil {
		return 0, false, err
	}

	// Set expiry on first request
	if val == 1 {
		rc.client.Expire(ctx, key, window)
	}

	remaining := limit - val
	allowed := val <= limit

	return remaining, allowed, nil
}

// ============================================================================
// Pub/Sub (for distributed messaging)
// ============================================================================

// PublishMessage publishes a message to a channel
func (rc *RedisCache) PublishMessage(ctx context.Context, channel string, message interface{}) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}

	fullChannel := rc.prefix + channel
	return rc.client.Publish(ctx, fullChannel, data).Err()
}

// SubscribeToChannel subscribes to a channel
func (rc *RedisCache) SubscribeToChannel(ctx context.Context, channel string) *redis.PubSub {
	fullChannel := rc.prefix + channel
	return rc.client.Subscribe(ctx, fullChannel)
}

// ============================================================================
// Generic Key Operations
// ============================================================================

// Set stores a key-value pair with optional TTL
func (rc *RedisCache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}

	fullKey := rc.prefix + key
	return rc.client.Set(ctx, fullKey, data, ttl).Err()
}

// Get retrieves a value by key
func (rc *RedisCache) Get(ctx context.Context, key string) ([]byte, error) {
	fullKey := rc.prefix + key
	data, err := rc.client.Get(ctx, fullKey).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	return data, err
}

// Del deletes a key
func (rc *RedisCache) Del(ctx context.Context, key string) error {
	fullKey := rc.prefix + key
	return rc.client.Del(ctx, fullKey).Err()
}

// Exists checks if a key exists
func (rc *RedisCache) Exists(ctx context.Context, key string) (bool, error) {
	fullKey := rc.prefix + key
	result, err := rc.client.Exists(ctx, fullKey).Result()
	return result > 0, err
}

// Expire sets TTL for a key
func (rc *RedisCache) Expire(ctx context.Context, key string, ttl time.Duration) error {
	fullKey := rc.prefix + key
	return rc.client.Expire(ctx, fullKey, ttl).Err()
}

// ============================================================================
// Statistics & Management
// ============================================================================

// GetStats returns Redis memory and performance statistics
func (rc *RedisCache) GetStats(ctx context.Context) (map[string]interface{}, error) {
	info, err := rc.client.Info(ctx, "memory", "stats", "keyspace").Result()
	if err != nil {
		return nil, err
	}

	stats := make(map[string]interface{})

	// Parse INFO output (simplified)
	stats["info"] = info

	// Get key count
	dbSize, err := rc.client.DBSize(ctx).Result()
	if err == nil {
		stats["key_count"] = dbSize
	}

	// Get memory info from INFO command
	// (MemoryStats is not available in all Redis versions)
	// Memory stats are included in the info output above

	return stats, nil
}

// FlushAllKeys deletes all keys with the configured prefix (development only!)
func (rc *RedisCache) FlushAllKeys(ctx context.Context) error {
	pattern := rc.prefix + "*"
	iter := rc.client.Scan(ctx, 0, pattern, 100).Iterator()

	for iter.Next(ctx) {
		rc.client.Del(ctx, iter.Val())
	}

	return iter.Err()
}

// Close closes the Redis connection
func (rc *RedisCache) Close() error {
	return rc.client.Close()
}

// ============================================================================
// Monitoring Helpers
// ============================================================================

// HealthCheck verifies Redis connection is healthy
func (rc *RedisCache) HealthCheck(ctx context.Context) bool {
	checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	return rc.client.Ping(checkCtx).Err() == nil
}

// GetKeyStats returns count of keys matching pattern
func (rc *RedisCache) GetKeyStats(ctx context.Context, pattern string) (int64, error) {
	fullPattern := rc.prefix + pattern
	var count int64

	iter := rc.client.Scan(ctx, 0, fullPattern, 1000).Iterator()
	for iter.Next(ctx) {
		count++
	}

	return count, iter.Err()
}
