package ws

import (
	"context"
	"log/slog"
	"runtime"
	"sync/atomic"
	"time"

	"kinnect-v3/internal/config"
)

// MemoryMonitor tracks and enforces heap size limits
type MemoryMonitor struct {
	lastHeapMB    uint64
	checkInterval time.Duration
}

// NewMemoryMonitor creates a new memory monitor
func NewMemoryMonitor(checkInterval time.Duration) *MemoryMonitor {
	return &MemoryMonitor{
		checkInterval: checkInterval,
	}
}

// Start begins monitoring memory in a background goroutine
func (mm *MemoryMonitor) Start(ctx context.Context, h *Hub) {
	ticker := time.NewTicker(mm.checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			mm.check(h)
		}
	}
}

// check performs a single memory check
func (mm *MemoryMonitor) check(h *Hub) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	heapMB := float64(m.HeapAlloc) / 1024 / 1024
	atomic.StoreUint64(&mm.lastHeapMB, uint64(heapMB))

	slog.Debug("Memory check",
		"heap_mb", heapMB,
		"alloc_mb", float64(m.Alloc)/1024/1024,
		"sys_mb", float64(m.Sys)/1024/1024,
		"gc_count", m.NumGC)

	// Warning threshold: 250 MB
	if heapMB > float64(config.HeapWarningThreshold) {
		slog.Warn("High memory usage detected",
			"heap_mb", heapMB,
			"threshold_mb", config.HeapWarningThreshold,
			"active_users", len(h.Cache.ActiveUsers),
			"cached_users", len(h.Cache.UsersCache))
	}

	// Critical threshold: 300 MB - evict LRU
	if heapMB > float64(config.HeapCriticalThreshold) {
		slog.Warn("Triggering LRU eviction due to memory pressure",
			"heap_mb", heapMB,
			"critical_threshold_mb", config.HeapCriticalThreshold)

		h.Cache.EvictLRU(10) // Evict 10 oldest users

		// Force GC
		runtime.GC()
	}

	// Panic threshold: 400 MB - graceful restart
	if heapMB > float64(config.HeapPanicThreshold) {
		slog.Error("CRITICAL: Heap threshold exceeded, initiating graceful shutdown",
			"heap_mb", heapMB,
			"panic_threshold_mb", config.HeapPanicThreshold)

		// Gracefully shutdown the server
		go func() {
			time.Sleep(5 * time.Second)
			slog.Info("Restarting server due to OOM threshold")
			// This will trigger process exit, Render will restart
			panic("OOM threshold exceeded")
		}()
	}
}

// GetHeapMB returns the last recorded heap size in MB
func (mm *MemoryMonitor) GetHeapMB() float64 {
	return float64(atomic.LoadUint64(&mm.lastHeapMB))
}

// Helper function to format memory stats
func GetMemoryStats() map[string]interface{} {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	return map[string]interface{}{
		"heap_alloc_mb":   float64(m.HeapAlloc) / 1024 / 1024,
		"heap_sys_mb":     float64(m.HeapSys) / 1024 / 1024,
		"heap_objects":    m.HeapObjects,
		"alloc_mb":        float64(m.Alloc) / 1024 / 1024,
		"sys_mb":          float64(m.Sys) / 1024 / 1024,
		"gc_count":        m.NumGC,
		"gc_pause_ns":     m.PauseNs[(m.NumGC+255)%256],
		"goroutines":      runtime.NumGoroutine(),
	}
}
