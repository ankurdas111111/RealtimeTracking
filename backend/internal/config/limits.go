package config

// Resource limits for Render free tier optimization
const (
	// MaxWebSocketConnections is the hard limit for concurrent WebSocket connections
	// Render free tier: 512 MB RAM, shared CPU
	// Each connection ~20 KB = 5k × 20 KB = 100 MB budget
	MaxWebSocketConnections = 5000

	// MaxDatabaseConnections is the size of the connection pool
	// Render free tier: Shared database, limited resources
	MaxDatabaseConnections = 20

	// MaxIdleDatabaseConnections is the number of idle connections to maintain
	MaxIdleDatabaseConnections = 5

	// MaxConcurrentDatabaseQueries is the limit on in-flight database operations
	// Prevents overwhelming the database with concurrent queries
	MaxConcurrentDatabaseQueries = 50

	// MaxConcurrentWebSocketHandlers limits goroutines processing WebSocket messages
	// Prevents unbounded goroutine growth
	MaxConcurrentWebSocketHandlers = 200

	// HeapWarningThreshold triggers memory warnings (MB)
	HeapWarningThreshold = 250

	// HeapCriticalThreshold triggers aggressive eviction (MB)
	HeapCriticalThreshold = 300

	// HeapPanicThreshold causes graceful restart (MB)
	HeapPanicThreshold = 400

	// MaxCachedUsers is the maximum users to keep in memory before LRU eviction
	MaxCachedUsers = 5000

	// PositionBufferMaxSize is the max position records to buffer before flush
	PositionBufferMaxSize = 5000

	// PositionHistoryRetentionHours keeps positions for this many hours (24h rolling window)
	PositionHistoryRetentionHours = 24
)
