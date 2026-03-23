package api

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"kinnect-v3/internal/auth"
	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/db"
)

// PagesHandler handles CSRF, Me, LiveToken, WatchToken.
type PagesHandler struct {
	cache *cache.Cache
	db    *sql.DB
}

// Csrf handles GET /api/csrf.
func (h *PagesHandler) Csrf(w http.ResponseWriter, r *http.Request) {
	sess := auth.GetSession(r)
	token := ""
	if sess != nil {
		token = sess.CsrfToken
	}
	writeJSON(w, http.StatusOK, map[string]any{"csrfToken": token})
}

// Me handles GET /api/me.
func (h *PagesHandler) Me(w http.ResponseWriter, r *http.Request) {
	sess := auth.GetSession(r)
	if sess == nil || sess.User == nil || sess.User.ID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "Not authenticated"})
		return
	}
	userID := sess.User.ID
	role := sess.User.Role
	if role == "" {
		role = "user"
	}
	ud := h.cache.GetUser(userID)
	displayName := h.cache.GetDisplayName(userID)
	shareCode := ""
	var email, mobile string
	if ud != nil {
		shareCode = ud.ShareCode
		if ud.Email != nil {
			email = *ud.Email
		}
		if ud.Mobile != nil {
			mobile = *ud.Mobile
		}
		if role == "" {
			role = ud.Role
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"userId":      userID,
		"displayName": displayName,
		"role":        role,
		"shareCode":   shareCode,
		"email":       email,
		"mobile":      mobile,
	})
}

// LiveToken handles GET /api/live/{token}.
func (h *PagesHandler) LiveToken(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	entry := h.cache.GetLiveToken(token)
	if entry == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "expired": true})
		return
	}
	now := time.Now().UnixMilli()
	if entry.ExpiresAt != nil && *entry.ExpiresAt <= now {
		h.cache.DeleteLiveToken(token)
		_ = db.DeleteLiveToken(context.Background(), h.db, token)
		sharedBy := h.cache.GetDisplayName(entry.UserID)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "expired": true, "sharedBy": sharedBy,
		})
		return
	}
	sharedBy := h.cache.GetDisplayName(entry.UserID)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "token": token, "sharedBy": sharedBy, "expired": false,
	})
}

// WatchToken handles GET /api/watch/{token}.
func (h *PagesHandler) WatchToken(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	entry := h.cache.GetWatchToken(token)
	if entry == nil || entry.Exp < time.Now().UnixMilli() {
		if entry != nil {
			h.cache.DeleteWatchToken(token)
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "expired": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "token": token})
}
