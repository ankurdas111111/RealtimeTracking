package api

import (
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"kinnect-v3/internal/auth"
	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/config"
	"kinnect-v3/internal/db"
	"kinnect-v3/internal/ws"
)

const sessionMaxAgeSec = 7 * 24 * 60 * 60

// NewRouter creates the HTTP mux with all routes and middleware.
func NewRouter(cfg *config.Config, pool *db.Pool, c *cache.Cache, store *auth.SessionStore, hub *ws.Hub) http.Handler {
	mux := http.NewServeMux()

	isProduction := cfg.NodeEnv == "production"
	authHandler := &AuthHandler{db: pool.DB, cache: c, store: store, secret: cfg.SessionSecret, adminEmail: cfg.AdminEmail, secure: isProduction}
	pagesHandler := &PagesHandler{cache: c, db: pool.DB}
	healthHandler := &HealthHandler{db: pool.DB, cache: c}
	adminHandler := &AdminHandler{db: pool.DB, cache: c}
	metricsHandler := NewMetricsHandler(hub)

	// API routes
	mux.Handle("POST /api/login", CsrfMiddleware(http.HandlerFunc(authHandler.Login)))
	mux.Handle("POST /api/register", CsrfMiddleware(http.HandlerFunc(authHandler.Register)))
	mux.Handle("POST /api/logout", CsrfMiddleware(http.HandlerFunc(authHandler.Logout)))
	mux.Handle("GET /api/csrf", http.HandlerFunc(pagesHandler.Csrf))
	mux.Handle("GET /api/me", http.HandlerFunc(pagesHandler.Me))
	mux.Handle("GET /api/live/{token}", http.HandlerFunc(pagesHandler.LiveToken))
	mux.Handle("GET /api/watch/{token}", http.HandlerFunc(pagesHandler.WatchToken))
	mux.Handle("GET /api/health", http.HandlerFunc(healthHandler.Health))
	mux.Handle("GET /api/diagnostics", http.HandlerFunc(healthHandler.HealthDb))
	mux.Handle("GET /api/metrics", http.HandlerFunc(metricsHandler.GetMetrics))
	mux.Handle("GET /health", http.HandlerFunc(healthHandler.Health))
	mux.Handle("GET /health/db", RequireAuth(RequireAdmin(http.HandlerFunc(healthHandler.HealthDb))))
	mux.Handle("POST /api/admin/promote", RequireAuth(RequireAdmin(CsrfMiddleware(http.HandlerFunc(adminHandler.Promote)))))

	// WebSocket upgrade endpoint with connection limiting
	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		// Check connection limit before upgrade
		if !hub.ConnLimiter.AcquireConnection() {
			http.Error(w, "Connection limit reached", http.StatusTooManyRequests)
			return
		}

		sess := auth.GetSession(r)
		hub.HandleUpgrade(w, r, sess)
	})

	// Static file serving for frontend with smart caching
	frontendDir := os.Getenv("FRONTEND_DIR")
	if frontendDir == "" {
		frontendDir = filepath.Join("..", "frontend", "dist")
	}
	absFrontend, _ := filepath.Abs(frontendDir)
	log.Printf("DEBUG: Frontend dir = %s, abs = %s\n", frontendDir, absFrontend)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "" {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, filepath.Join(absFrontend, "index.html"))
			return
		}
		fpath := filepath.Join(absFrontend, r.URL.Path)
		if _, err := os.Stat(fpath); err == nil {
			setStaticCacheHeaders(w, r.URL.Path)
			if ext := filepath.Ext(r.URL.Path); ext != "" {
				if ct := mime.TypeByExtension(ext); ct != "" {
					w.Header().Set("Content-Type", ct)
				}
			}
			http.ServeFile(w, r, fpath)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(absFrontend, "index.html"))
	})

	// Apply middleware: SecurityHeaders -> Gzip -> CORS -> Session
	chain := SecurityHeadersMiddleware(isProduction)(
		GzipMiddleware(
			CorsMiddleware(cfg.CORSAllowedOrigins, cfg.NodeEnv)(
				auth.SessionMiddleware(store, cfg.SessionSecret, isProduction)(mux),
			),
		),
	)
	return chain
}

// CsrfMiddleware and RequireAuth/RequireAdmin wrap handlers - use auth package versions
func CsrfMiddleware(next http.Handler) http.Handler {
	return auth.CsrfMiddleware(next)
}
func RequireAuth(next http.Handler) http.Handler {
	return auth.RequireAuth(next)
}
func RequireAdmin(next http.Handler) http.Handler {
	return auth.RequireAdmin(next)
}

// hashedAssetRe matches Vite's hashed output filenames like index-C_s0HzSR.js
var hashedAssetRe = regexp.MustCompile(`-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|wasm)$`)

// setStaticCacheHeaders applies aggressive caching for hashed assets
// and short caching for everything else.
func setStaticCacheHeaders(w http.ResponseWriter, urlPath string) {
	if hashedAssetRe.MatchString(urlPath) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if strings.HasSuffix(urlPath, ".html") {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
}

// CorsMiddleware returns a middleware that handles CORS.
func CorsMiddleware(allowedOrigins []string, nodeEnv string) func(http.Handler) http.Handler {
	originSet := make(map[string]bool)
	for _, o := range allowedOrigins {
		originSet[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			var allowed bool
			if origin != "" {
				// Check for prefix match (e.g. http://localhost matches http://localhost:5173)
				for allowedOrigin := range originSet {
					if origin == allowedOrigin || strings.HasPrefix(origin, allowedOrigin+":") {
						allowed = true
						break
					}
				}
				if !allowed && nodeEnv == "production" {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				if !allowed {
					allowed = true // in dev, allow by default
				}
			}
			if origin != "" && allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, x-csrf-token")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeadersMiddleware adds security headers to all responses.
// Sets headers to prevent XSS, clickjacking, content sniffing, and improve TLS security.
func SecurityHeadersMiddleware(isProduction bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Prevent XSS attacks
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("X-XSS-Protection", "1; mode=block")

			// Referrer policy
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

			// Permissions policy (formerly Feature-Policy)
			w.Header().Set("Permissions-Policy", "geolocation=(self), microphone=(), camera=(), payment=()")

			if isProduction {
				// HSTS: Tell browsers to always use HTTPS (only on production)
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")

				// Content Security Policy: restrictive default
				w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' wss: https:; frame-ancestors 'none'")
			}

			next.ServeHTTP(w, r)
		})
	}
}
