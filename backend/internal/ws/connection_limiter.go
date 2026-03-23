package ws

import (
	"log/slog"
	"sync"
	"sync/atomic"

	"kinnect-v3/internal/config"
)

// ConnectionLimiter enforces hard limits on concurrent WebSocket connections
type ConnectionLimiter struct {
	maxConnections int32
	activeConns    int32
	mu             sync.RWMutex
	rejectedCount  int64
}

// NewConnectionLimiter creates a new connection limiter
func NewConnectionLimiter(maxConnections int) *ConnectionLimiter {
	return &ConnectionLimiter{
		maxConnections: int32(maxConnections),
	}
}

// AcquireConnection attempts to add a new connection
// Returns true if allowed, false if at limit
func (cl *ConnectionLimiter) AcquireConnection() bool {
	current := atomic.LoadInt32(&cl.activeConns)

	if current >= cl.maxConnections {
		atomic.AddInt64(&cl.rejectedCount, 1)
		return false
	}

	if !atomic.CompareAndSwapInt32(&cl.activeConns, current, current+1) {
		// Race condition, try again (with backoff in real code)
		return cl.AcquireConnection()
	}

	return true
}

// ReleaseConnection removes a connection from the limit
func (cl *ConnectionLimiter) ReleaseConnection() {
	atomic.AddInt32(&cl.activeConns, -1)
}

// GetStats returns current statistics
func (cl *ConnectionLimiter) GetStats() map[string]interface{} {
	return map[string]interface{}{
		"active_connections": atomic.LoadInt32(&cl.activeConns),
		"max_connections":    cl.maxConnections,
		"rejected_total":     atomic.LoadInt64(&cl.rejectedCount),
		"utilization":        float64(atomic.LoadInt32(&cl.activeConns)) / float64(cl.maxConnections),
	}
}

// InitConnectionLimiter adds a connection limiter to the hub
// This is called once during hub initialization
func (h *Hub) InitConnectionLimiter() {
	h.ConnLimiter = NewConnectionLimiter(config.MaxWebSocketConnections)
	slog.Info("Connection limiter initialized", "max_connections", config.MaxWebSocketConnections)
}
