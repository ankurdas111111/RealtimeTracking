package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"runtime"
	"time"

	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/db"
	"kinnect-v3/internal/shared"
)

var startTime = time.Now()

// HealthHandler handles health check endpoints.
type HealthHandler struct {
	db    *sql.DB
	cache *cache.Cache
}

// Health handles GET /health.
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	dbStatus := "ok"
	if err := h.db.PingContext(ctx); err != nil {
		dbStatus = "error"
	}

	stats := h.db.Stats()
	roomsCount := h.cache.RoomCount()

	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	response := map[string]interface{}{
		"status":       "ok",
		"uptime":       int64(time.Since(startTime).Seconds()),
		"connections":  stats.OpenConnections,
		"rooms":        roomsCount,
		"db":            dbStatus,
		"memory": map[string]interface{}{
			"alloc":       mem.Alloc,
			"totalAlloc":  mem.TotalAlloc,
			"sys":         mem.Sys,
			"numGC":       mem.NumGC,
		},
		"perf": shared.PerfMetrics.Snapshot(),
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

// HealthDb handles GET /health/db and GET /api/diagnostics
func (h *HealthHandler) HealthDb(w http.ResponseWriter, r *http.Request) {
	// For /api/diagnostics, return detailed diagnostics
	if r.URL.Path == "/api/diagnostics" {
		h.Diagnostics(w, r)
		return
	}

	// For /health/db, return table info
	ctx := context.Background()
	tables, totalSize, err := db.GetTableSizes(ctx, h.db)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"ok": false, "error": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"tables": tables,
		"total": totalSize,
	})
}

// Diagnostics returns detailed system diagnostics
func (h *HealthHandler) Diagnostics(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	if err := h.db.PingContext(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
		})
		return
	}

	stats := h.db.Stats()
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	response := map[string]interface{}{
		"timestamp": time.Now().Unix(),
		"runtime": map[string]interface{}{
			"goroutines": runtime.NumGoroutine(),
			"memory_mb": map[string]interface{}{
				"alloc":       int64(mem.Alloc) / (1024 * 1024),
				"total_alloc": int64(mem.TotalAlloc) / (1024 * 1024),
				"sys":         int64(mem.Sys) / (1024 * 1024),
				"heap_alloc":  int64(mem.HeapAlloc) / (1024 * 1024),
				"heap_sys":    int64(mem.HeapSys) / (1024 * 1024),
			},
			"gc": map[string]interface{}{
				"count":     mem.NumGC,
				"pause_ns":  mem.PauseNs[(mem.NumGC+255)%256],
			},
		},
		"database": map[string]interface{}{
			"open_connections": stats.OpenConnections,
			"in_use":           stats.InUse,
			"idle":             stats.Idle,
			"wait_count":       stats.WaitCount,
			"wait_duration_ns": stats.WaitDuration,
		},
		"cache": map[string]interface{}{
			"size_bytes": h.cache.CacheSize(),
		},
	}

	writeJSON(w, http.StatusOK, response)
}
