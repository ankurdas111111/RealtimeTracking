package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
)

// Config holds application configuration loaded from environment variables.
type Config struct {
	DatabaseURL         string
	SessionSecret       string
	Port                string
	NodeEnv             string
	AdminEmail          string
	LogLevel            string
	CORSAllowedOrigins  []string
}

const (
	defaultPort    = "3000"
	defaultNodeEnv = "development"
	defaultLogLevel = "info"
	minSessionSecretLen = 32
)

var defaultCORSOrigins = []string{
	"http://localhost",
	"https://localhost",
	"http://localhost:5173",
	"https://localhost:5173",
	"capacitor://localhost",
	"ionic://localhost",
}

// Load reads configuration from environment variables and returns a Config.
// Returns an error if required vars are missing or invalid.
func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	secret := os.Getenv("SESSION_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("SESSION_SECRET is required")
	}
	// Pad if shorter than 32 chars
	if len(secret) < minSessionSecretLen {
		pad := strings.Repeat("0", minSessionSecretLen-len(secret))
		secret = secret + pad
		slog.Warn("SESSION_SECRET was shorter than 32 chars; padded", "original_len", len(secret)-len(pad))
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	nodeEnv := os.Getenv("NODE_ENV")
	if nodeEnv == "" {
		nodeEnv = os.Getenv("GO_ENV")
	}
	if nodeEnv == "" {
		nodeEnv = defaultNodeEnv
	}

	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = defaultLogLevel
	}

	corsOrigins := parseCORSOrigins(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if len(corsOrigins) == 0 {
		corsOrigins = defaultCORSOrigins
	}

	return &Config{
		DatabaseURL:        dbURL,
		SessionSecret:      secret,
		Port:               port,
		NodeEnv:            nodeEnv,
		AdminEmail:         os.Getenv("ADMIN_EMAIL"),
		LogLevel:           logLevel,
		CORSAllowedOrigins: corsOrigins,
	}, nil
}

func parseCORSOrigins(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	seen := make(map[string]bool)
	for _, p := range parts {
		s := strings.TrimSpace(p)
		if s != "" && !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}
