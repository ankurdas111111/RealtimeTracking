package db

import (
	"database/sql"
	"log/slog"
	"net/url"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

const (
	maxOpenConns    = 20
	maxIdleConns    = 10
	connMaxIdleTime = 30 * time.Second
	connMaxLifetime = 5 * time.Minute
)

// Pool wraps *sql.DB with Close for graceful shutdown.
type Pool struct {
	DB *sql.DB
}

// NewPool creates a database connection pool from connStr.
// Uses sslmode=require for remote DBs (not localhost).
func NewPool(connStr string) (*Pool, error) {
	cleanURL := connStr
	// Strip existing sslmode param so we can set our own
	if u, err := url.Parse(connStr); err == nil && u.RawQuery != "" {
		q := u.Query()
		q.Del("sslmode")
		u.RawQuery = q.Encode()
		cleanURL = u.String()
		if u.Scheme == "postgres" && u.RawQuery != "" {
			cleanURL = strings.TrimSuffix(cleanURL, "?")
		}
	}

	isRemote := strings.Contains(connStr, "@") &&
		!strings.Contains(connStr, "localhost") &&
		!strings.Contains(connStr, "127.0.0.1")

	if isRemote {
		if strings.Contains(cleanURL, "?") {
			cleanURL += "&sslmode=require"
		} else {
			cleanURL += "?sslmode=require"
		}
	} else if !strings.Contains(cleanURL, "sslmode") {
		if strings.Contains(cleanURL, "?") {
			cleanURL += "&sslmode=disable"
		} else {
			cleanURL += "?sslmode=disable"
		}
	}

	db, err := sql.Open("postgres", cleanURL)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxIdleTime(connMaxIdleTime)
	db.SetConnMaxLifetime(connMaxLifetime)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}

	slog.Info("Database pool created", "max_conns", maxOpenConns)
	return &Pool{DB: db}, nil
}

// Close closes the connection pool.
func (p *Pool) Close() error {
	if p.DB != nil {
		return p.DB.Close()
	}
	return nil
}
