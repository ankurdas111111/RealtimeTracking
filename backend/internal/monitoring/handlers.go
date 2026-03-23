package monitoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	_ "net/http/pprof"
	"runtime"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"kinnect-v3/internal/cache"
)

// MonitoringServer wraps a separate HTTP server for monitoring endpoints.
// This allows isolating monitoring endpoints on a different port for security.
type MonitoringServer struct {
	mux     *http.ServeMux
	server  *http.Server
	metrics *Metrics
	cache   *cache.Cache
	db      *sql.DB
	mu      sync.Mutex
}

// NewMonitoringServer creates a new monitoring server.
func NewMonitoringServer(port string, metrics *Metrics, c *cache.Cache, db *sql.DB) *MonitoringServer {
	ms := &MonitoringServer{
		mux:     http.NewServeMux(),
		metrics: metrics,
		cache:   c,
		db:      db,
	}

	// Prometheus metrics endpoint
	ms.mux.Handle("/metrics", enableCORS(promhttp.Handler()))

	// Enhanced health endpoint
	ms.mux.HandleFunc("/health", enableCORSFunc(ms.healthHandler))

	// Detailed diagnostics endpoint (requires more computation)
	ms.mux.HandleFunc("/diagnostics", enableCORSFunc(ms.diagnosticsHandler))

	// CPU/memory profiling (uses pprof)
	ms.mux.HandleFunc("/debug/pprof/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.DefaultServeMux.ServeHTTP(w, r)
	}))
	ms.mux.HandleFunc("/debug/pprof/profile", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.DefaultServeMux.ServeHTTP(w, r)
	}))
	ms.mux.HandleFunc("/debug/pprof/heap", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.DefaultServeMux.ServeHTTP(w, r)
	}))
	ms.mux.HandleFunc("/debug/pprof/goroutine", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.DefaultServeMux.ServeHTTP(w, r)
	}))

	ms.server = &http.Server{
		Addr:         ":" + port,
		Handler:      ms.mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	return ms
}

// Start begins listening for monitoring requests.
func (ms *MonitoringServer) Start() error {
	return ms.server.ListenAndServe()
}

// Shutdown gracefully shuts down the monitoring server.
func (ms *MonitoringServer) Shutdown(ctx context.Context) error {
	return ms.server.Shutdown(ctx)
}

// healthHandler returns a lightweight JSON health status.
func (ms *MonitoringServer) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dbStatus := "ok"
	if err := ms.db.PingContext(ctx); err != nil {
		dbStatus = "error"
	}

	stats := ms.db.Stats()
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	response := map[string]interface{}{
		"status":      "ok",
		"timestamp":   time.Now().Unix(),
		"db":          dbStatus,
		"connections": stats.OpenConnections,
		"memory": map[string]interface{}{
			"alloc_mb":     mem.Alloc / (1024 * 1024),
			"total_alloc_mb": mem.TotalAlloc / (1024 * 1024),
			"sys_mb":       mem.Sys / (1024 * 1024),
			"num_gc":       mem.NumGC,
		},
	}

	json.NewEncoder(w).Encode(response)
}

// diagnosticsHandler returns detailed system and application diagnostics.
func (ms *MonitoringServer) diagnosticsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Memory stats
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	// Goroutine count
	numGoroutines := runtime.NumGoroutine()

	// Database stats
	stats := ms.db.Stats()

	// Cache stats (if available)
	cacheSize := ms.cache.CacheSize()

	response := map[string]interface{}{
		"timestamp": time.Now().Unix(),
		"runtime": map[string]interface{}{
			"goroutines":       numGoroutines,
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
			"size_bytes": cacheSize,
		},
		"db_ping": map[string]interface{}{
			"status": pingDB(ctx, ms.db),
		},
	}

	json.NewEncoder(w).Encode(response)
}

// pingDB checks database connectivity.
func pingDB(ctx context.Context, db *sql.DB) string {
	if err := db.PingContext(ctx); err != nil {
		return "error: " + err.Error()
	}
	return "ok"
}

// enableCORS wraps an http.Handler to add CORS headers.
func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// enableCORSFunc wraps an http.HandlerFunc to add CORS headers.
func enableCORSFunc(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		fn(w, r)
	}
}
