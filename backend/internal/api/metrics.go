package api

import (
	"encoding/json"
	"net/http"

	"kinnect-v3/internal/ws"
)

// MetricsHandler exposes system metrics for monitoring
type MetricsHandler struct {
	hub *ws.Hub
}

// NewMetricsHandler creates a new metrics handler
func NewMetricsHandler(hub *ws.Hub) *MetricsHandler {
	return &MetricsHandler{hub: hub}
}

// GetMetrics returns connection and memory statistics
func (h *MetricsHandler) GetMetrics(w http.ResponseWriter, r *http.Request) {
	stats := map[string]interface{}{
		"connections": h.hub.ConnLimiter.GetStats(),
		"memory":      ws.GetMemoryStats(),
		"cache": map[string]interface{}{
			"cached_users": len(h.hub.Cache.UsersCache),
			"active_users": len(h.hub.Cache.ActiveUsers),
			"rooms":        len(h.hub.Cache.Rooms),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}
