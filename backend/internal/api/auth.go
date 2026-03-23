package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"kinnect-v3/internal/auth"
	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/db"
	"kinnect-v3/internal/shared"
)

var (
	emailRegex  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	mobileRegex = regexp.MustCompile(`^\+\d{7,15}$`)
)

const (
	sessionMaxAge    = 7 * 24 * time.Hour
	authRateLimit    = 10 // max attempts per IP per minute
	maxPasswordBytes = 72 // bcrypt silently truncates at 72 bytes
)

// ipRateEntry tracks request count per IP within a sliding window.
type ipRateEntry struct {
	mu      sync.Mutex
	count   int
	resetAt time.Time
}

var authIPLimiter sync.Map // map[string]*ipRateEntry

// checkAuthRateLimit returns false if the IP has exceeded authRateLimit attempts per minute.
func checkAuthRateLimit(r *http.Request) bool {
	ip := r.RemoteAddr
	if i := strings.LastIndex(ip, ":"); i >= 0 {
		ip = ip[:i]
	}
	now := time.Now()
	v, _ := authIPLimiter.LoadOrStore(ip, &ipRateEntry{resetAt: now.Add(time.Minute)})
	entry := v.(*ipRateEntry)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if now.After(entry.resetAt) {
		entry.count = 0
		entry.resetAt = now.Add(time.Minute)
	}
	entry.count++
	return entry.count <= authRateLimit
}

// AuthHandler handles login, register, logout.
type AuthHandler struct {
	db         *sql.DB
	cache      *cache.Cache
	store      *auth.SessionStore
	secret     string
	adminEmail string
	secure     bool
}

// LoginRequest is the JSON body for POST /api/login.
type LoginRequest struct {
	LoginID     string `json:"login_id"`
	LoginMethod string `json:"login_method"`
	Password    string `json:"password"`
}

// Login handles POST /api/login.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if !checkAuthRateLimit(r) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"ok": false, "error": "Too many login attempts. Try again later."})
		return
	}
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid request body"})
		return
	}
	loginID := strings.TrimSpace(req.LoginID)
	loginMethod := strings.TrimSpace(req.LoginMethod)
	password := req.Password

	if loginID == "" || password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Email/mobile and password are required"})
		return
	}
	if len(password) > maxPasswordBytes {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Password too long (max 72 characters)"})
		return
	}

	var userID string
	if loginMethod == "mobile" {
		cleaned := regexp.MustCompile(`[\s\-()]`).ReplaceAllString(loginID, "")
		if !mobileRegex.MatchString(cleaned) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid mobile number format"})
			return
		}
		userID = h.cache.GetUserIDByMobile(cleaned)
	} else {
		email := strings.ToLower(loginID)
		if !emailRegex.MatchString(email) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid email address"})
			return
		}
		userID = h.cache.GetUserIDByEmail(email)
	}

	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "Invalid credentials"})
		return
	}

	hash, err := db.GetUserPasswordHash(context.Background(), h.db, userID)
	if err != nil || hash == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "Invalid credentials"})
		return
	}
	if !auth.ComparePassword(hash, password) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "Invalid credentials"})
		return
	}

	role := h.cache.GetUserRole(userID)
	if role == "" {
		role = "user"
	}

	sid := auth.GenerateSessionID()
	sessData := &auth.SessionData{
		User:      &auth.SessionUser{ID: userID, Role: role},
		CsrfToken: auth.GenerateCsrfToken(),
	}
	if err := h.store.Create(sid, sessData, sessionMaxAge); err != nil {
		slog.Error("Session create failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Server error"})
		return
	}

	signed := auth.SignCookie(sid, h.secret)
	setSessionCookie(w, signed, int(sessionMaxAge.Seconds()), h.secure)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "userId": userID, "role": role})
}

// RegisterRequest is the JSON body for POST /api/register.
type RegisterRequest struct {
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	Password    string `json:"password"`
	Confirm     string `json:"confirm"`
	ContactType string `json:"contact_type"`
	ContactValue string `json:"contact_value"`
}

// Register handles POST /api/register.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if !checkAuthRateLimit(r) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"ok": false, "error": "Too many registration attempts. Try again later."})
		return
	}
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid request body"})
		return
	}
	firstName := strings.TrimSpace(req.FirstName)
	lastName := strings.TrimSpace(req.LastName)
	password := req.Password
	confirm := req.Confirm
	contactType := strings.TrimSpace(req.ContactType)
	contactValue := strings.TrimSpace(req.ContactValue)

	if firstName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "First name is required"})
		return
	}
	if len(firstName) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "First name too long (max 50)"})
		return
	}
	if len(lastName) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Last name too long (max 50)"})
		return
	}
	if password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Password is required"})
		return
	}
	if len(password) < 6 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Password must be at least 6 characters"})
		return
	}
	if len(password) > maxPasswordBytes {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Password too long (max 72 characters)"})
		return
	}
	if password != confirm {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Passwords do not match"})
		return
	}
	if contactType != "email" && contactType != "mobile" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Please choose email or mobile number"})
		return
	}
	if contactValue == "" {
		msg := "Email is required"
		if contactType == "mobile" {
			msg = "Mobile number is required"
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": msg})
		return
	}

	var email, mobile *string
	ctx := context.Background()

	if contactType == "email" {
		contactValue = strings.ToLower(contactValue)
		if len(contactValue) > 255 || !emailRegex.MatchString(contactValue) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid email address"})
			return
		}
		existing, _ := db.FindUserByEmail(ctx, h.db, contactValue)
		if existing != "" {
			writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "This email is already registered"})
			return
		}
		email = &contactValue
	} else {
		contactValue = regexp.MustCompile(`[\s\-()]`).ReplaceAllString(contactValue, "")
		if !mobileRegex.MatchString(contactValue) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid mobile number format (must include country code)"})
			return
		}
		existing, _ := db.FindUserByMobile(ctx, h.db, contactValue)
		if existing != "" {
			writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "This mobile number is already registered"})
			return
		}
		mobile = &contactValue
	}

	shareCode := h.generateUniqueShareCode()
	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		slog.Error("Password hash failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Server error"})
		return
	}

	adminEnv := strings.TrimSpace(strings.ToLower(h.adminEmail))
	role := "user"
	if adminEnv != "" && email != nil && *email == adminEnv {
		role = "admin"
	}

	createdAt := time.Now().UnixMilli()
	userID, err := db.CreateUser(ctx, h.db, firstName, lastName, passwordHash, role, shareCode, createdAt, email, mobile)
	if err != nil {
		slog.Error("Create user failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Server error"})
		return
	}

	h.cache.AddUser(userID, &db.UserCacheEntry{
		FirstName: firstName,
		LastName:  lastName,
		Role:      role,
		ShareCode:  shareCode,
		Email:     email,
		Mobile:    mobile,
		CreatedAt: createdAt,
	}, shareCode, email, mobile)

	sid := auth.GenerateSessionID()
	sessData := &auth.SessionData{
		User:      &auth.SessionUser{ID: userID, Role: role},
		CsrfToken: auth.GenerateCsrfToken(),
	}
	if err := h.store.Create(sid, sessData, sessionMaxAge); err != nil {
		slog.Error("Session create failed", "error", err)
	}
	signed := auth.SignCookie(sid, h.secret)
	setSessionCookie(w, signed, int(sessionMaxAge.Seconds()), h.secure)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "userId": userID, "role": role})
}

func (h *AuthHandler) generateUniqueShareCode() string {
	for {
		c := shared.GenerateCode()
		if !h.cache.ShareCodeExists(c) {
			return c
		}
	}
}

// Logout handles POST /api/logout.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	sid := auth.GetSessionID(r) // from middleware context
	if sid != "" {
		_ = h.store.Destroy(sid)
	}
	clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func setSessionCookie(w http.ResponseWriter, signed string, maxAge int, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     "connect.sid",
		Value:    url.QueryEscape(signed),
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "connect.sid",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
