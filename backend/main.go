package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"kinnect-v3/internal/api"
	"kinnect-v3/internal/auth"
	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/config"
	cfglimits "kinnect-v3/internal/config"
	"kinnect-v3/internal/db"
	"kinnect-v3/internal/monitoring"
	"kinnect-v3/internal/ws"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

	pool, err := db.NewPool(cfg.DatabaseURL)
	if err != nil {
		slog.Error("Failed to create database pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := db.InitDB(pool.DB); err != nil {
		slog.Error("Failed to initialize database schema", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize empty cache for lazy loading
	c := cache.New()

	// Set up lazy loader
	lazyLoader := cache.NewLazyLoader(pool.DB)
	c.SetLazyLoader(lazyLoader)

	// Load only minimal data at startup (for free-tier optimization)
	// Full LoadAll is commented out - uncomment if needed for backward compatibility
	result := &db.LoadAllResult{
		UsersCache:       make(map[string]*db.UserCacheEntry),
		ShareCodes:       make(map[string]string),
		EmailIndex:       make(map[string]string),
		MobileIndex:      make(map[string]string),
		Rooms:            make(map[string]*db.RoomEntry),
		RoomMemberRoles:  make(map[string]map[string]*db.RoomMemberRole),
		Contacts:         make(map[string]map[string]bool),
		LiveTokens:       make(map[string]*db.LiveTokenEntry),
		Guardianships:    make(map[string]map[string]*db.GuardianshipEntry),
		RoomAdminRequests: make(map[string][]*db.RoomAdminRequestEntry),
	}
	c.Init(result)

	// Warm up cache with recently active data in background
	slog.Info("Starting cache warmup in background")
	c.WarmupRecentData(ctx, lazyLoader)

	// Initialize monitoring
	metrics := monitoring.NewMetrics()
	monitoringPort := os.Getenv("MONITORING_PORT")
	if monitoringPort == "" {
		monitoringPort = "9090"
	}

	hub := ws.NewHub(c, pool, cfg)
	go hub.Run(ctx)
	go hub.StartPositionFlusher(ctx)
	go hub.StartPositionPurger(ctx)
	hub.StartCleanupRoutines(ctx)

	// Start memory monitoring for free-tier optimization
	go hub.MemoryMonitor.Start(ctx, hub)

	// Initialize Redis if configured (Render production only)
	var redisCache *cache.RedisCache
	var sessionStore *cache.RedisSessionStore
	if cfg.RedisURL != "" {
		var err error
		redisCache, err = cache.NewRedisCache(ctx, cache.RedisConfig{
			URL:    cfg.RedisURL,
			Prefix: "kinnect:",
		})
		if err != nil {
			slog.Warn("Redis connection failed, using in-memory storage only", "error", err)
		} else {
			sessionStore = cache.NewRedisSessionStore(redisCache)
			slog.Info("Redis cache initialized successfully")
			defer redisCache.Close()
		}
	} else {
		slog.Info("Redis not configured, using in-memory storage")
	}

	// Assign Redis to hub for optional use
	hub.RedisCache = redisCache
	hub.RedisSessionStore = sessionStore

	slog.Info("Kinnect initialized",
		"mode", cfg.NodeEnv,
		"max_connections", cfglimits.MaxWebSocketConnections,
		"max_db_connections", cfglimits.MaxDatabaseConnections)

	store := auth.NewSessionStore(pool.DB)
	handler := api.NewRouter(cfg, pool, c, store, hub)

	// Start monitoring server in background
	monServer := monitoring.NewMonitoringServer(monitoringPort, metrics, c, pool.DB)
	go func() {
		if err := monServer.Start(); err != nil && err != http.ErrServerClosed {
			slog.Error("Monitoring server error", "error", err)
		}
	}()

	slog.Info("Kinnect backend-v3 started",
		"port", cfg.Port,
		"monitoring_port", monitoringPort,
		"env", cfg.NodeEnv,
		"users", len(result.UsersCache),
		"rooms", len(result.Rooms))

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second, // WebSocket connections are hijacked and unaffected by this
		Handler:      handler,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("Shutting down...")
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	hub.Shutdown(shutdownCtx)
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("Server shutdown error", "error", err)
	}
	if err := monServer.Shutdown(shutdownCtx); err != nil {
		slog.Error("Monitoring server shutdown error", "error", err)
	}
	slog.Info("Goodbye")
}
